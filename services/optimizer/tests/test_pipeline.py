"""Pipeline acceptance fixtures (spec §16, model correctness)."""

import json
from pathlib import Path

import pytest

from fillrate_optimizer.canonical import canonical, content_hash, js_number
from fillrate_optimizer.loads import truck_count_first_penalty
from fillrate_optimizer.model import PreflightPolicy, RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import PipelineError, run_pipeline, validate_cluster
from fillrate_optimizer.synthetic import build
from fillrate_optimizer.travel import miles_to_m

from .conftest import MEMPHIS, east

EXAMPLE = Path(__file__).resolve().parents[3] / "examples/m1-synthetic.json"
# Most fixtures exercise solver paths for far, unresolved or oversized stops, so the preflight
# checks only warn here; test_preflight_* cover the blocking defaults.
WARN = PreflightPolicy(missing_coordinates="warn", far_from_depot="warn", oversize_stop="warn")
FAST = RunSettings(solver_max_iterations=300, solver_time_limit_s=5, preflight=WARN)


def scenario(locations, orders, inventory, products=None) -> ScenarioDocument:
    return ScenarioDocument.model_validate(
        {
            "name": "test",
            "depot": {"id": "D", "label": "Depot", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
            "products": products or [{"id": "P", "label": "Pallet", "linear_feet_per_piece": 400}],
            "locations": [
                {
                    "id": i,
                    "label": i,
                    "lat": at[0] if at else None,
                    "lon": at[1] if at else None,
                    "coordinate_source": "imported" if at else "unresolved",
                }
                for i, at in locations
            ],
            "orders": [
                {
                    "id": oid,
                    "location_id": loc,
                    "order_date": date,
                    "lines": [
                        {
                            "id": f"{oid}-1",
                            "product_id": pid,
                            "ordered_pieces": q,
                            "net_value_per_piece_cents": v,
                        }
                    ],
                }
                for oid, loc, date, pid, q, v in orders
            ],
            "inventory": [{"product_id": p, "available_pieces": n} for p, n in inventory],
        }
    )


def run(doc, **settings):
    return run_pipeline(doc, FAST.model_copy(update=settings))


def test_stage_cache_reuses_preprocessing_but_not_a_new_solver_replicate():
    doc = scenario(
        [("A", east(50))],
        [("O1", "A", "2026-09-01", "P", 2, 100)],
        [("P", 2)],
    )
    cache = {}

    def checkpoint(artifact):
        cache.setdefault(
            artifact.manifest["input_hash"],
            {
                "manifest": artifact.manifest,
                "payload": artifact.payload,
            },
        )

    first = run_pipeline(doc, FAST, execution_id="attempt-1", checkpoint=checkpoint)
    second = run_pipeline(
        doc,
        FAST.model_copy(update={"solver_seed": 3}),
        execution_id="attempt-2",
        cache=cache.get,
        checkpoint=checkpoint,
    )
    by_stage = {a.stage: a.manifest for a in second.artifacts}
    for stage in ("allocation", "aggregation", "clustering", "travel"):
        assert by_stage[stage]["reused_from"] == "attempt-1"
    assert by_stage["solve"]["reused_from"] is None
    assert first.summary.totals.planned_cents == second.summary.totals.planned_cents


def test_cluster_result_checkpoint_resumes_after_attempt_change():
    doc = scenario(
        [("A", east(50))],
        [("O1", "A", "2026-09-01", "P", 2, 100)],
        [("P", 2)],
    )
    saved = {}
    calls = []

    def cluster_task(action, cluster_id, input_hash, result):
        calls.append(action)
        key = (cluster_id, input_hash)
        if action == "claim":
            return saved.get(key, {"status": "running"})
        saved[key] = {"status": "succeeded", "result": result}
        return saved[key]

    first = run_pipeline(doc, FAST, cluster_task=cluster_task)
    second = run_pipeline(doc, FAST, cluster_task=cluster_task)
    assert calls == ["claim", "complete", "claim"]
    assert first.summary.totals.planned_cents == second.summary.totals.planned_cents


def test_solver_error_in_one_cluster_keeps_other_clusters_as_partial_plan(monkeypatch):
    import fillrate_optimizer.pipeline as pipeline

    doc = scenario(
        [("E", east(100)), ("W", east(-100))],
        [("O1", "E", "2026-09-01", "P", 2, 100), ("O2", "W", "2026-09-01", "P", 2, 100)],
        [("P", 4)],
    )
    real = pipeline.solve_partition
    calls = []

    def flaky(problem):
        calls.append(problem)
        if len(calls) == 1:
            raise RuntimeError("solver crashed")
        return real(problem)

    monkeypatch.setattr(pipeline, "solve_partition", flaky)
    out = run(doc, k=2)
    statuses = sorted(c.status for c in out.summary.clusters)
    assert statuses == ["no_candidate", "validated"]
    assert out.summary.validity == "invalid"
    assert out.summary.coverage == "partial"
    assert out.summary.totals.trucks == 1
    failed = [u for u in out.summary.unplanned if "solver raised" in u.evidence]
    assert len(failed) == 1 and failed[0].reason == "no_valid_candidate"
    assert any(d.code == "partial_plan" for d in out.summary.diagnostics)


# ---- canonical JSON must match JavaScript -----------------------------------------------------


@pytest.mark.parametrize(
    "value,expected",
    [
        (5.0, "5"),
        (0.1, "0.1"),
        (1e-7, "1e-7"),
        (1e21, "1e+21"),
        (123456789012.5, "123456789012.5"),
        (0.00001, "0.00001"),
        (-2.5e-7, "-2.5e-7"),
        (35.1495, "35.1495"),
        (1e20, "100000000000000000000"),
    ],
)
def test_js_number_formatting(value, expected):
    assert js_number(value) == expected


def test_canonical_sorts_keys_and_keeps_arrays():
    assert (
        canonical({"b": [2, 1.0], "a": {"z": None, "y": "é"}})
        == '{"a":{"y":"é","z":null},"b":[2,1]}'
    )
    with pytest.raises(ValueError):
        canonical({"x": float("nan")})


# ---- allocation ---------------------------------------------------------------------------------


def test_allocation_order_date_then_value_is_deterministic():
    doc = scenario(
        [("A", east(50))],
        [
            ("O1", "A", "2026-09-02", "P", 3, 900),
            ("O2", "A", "2026-09-01", "P", 3, 100),
            ("O3", "A", "2026-09-02", "P", 3, 500),
        ],
        [("P", 5)],
    )
    out = run(doc)
    shortages = {u.line_id: u.pieces for u in out.summary.unplanned if u.reason == "stock_shortage"}
    # O2 is oldest; on 09-02 the higher value per piece (O1) wins; O3 gets nothing.
    assert shortages == {"O1-1": 1, "O3-1": 3}
    # Measured runtimes are provenance, not results; everything else must repeat exactly.
    skip = {"clusters": True, "allocation": {"runtime_s"}}
    assert run(doc).summary.model_dump(exclude=skip) == out.summary.model_dump(exclude=skip)


def test_excluded_demand_never_consumes_stock():
    doc = scenario(
        [("A", east(50)), ("X", None)],
        [("O1", "X", "2026-09-01", "P", 4, 100), ("O2", "A", "2026-09-02", "P", 4, 100)],
        [("P", 4)],
    )
    s = run(doc).summary
    p = s.products[0]
    assert (p.excluded, p.allocated, p.planned, p.residual) == (4, 4, 4, 0)
    assert {u.reason for u in s.unplanned} == {"excluded_unresolved_coordinates"}


def test_oversize_piece_is_rejected_before_allocation():
    doc = scenario(
        [("A", east(50))],
        [("O1", "A", "2026-09-01", "BIG", 1, 100)],
        [("BIG", 1)],
        products=[{"id": "BIG", "label": "Crate", "linear_feet_per_piece": 5_301}],
    )
    s = run(doc).summary
    assert [u.reason for u in s.unplanned] == ["oversize_piece"]
    assert s.products[0].residual == 1 and s.coverage == "empty"


# ---- aggregation --------------------------------------------------------------------------------


def test_aggregation_requires_same_customer_and_location():
    doc = scenario(
        [("A", east(50))],
        [
            ("O1", "A", "2026-09-01", "P", 1, 100),
            ("O2", "A", "2026-09-01", "P", 1, 100),
            ("O3", "A", "2026-09-01", "P", 1, 100),
        ],
        [("P", 3)],
    )
    doc.orders[0].customer_id = "C1"
    doc.orders[1].customer_id = "C1"
    doc.orders[2].customer_id = "C2"
    out = run(doc)
    visits = next(a for a in out.artifacts if a.stage == "aggregation").payload["visits"]
    assert {v["visit_id"]: [line["line_id"] for line in v["lines"]] for v in visits} == {
        '["A","C1"]#1': ["O1-1", "O2-1"],
        '["A","C2"]#1': ["O3-1"],
    }


def test_greedy_split_conserves_whole_pieces():
    doc = scenario(
        [("A", east(50))],
        [("O1", "A", "2026-09-01", "P", 30, 100)],  # 30 × 4 ft = 120 ft → 3 trailers
        [("P", 30)],
    )
    out = run(doc)
    visits = next(a for a in out.artifacts if a.stage == "aggregation").payload["visits"]
    assert [v["visit_id"] for v in visits] == ['["A","O1"]#1', '["A","O1"]#2', '["A","O1"]#3']
    assert [v["load"] for v in visits] == [5_200, 5_200, 1_600]
    assert sum(p["pieces"] for v in visits for p in v["lines"]) == 30
    assert out.summary.totals.trucks == 3 and out.summary.coverage == "complete"
    # Split visits share one matrix node.
    travel = next(a for a in out.artifacts if a.stage == "travel").payload["clusters"][0]
    assert travel["nodes"] == ["depot", "A"]


# ---- graph reachability (spec §7, §16) ------------------------------------------------------


def chain():
    a = east(330)  # ≈ 396 mi with circuity
    b = east(165, a)  # A → B ≈ 198 mi; depot → B ≈ 594 mi
    return a, b


def test_400_plus_200_chain_is_accepted():
    a, b = chain()
    doc = scenario(
        [("A", a), ("B", b)],
        [("O1", "A", "2026-09-01", "P", 5, 100), ("O2", "B", "2026-09-01", "P", 5, 100)],
        [("P", 10)],
    )
    s = run(doc).summary
    assert s.validity == "valid" and s.coverage == "complete"
    assert [[v.location_id for v in t.visits] for t in s.trucks] == [["A", "B"]]
    assert max(v.leg_m for v in s.trucks[0].visits) <= miles_to_m(500)


def test_partition_that_removes_the_bridge_is_diagnosed():
    a, b = chain()
    doc = scenario(
        [("A", a), ("B", b)],
        [("O1", "A", "2026-09-01", "P", 5, 100), ("O2", "B", "2026-09-01", "P", 5, 100)],
        [("P", 10)],
    )
    s = run(doc, k=2).summary
    assert {u.location_id: u.reason for u in s.unplanned} == {"B": "unreachable_in_partition"}
    assert s.validity == "valid" and s.coverage == "partial"


def test_isolated_location_is_unreachable():
    doc = scenario(
        [("A", east(100)), ("FAR", (39.7392, -104.9903))],
        [("O1", "A", "2026-09-01", "P", 2, 100), ("O2", "FAR", "2026-09-01", "P", 2, 100)],
        [("P", 4)],
    )
    s = run(doc).summary
    assert {u.location_id: u.reason for u in s.unplanned} == {"FAR": "unreachable"}
    assert s.products[0].allocated_unplanned == 2


def test_capacity_forced_missing_edge_yields_no_valid_candidate():
    # B is reachable only through A, but A + B exceed one trailer, so B's own truck would
    # need the 594 mi depot leg. PyVRP prefers an overloaded (infeasible) route; either way
    # nothing is planned and the result says it is not proof of infeasibility.
    a, b = chain()
    doc = scenario(
        [("A", a), ("B", b)],
        [("O1", "A", "2026-09-01", "P", 10, 100), ("O2", "B", "2026-09-01", "P", 10, 100)],
        [("P", 20)],
    )
    s = run(doc).summary
    assert s.clusters[0].status in ("no_candidate", "invalid_candidate")
    assert s.validity == "invalid" and s.trucks == []
    assert {u.reason for u in s.unplanned} <= {"no_valid_candidate", "candidate_invalid"}
    assert s.products[0].planned == 0 and s.products[0].allocated_unplanned == 20


def test_validator_rejects_solver_feasible_missing_edge_candidate():
    a, b = chain()
    doc = scenario(
        [("A", a), ("B", b)],
        [("O1", "A", "2026-09-01", "P", 5, 100), ("O2", "B", "2026-09-01", "P", 5, 100)],
        [("P", 10)],
    )
    out = run(doc)
    stage = {x.stage: x.payload for x in out.artifacts}
    meta = stage["clustering"]["clusters"][0]
    prob = stage["problem"]["clusters"][0]
    trav = stage["travel"]["clusters"][0]
    visits = {v["visit_id"]: v for v in stage["aggregation"]["visits"]}
    lines = {f"O{i}-1": {"lf": 400, "value": 100} for i in (1, 2)}
    # A candidate the solver called feasible, but with B first: depot → B is 594 mi.
    solve = {
        "status": "solved",
        "solver_feasible": True,
        "routes": [['["B","O2"]#1'], ['["A","O1"]#1']],
    }
    check = validate_cluster(meta, prob, trav, solve, visits, lines, FAST)
    assert not check["valid"]
    assert any(v.startswith("leg to B") for v in check["violations"])


def test_diameter_repair_splits_wide_cluster():
    doc = scenario(
        [("E", east(350)), ("W", east(-350))],  # 700 mi apart, 840 mi with circuity
        [("O1", "E", "2026-09-01", "P", 2, 100), ("O2", "W", "2026-09-01", "P", 2, 100)],
        [("P", 4)],
    )
    limit = miles_to_m(500)
    s = run(doc, k=1, max_cluster_diameter_m=limit).summary
    assert s.clustering.raw_cluster_count == 1 and s.clustering.effective_cluster_count == 2
    assert [r.reason for r in s.clustering.repairs] == ["diameter"]
    assert all(c.diameter_m <= limit for c in s.clusters)


def test_diameter_policy_is_off_by_default():
    """Spec v1.8: the 500-mile rule is per leg only; a wide cluster is not repaired or invalid."""
    assert RunSettings().max_cluster_diameter_m is None
    doc = scenario(
        [("E", east(350)), ("W", east(-350))],
        [("O1", "E", "2026-09-01", "P", 2, 100), ("O2", "W", "2026-09-01", "P", 2, 100)],
        [("P", 4)],
    )
    s = run(doc, k=1).summary
    assert s.clustering.effective_cluster_count == 1 and s.clustering.repairs == []
    assert s.clusters[0].diameter_m > miles_to_m(500)
    assert s.validity == "valid" and s.coverage == "complete"
    # Auto-k only enforces solve size now, so one cluster suffices.
    assert run(doc).summary.clustering.selected_k == 1


# ---- preflight checks (M2 scope item 8) -------------------------------------------------------


def blocking_doc():
    return scenario(
        [("NEAR", east(50)), ("FAR", east(560)), ("LOST", None), ("BIG", east(80))],
        [
            ("O1", "NEAR", "2026-09-01", "P", 2, 100),
            ("O2", "FAR", "2026-09-01", "P", 2, 100),
            ("O3", "LOST", "2026-09-01", "P", 2, 100),
            ("O4", "BIG", "2026-09-01", "P", 14, 100),  # 14 × 4 ft = 56 ft > 53 ft
        ],
        [("P", 100)],
    )


def test_preflight_blocks_by_default_and_names_each_check():
    with pytest.raises(PipelineError) as error:
        run(blocking_doc(), preflight=PreflightPolicy())
    message = str(error.value)
    assert "no coordinates" in message and "from the depot" in message
    assert "trailer" not in message  # oversize stops split by default (round two)
    with pytest.raises(PipelineError) as error:
        run(blocking_doc(), preflight=PreflightPolicy(oversize_stop="block"))
    assert error.value.code == "preflight_blocked"
    message = str(error.value)
    assert "no coordinates" in message and "from the depot" in message
    assert "more than one 53 ft trailer" in message


def test_preflight_warnings_are_recorded_and_the_run_proceeds():
    s = run(blocking_doc(), k=2).summary
    found = {f.check: f for f in s.preflight}
    assert set(found) == {"missing_coordinates", "far_from_depot", "oversize_stop"}
    assert all(f.action == "warn" for f in found.values())
    assert found["far_from_depot"].location_ids == ["FAR"]
    assert found["oversize_stop"].line_ids == ["O4-1"]
    assert s.validity == "valid"


def test_exclude_lines_and_run_records_excluded_by_user():
    policy = PreflightPolicy()  # all blocking
    s = run(
        blocking_doc(), k=1, preflight=policy, excluded_line_ids=["O2-1", "O3-1", "O4-1"]
    ).summary
    assert s.preflight == []
    excluded = {u.line_id: u.reason for u in s.unplanned}
    assert excluded == {
        "O2-1": "excluded_by_user",
        "O3-1": "excluded_by_user",
        "O4-1": "excluded_by_user",
    }
    product = s.products[0]
    assert product.excluded == 18 and product.planned == 2  # reconciled like any exclusion


def test_unknown_excluded_line_is_rejected():
    with pytest.raises(PipelineError, match="not in the scenario"):
        run(blocking_doc(), excluded_line_ids=["nope"])


# ---- objective (spec §8b) ---------------------------------------------------------------------


def test_derived_penalty_orders_truck_count_first():
    n, leg = 4, miles_to_m(500)
    penalty, bound = truck_count_first_penalty(n, leg)
    assert bound == n * leg and penalty == bound + 1
    # Worst feasible 1-truck plan still beats the best conceivable 2-truck plan.
    assert penalty * 1 + bound < penalty * 2 + 0


def test_trucks_first_vs_weighted_zero_counterexample():
    doc = scenario(
        [("E", east(100)), ("W", east(-100))],
        [("O1", "E", "2026-09-01", "P", 2, 100), ("O2", "W", "2026-09-01", "P", 2, 100)],
        [("P", 4)],
    )
    trucks_first = run(doc, k=1).summary
    weighted = run(doc, k=1, objective="weighted_distance", weighted_truck_penalty_m=0).summary
    assert trucks_first.totals.trucks == 1
    assert weighted.totals.trucks == 2  # distance only: two short open routes win
    assert weighted.totals.loaded_distance_m < trucks_first.totals.loaded_distance_m


def test_zero_visits_is_an_empty_successful_plan():
    doc = scenario([("A", east(50))], [("O1", "A", "2026-09-01", "P", 3, 100)], [("P", 0)])
    s = run(doc).summary
    assert s.validity == "valid" and s.coverage == "empty"
    assert s.totals.avg_fill is None and s.clusters == []


def test_invalid_fixed_k_is_actionable():
    doc = scenario([("A", east(50))], [("O1", "A", "2026-09-01", "P", 3, 100)], [("P", 3)])
    with pytest.raises(PipelineError, match="k=3 exceeds"):
        run(doc, k=3)


# ---- bundled example ----------------------------------------------------------------------------


def test_bundled_example_is_current():
    document = json.loads(EXAMPLE.read_text())
    assert document["scenario"] == build().model_dump(mode="json")


def test_bundled_example_reconciles_and_chains_manifests():
    document = json.loads(EXAMPLE.read_text())
    out = run_pipeline(
        ScenarioDocument.model_validate(document["scenario"]),
        RunSettings.model_validate(document["settings"]),
    )
    s = out.summary
    reasons = {u.reason for u in s.unplanned}
    assert {
        "stock_shortage",
        "unreachable",
        "excluded_unresolved_coordinates",
        "oversize_piece",
    } <= reasons
    assert s.validity == "valid"
    assert all(t.load <= s.settings.trailer_capacity for t in s.trucks)
    assert s.settings.max_cluster_diameter_m is None
    assert {f.check for f in s.preflight} == {
        "missing_coordinates",
        "far_from_depot",
        "far_via_stop",
        "oversize_stop",
    }
    assert all(f.action == "warn" for f in s.preflight)
    seen: set[str] = set()
    for artifact in out.artifacts:
        assert artifact.manifest["output_hash"] == content_hash(artifact.payload)
        assert set(artifact.manifest["parent_hashes"]) <= seen
        seen.add(artifact.manifest["output_hash"])
    # Allocation is fixed, so k and seed cannot change allocated revenue (spec §8).
    other = run_pipeline(
        ScenarioDocument.model_validate(document["scenario"]),
        RunSettings.model_validate(document["settings"]).model_copy(
            update={"k": 6, "solver_seed": 3}
        ),
    ).summary
    assert other.totals.allocated_cents == s.totals.allocated_cents
