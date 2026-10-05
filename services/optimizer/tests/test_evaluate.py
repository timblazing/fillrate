"""Manual plan evaluator (spec §10, M6): same matrices, same constraint semantics as the run."""

import json
import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from fillrate_optimizer.app import app
from fillrate_optimizer.artifact_codec import decode_travel
from fillrate_optimizer.capabilities import capabilities
from fillrate_optimizer.evaluate import (
    ClusterPlan,
    EvaluateRequest,
    EvaluationError,
    cluster_request,
    evaluate,
)
from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import run_pipeline
from fillrate_optimizer.travel import miles_to_m

from .conftest import east, north
from .test_pipeline import FAST, scenario
from .test_travel_snapshots import scenario as parity_scenario
from .test_travel_snapshots import settings as parity_settings
from .test_travel_snapshots import snapshot as parity_snapshot

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"


def example(name: str):
    document = json.loads((EXAMPLES / name).read_text())
    return (
        ScenarioDocument.model_validate(document["scenario"]),
        RunSettings.model_validate(document["settings"]),
    )


def stages_of(out) -> dict:
    stages = {a.stage: a.payload for a in out.artifacts}
    stages["travel"] = decode_travel(stages["travel"])
    return stages


def evaluated(scenario_doc, settings, out, cluster_id, routes, **kwargs):
    request = cluster_request(scenario_doc, settings, stages_of(out), cluster_id, routes, **kwargs)
    return evaluate(request)


def solved_routes(out, cluster_id):
    solve = next(c for c in stages_of(out)["solve"]["clusters"] if c["cluster_id"] == cluster_id)
    return solve


def codes(evaluation) -> set[str]:
    return {v.code for v in evaluation.violations}


# ---- the optimized plan reproduces the run ---------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        "m1-synthetic.json",  # several clusters, a blocked visit, partial coverage
        "lesson-capacity.json",  # a stop split across three trucks
        "lesson-windows.json",  # time windows, service and waiting
        "m6-time-windows.json",
    ],
)
def test_evaluating_the_optimized_routes_reproduces_the_recorded_metrics(name):
    scenario_doc, settings = example(name)
    out = run_pipeline(scenario_doc, settings)
    checked = 0
    for cluster in out.summary.clusters:
        if cluster.status != "validated" or not cluster.trucks:
            continue
        solve = solved_routes(out, cluster.id)
        result = evaluated(scenario_doc, settings, out, cluster.id, solve["routes"])
        for evaluation in (result.manual, result.reference):
            assert evaluation.valid and evaluation.violations == []
            m = evaluation.metrics
            assert (m.trucks, m.loaded_distance_m, m.planned_amount_cents) == (
                cluster.trucks,
                cluster.loaded_distance_m,
                cluster.planned_amount_cents,
            )
            assert (m.avg_fill, m.min_fill) == (cluster.avg_fill, cluster.min_fill)
            assert m.planned_visit_count == cluster.planned_visit_count
            assert m.capacity_lower_bound == cluster.capacity_lower_bound
            assert m.truck_penalty == cluster.truck_penalty
            # The objective is exactly what PyVRP reported for this candidate.
            assert m.objective == solve["cost"]
        recorded = [t for t in out.summary.trucks if t.cluster_id == cluster.id]
        # Same rows as the run's result, byte for byte (the reference keeps the run's IDs).
        assert [t.model_dump(mode="json") for t in result.reference.trucks] == [
            t.model_dump(mode="json") for t in recorded
        ]
        manual_rows = [t.model_dump(mode="json") for t in result.manual.trucks]
        for row, truck in zip(manual_rows, recorded, strict=True):
            assert row["id"] == truck.id.replace("-T", "-M")
            assert {**row, "id": truck.id} == truck.model_dump(mode="json")
        checked += 1
    assert checked >= 1


def test_the_reference_under_the_cost_objective_is_priced_in_exact_cents():
    scenario_doc, settings = example("lesson-capacity.json")
    settings = settings.model_copy(
        update={"objective": "cost", "cost_per_truck_cents": 25_000, "cost_per_mile_cents": 300}
    )
    out = run_pipeline(scenario_doc, settings)
    cluster = out.summary.clusters[0]
    solve = solved_routes(out, cluster.id)
    m = evaluated(scenario_doc, settings, out, cluster.id, solve["routes"]).manual.metrics
    assert m.objective == solve["cost"] and m.objective_mode == "cost"
    miles = cluster.loaded_distance_m / 1609.344
    assert m.objective_cents == pytest.approx(25_000 * cluster.trucks + 300 * miles)


# ---- a valid manual plan that is worse than PyVRP's ---------------------------------------------


def test_a_valid_manual_reorder_is_evaluated_and_worse_than_the_solver():
    # Five stops due east of the depot at 20, 40, 60, 80 and 100 mi, one pallet each.
    doc = scenario(
        [(f"S{i}", east(20 * i)) for i in range(1, 6)],
        [(f"O{i}", f"S{i}", "2026-09-01", "P", 1, 1_000) for i in range(1, 6)],
        [("P", 5)],
    )
    settings = FAST.model_copy(update={"k": 1})
    out = run_pipeline(doc, settings)
    solve = solved_routes(out, "C1")
    assert len(solve["routes"]) == 1
    by_loc = {json.loads(v.split("#")[0])[0]: v for v in solve["routes"][0]}
    optimized = [by_loc[f"S{i}"] for i in range(1, 6)]
    assert solve["routes"][0] == optimized  # outward along the line

    # A dispatcher who drives to the far end first and works back.
    backwards = [optimized[::-1]]
    result = evaluated(doc, settings, out, "C1", backwards)
    manual, reference = result.manual, result.reference
    assert manual.valid and manual.violations == []
    assert manual.metrics.trucks == reference.metrics.trucks == 1
    assert manual.metrics.planned_amount_cents == reference.metrics.planned_amount_cents
    # 100 mi out, then four 20 mi legs back: 180 mi against the solver's 100 mi.
    assert manual.metrics.loaded_distance_m > reference.metrics.loaded_distance_m
    assert manual.metrics.loaded_distance_m == pytest.approx(
        reference.metrics.loaded_distance_m * 1.8, rel=0.01
    )
    assert manual.metrics.objective > reference.metrics.objective
    assert [v.location_id for v in manual.trucks[0].visits] == ["S5", "S4", "S3", "S2", "S1"]
    assert manual.trucks[0].id == "C1-M1"

    # Two trucks instead of one is also valid, and loses on the truck-count-first objective
    # however few miles it saves.
    split = [optimized[:2], optimized[2:]]
    two = evaluated(doc, settings, out, "C1", split).manual
    assert two.valid and two.metrics.trucks == 2
    assert two.metrics.objective > reference.metrics.objective


# ---- invalid plans name concrete violations ---------------------------------------------------


def test_coverage_violations_are_concrete():
    # U is 700 mi out: no chain of legs within 500 mi reaches it, so the run left it out.
    doc = scenario(
        [("A", east(50)), ("B", north(60)), ("C", east(-40)), ("U", east(700))],
        [
            (f"O{i}", loc, "2026-09-01", "P", 6, 100)
            for i, loc in enumerate(("A", "B", "C", "U"), 1)
        ],
        [("P", 24)],
    )
    settings = FAST.model_copy(update={"k": 1})
    out = run_pipeline(doc, settings)
    cid = "C1"
    unreachable = stages_of(out)["problem"]["clusters"][0]["blocked"][0]["visit_id"]
    assert unreachable.startswith('["U"')
    routes = solved_routes(out, cid)["routes"]
    assert sorted(len(r) for r in routes) == [1, 2]
    first, *rest = sorted(routes, key=len, reverse=True)
    plan = [
        [first[0], first[0], "no-such-visit", unreachable],  # duplicate, unknown, unreachable
        *rest,
    ]
    result = evaluated(doc, settings, out, cid, plan)
    by_code = {v.code: v for v in result.manual.violations}
    assert not result.manual.valid
    assert by_code["duplicate_visit"].visit_id == first[0] and by_code["duplicate_visit"].truck == 1
    assert by_code["unknown_visit"].message == f"no-such-visit does not belong to cluster {cid}"
    assert by_code["unreachable_visit"].visit_id == unreachable
    assert "leg limit" in by_code["unreachable_visit"].message
    missing = {v.visit_id for v in result.manual.violations if v.code == "missing_visit"}
    assert missing == set(first[1:])
    for vid in missing:
        assert f"{vid} is not on any truck" in {v.message for v in result.manual.violations}
    # The duplicated visit is counted once among the planned visits.
    assert result.manual.metrics.planned_visit_count == sum(len(r) for r in rest) + 1


def test_over_capacity_names_the_truck_and_its_load():
    scenario_doc, settings = example("lesson-capacity.json")
    out = run_pipeline(scenario_doc, settings)
    cluster = out.summary.clusters[0]
    routes = solved_routes(out, cluster.id)["routes"]
    merged = [routes[0] + routes[1], *routes[2:]]
    result = evaluated(scenario_doc, settings, out, cluster.id, merged).manual
    assert codes(result) == {"over_capacity"}
    (violation,) = result.violations
    load = sum(
        t.load for t in out.summary.trucks if t.id in (f"{cluster.id}-T1", f"{cluster.id}-T2")
    )
    assert violation.truck == 1
    assert violation.message == f"truck 1 load {load} > capacity {settings.trailer_capacity}"
    assert result.metrics.trucks == cluster.trucks - 1
    assert result.trucks[0].fill > 1


def test_a_leg_over_the_limit_is_rejected_even_when_a_chain_reaches_the_stop():
    # A at 300 mi and B at 594 mi due east: B is reachable only through A.
    doc = scenario(
        [("A", east(300)), ("B", east(594))],
        [("O1", "A", "2026-09-01", "P", 5, 100), ("O2", "B", "2026-09-01", "P", 5, 100)],
        [("P", 10)],
    )
    settings = FAST.model_copy(update={"k": 1})
    out = run_pipeline(doc, settings)
    assert out.summary.validity == "valid"
    a, b = '["A","O1"]#1', '["B","O2"]#1'
    result = evaluated(doc, settings, out, "C1", [[b], [a]]).manual
    assert codes(result) == {"leg_over_limit"}
    (violation,) = result.violations
    assert violation.visit_id == b and violation.truck == 1
    assert violation.message.startswith("leg to B is 712 mi > 500 mi")


def test_window_and_horizon_violations_are_recomputed_from_raw_durations():
    scenario_doc, settings = example("lesson-windows.json")
    out = run_pipeline(scenario_doc, settings)
    routes = solved_routes(out, "C1")["routes"]
    assert len(routes) == 2
    # Everything on one truck in the solver's order: windows are missed.
    result = evaluated(scenario_doc, settings, out, "C1", [routes[0] + routes[1]]).manual
    late = [v for v in result.violations if v.code == "window_late"]
    assert late and all(v.truck == 1 and v.visit_id for v in late)
    assert all("after its window end" in v.message for v in late)
    assert codes(result) <= {"window_late", "horizon_exceeded"}

    # Two 48-mile stops with 30 min of service each, on a 06:00–09:00 day: one truck each fits,
    # both on one truck runs past the horizon.
    doc = ScenarioDocument.model_validate(
        {
            **scenario(
                [("N", north(40)), ("E", east(40))],
                [("O1", "N", "2026-09-01", "P", 1, 100), ("O2", "E", "2026-09-01", "P", 1, 100)],
                [("P", 2)],
            ).model_dump(mode="json"),
            "time_model": {
                "timezone": "America/Chicago",
                "planning_date": "2026-10-06",
                "depot_open": "06:00",
                "horizon_end": "09:00",
            },
        }
    )
    doc = doc.model_copy(
        update={
            "locations": [loc.model_copy(update={"service_minutes": 30}) for loc in doc.locations]
        }
    )
    settings = FAST.model_copy(update={"k": 1})
    out = run_pipeline(doc, settings)
    assert out.summary.validity == "valid" and out.summary.totals.trucks == 2
    n, e = '["N","O1"]#1', '["E","O2"]#1'
    result = evaluated(doc, settings, out, "C1", [[n, e]]).manual
    assert codes(result) == {"horizon_exceeded"}
    (violation,) = result.violations
    assert violation.truck == 1 and violation.visit_id is None
    assert "after the horizon end 32400 s" in violation.message
    assert result.trucks[0].end_s > 9 * 3600 and result.metrics.wait_s == 0


def test_snapshot_runs_evaluate_on_the_snapshot_and_flag_missing_legs():
    snap = parity_snapshot()
    settings = parity_settings(snap)
    doc = parity_scenario()
    out = run_pipeline(doc, settings, travel_snapshot=snap)
    solve = solved_routes(out, "C1")
    result = evaluated(doc, settings, out, "C1", solve["routes"], travel_snapshot=snap)
    assert result.manual.valid
    assert result.manual.metrics.loaded_distance_m == out.summary.totals.loaded_distance_m
    assert result.manual.metrics.drive_s == sum(t.drive_s for t in out.summary.trucks)

    # B → A has no value in the directed snapshot (A → B does).
    stages = stages_of(out)
    vid = {json.loads(v.split("#")[0])[0]: v for v in stages["problem"]["clusters"][0]["visits"]}
    plan = [[vid["B"], vid["A"], vid["C"], vid["E"]]]
    manual = evaluated(doc, settings, out, "C1", plan, travel_snapshot=snap).manual
    missing = [v for v in manual.violations if v.code == "leg_missing"]
    assert missing and missing[0].visit_id == vid["A"]
    assert "unreachable in the raw matrix" in missing[0].message
    # A truck on an unrecorded leg is counted but cannot be measured.
    assert manual.metrics.unmeasured_trucks == 1 and manual.metrics.trucks == 1
    assert manual.metrics.loaded_distance_m is None and manual.metrics.objective is None
    assert manual.trucks == []

    # The same request without the snapshot it names is refused, never estimated instead.
    with pytest.raises(EvaluationError) as error:
        evaluated(doc, settings, out, "C1", plan)
    assert error.value.code == "travel_snapshot_missing"


def test_a_travel_entry_that_disagrees_with_the_snapshot_is_reported():
    snap = parity_snapshot()
    settings = parity_settings(snap)
    doc = parity_scenario()
    out = run_pipeline(doc, settings, travel_snapshot=snap)
    request = cluster_request(
        doc,
        settings,
        stages_of(out),
        "C1",
        solved_routes(out, "C1")["routes"],
        travel_snapshot=snap,
    )
    request.travel["matrix"][0][1] = 50_000  # D → A is 100,000 m in the snapshot
    result = evaluate(request).manual
    assert "leg_mismatch" in codes(result)


def test_requests_that_do_not_describe_one_cluster_are_refused():
    scenario_doc, settings = example("lesson-capacity.json")
    out = run_pipeline(scenario_doc, settings)
    routes = solved_routes(out, "C1")["routes"]
    request = cluster_request(scenario_doc, settings, stages_of(out), "C1", routes)
    with pytest.raises(EvaluationError) as error:
        evaluate(request.model_copy(update={"plan": ClusterPlan(cluster_id="C2", routes=routes)}))
    assert error.value.code == "cluster_mismatch"
    with pytest.raises(EvaluationError) as error:
        evaluate(request.model_copy(update={"visits": request.visits[1:]}))
    assert error.value.code == "visits_missing"
    # An empty truck is not a plan: removing a truck means moving its visits.
    with pytest.raises(ValidationError):
        ClusterPlan(cluster_id="C1", routes=[routes[0], []])


# ---- the internal endpoint --------------------------------------------------------------------


def test_the_endpoint_requires_the_worker_token(monkeypatch):
    scenario_doc, settings = example("lesson-capacity.json")
    out = run_pipeline(scenario_doc, settings)
    routes = solved_routes(out, "C1")["routes"]
    body = cluster_request(scenario_doc, settings, stages_of(out), "C1", routes).model_dump(
        mode="json"
    )
    client = TestClient(app)
    monkeypatch.setenv("WORKER_TOKEN", "t" * 64)
    assert client.post("/evaluate", json=body).status_code == 401
    assert (
        client.post("/evaluate", json=body, headers={"authorization": "Bearer x"}).status_code
        == 401
    )
    ok = client.post("/evaluate", json=body, headers={"authorization": f"Bearer {'t' * 64}"})
    assert ok.status_code == 200
    assert ok.json()["manual"]["valid"] is True
    assert ok.json()["evaluator_version"] == "fillrate-evaluate/1"
    body["plan"]["cluster_id"] = "C9"
    refused = client.post("/evaluate", json=body, headers={"authorization": f"Bearer {'t' * 64}"})
    assert refused.status_code == 422 and refused.json()["detail"]["code"] == "cluster_mismatch"


def test_manual_evaluator_capability_is_validation_backed():
    behavior = next(b for b in capabilities().behaviors if b.id == "manual_evaluator")
    assert behavior.provided_by == "validation" and behavior.availability == "implemented"
    assert behavior.fixture and behavior.fixture.startswith("tests/test_evaluate.py::")


def test_lower_bound_and_counts_follow_the_cluster():
    scenario_doc, settings = example("lesson-capacity.json")
    out = run_pipeline(scenario_doc, settings)
    routes = solved_routes(out, "C1")["routes"]
    m = evaluated(scenario_doc, settings, out, "C1", routes[:-1]).manual.metrics
    cluster = out.summary.clusters[0]
    assert m.capacity_lower_bound == math.ceil(cluster.load / settings.trailer_capacity)
    assert m.visit_count == cluster.visit_count
    assert m.planned_visit_count == cluster.visit_count - len(routes[-1])


def test_request_contract_round_trips():
    scenario_doc, settings = example("lesson-capacity.json")
    out = run_pipeline(scenario_doc, settings)
    routes = solved_routes(out, "C1")["routes"]
    request = cluster_request(scenario_doc, settings, stages_of(out), "C1", routes)
    again = EvaluateRequest.model_validate_json(request.model_dump_json())
    assert evaluate(again) == evaluate(request)
    assert miles_to_m(500) == settings.max_leg_m
