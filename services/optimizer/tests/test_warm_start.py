"""Verified warm starts (spec §3, §10, M6).

Capability fixtures prove what pinned PyVRP 0.14.0 does with an initial solution; pipeline tests
prove Fillrate's compatibility rule, validator gate, recorded outcomes, identities and replay.
"""

import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pytest
import pyvrp
from pyvrp.stop import MaxIterations

from fillrate_optimizer import lesson_allocation, pipeline
from fillrate_optimizer.artifact_codec import decode_travel
from fillrate_optimizer.canonical import content_hash
from fillrate_optimizer.capabilities import BEHAVIORS
from fillrate_optimizer.evaluate import cluster_request, evaluate
from fillrate_optimizer.loads import (
    PartitionProblem,
    PartitionVisit,
    WarmStartRejected,
    build_partition_model,
    initial_solution,
    solve_partition,
)
from fillrate_optimizer.model import RunSettings, WarmStartPlan, WarmStartSource
from fillrate_optimizer.pipeline import PipelineError, run_pipeline
from fillrate_optimizer.replay import DETERMINISTIC_STAGES, expected_record, replay
from fillrate_optimizer.warmstart import plan_from_baseline, plan_from_summary

SCENARIO = lesson_allocation.build()
SETTINGS = lesson_allocation.SETTINGS.model_copy(update={"solver_max_iterations": 50})
SOURCE = WarmStartSource(run_id="source-run")


def partition(n: int = 9, seed: int = 1, capacity: int = 5_300) -> PartitionProblem:
    rng = np.random.default_rng(seed)
    points = rng.uniform(0, 200_000, size=(n + 1, 2))
    distance = np.rint(np.linalg.norm(points[:, None] - points[None], axis=2)).astype(np.int64)
    visits = [PartitionVisit(f"v{i}", i, 900 + 150 * (i % 5)) for i in range(1, n + 1)]
    return PartitionProblem(distance, visits, capacity, max_leg_m=10**6, truck_penalty=0)


# ---- capability fixtures: pinned PyVRP behavior -----------------------------------------------


def test_pyvrp_accepts_an_initial_solution_built_from_route_lists_on_the_same_data():
    problem = partition()
    data = build_partition_model(problem).data()
    routes = [[0, 1, 2], [3, 4, 5], [6, 7, 8]]  # client indices, depot excluded
    solution = pyvrp.Solution(data, routes)
    assert solution.is_complete() and solution.is_feasible()
    assert [[a.idx for a in r if a.is_client()] for r in solution.routes()] == routes
    result = pyvrp.solve(data, MaxIterations(0), seed=0, initial_solution=solution)
    assert result.best == solution  # no iterations: the incumbent is the initial solution


@pytest.mark.parametrize("seed", range(5))
@pytest.mark.parametrize("iterations", [1, 10, 200])
def test_feasible_initial_solution_is_never_worsened(seed, iterations):
    """The pinned search starts with the initial solution as its best and replaces it only by a
    strictly cheaper candidate, so with any iteration budget the result is never worse."""
    problem = partition(seed=seed)
    data = build_partition_model(problem).data()
    one_each = [[k] for k in range(len(problem.visits))]  # feasible but poor
    start, cost = initial_solution(data, one_each)
    result = pyvrp.solve(data, MaxIterations(iterations), seed=seed, initial_solution=start)
    assert result.is_feasible()
    assert result.cost() <= cost
    # Through Fillrate's adapter: the same guarantee, with the initial cost recorded.
    solved = solve_partition(
        PartitionProblem(**{**problem.__dict__, "max_iterations": iterations, "seed": seed}),
        one_each,
    )
    assert solved.initial_cost == cost
    assert solved.cost is not None and solved.cost <= solved.initial_cost


def test_pyvrp_accepts_infeasible_incomplete_and_mismatched_initial_solutions_silently():
    """Why Fillrate refuses rather than relies on PyVRP: none of these raise."""
    problem = partition(capacity=3_000)
    data = build_partition_model(problem).data()
    everything = [list(range(len(problem.visits)))]
    infeasible = pyvrp.Solution(data, everything)
    assert not infeasible.is_feasible()
    pyvrp.solve(data, MaxIterations(5), initial_solution=infeasible)  # accepted
    incomplete = pyvrp.Solution(data, [[0, 1]])
    assert not incomplete.is_complete()
    pyvrp.solve(data, MaxIterations(5), initial_solution=incomplete)  # accepted
    other = build_partition_model(partition(n=4)).data()
    foreign = pyvrp.Solution(other, [[0, 1], [2, 3]])
    pyvrp.solve(data, MaxIterations(5), initial_solution=foreign)  # accepted, wrong problem
    # Only malformed route lists raise.
    with pytest.raises(RuntimeError, match="more than once"):
        pyvrp.Solution(data, [[0], [0]])
    with pytest.raises(ValueError, match="not understood"):
        pyvrp.Solution(data, [[len(problem.visits)]])


@pytest.mark.parametrize(
    "routes",
    [
        [list(range(9))],  # over capacity
        [[0, 1]],  # incomplete
        [[0, 1], [1, 2, 3, 4, 5, 6, 7, 8]],  # duplicate
        [[0, 1, 2, 3, 4, 5, 6, 7, 9]],  # unknown client
        [[], list(range(9))],  # empty route
    ],
)
def test_fillrate_refuses_initial_solutions_that_are_not_complete_and_feasible(routes):
    problem = partition(capacity=3_000)
    with pytest.raises(WarmStartRejected):
        solve_partition(problem, routes)


def test_capability_entry_is_native_with_its_rule_and_fixture():
    entry = next(b for b in BEHAVIORS if b.id == "warm_start")
    assert entry.provided_by == "native"
    name = test_feasible_initial_solution_is_never_worsened.__name__
    assert entry.fixture == f"tests/{Path(__file__).name}::{name}"
    assert any("Compatibility rule" in r for r in entry.restrictions)


# ---- pipeline: compatibility rule, validator gate, outcomes ------------------------------------


@pytest.fixture(scope="module")
def cold():
    return run_pipeline(SCENARIO, SETTINGS)


@pytest.fixture(scope="module")
def plan(cold):
    return plan_from_summary(cold.summary.model_dump(mode="json"), SOURCE)


def warm_run(plan_doc: WarmStartPlan, **update):
    config = SETTINGS.model_copy(update={"warm_start": SOURCE, **update})
    return run_pipeline(SCENARIO, config, warm_start_plan=plan_doc)


def outcomes(output):
    return {c.id: c.warm_start for c in output.summary.clusters if c.warm_start}


def edited(plan_doc: WarmStartPlan, change) -> WarmStartPlan:
    document = plan_doc.model_dump(mode="json")
    change(document)
    return WarmStartPlan.model_validate(document)


def test_identical_rerun_uses_every_cluster_and_is_never_worse(cold, plan):
    warm = warm_run(plan)
    found = outcomes(warm)
    assert found and all(o.status == "used" and o.reason is None for o in found.values())
    source_cost = {
        s["cluster_id"]: s["cost"]
        for a in cold.artifacts
        if a.stage == "solve"
        for s in a.payload["clusters"]
    }
    for cluster_id, outcome in found.items():
        # The mapped plan on the identical problem costs exactly what the source solve found.
        assert outcome.initial_cost == source_cost[cluster_id]
        assert outcome.final_cost <= outcome.initial_cost
        assert outcome.source_cluster_id == cluster_id
    assert warm.summary.validity == "valid"
    assert warm.summary.totals.trucks <= cold.summary.totals.trucks
    assert warm.summary.warm_start.used == len(found) and warm.summary.warm_start.skipped == 0
    assert any(d.code == "warm_start" for d in warm.summary.diagnostics)


def test_warm_start_is_solve_provenance_not_problem_identity(cold, plan):
    warm = warm_run(plan)
    cold_hashes = {a.stage: a.manifest for a in cold.artifacts}
    warm_hashes = {a.stage: a.manifest for a in warm.artifacts}
    for stage in (*DETERMINISTIC_STAGES, "travel", "problem"):
        assert warm_hashes[stage]["input_hash"] == cold_hashes[stage]["input_hash"]
        assert warm_hashes[stage]["output_hash"] == cold_hashes[stage]["output_hash"]
    record = warm_hashes["warm_start"]
    plan_id = content_hash(plan.model_dump(mode="json"))
    assert record["output_hash"] == plan_id == warm.summary.warm_start.plan_id
    solve = warm_hashes["solve"]
    assert plan_id in solve["parent_hashes"]
    assert solve["effective_settings"]["warm_start"] == {"kind": "run", "run_id": "source-run"}
    assert "warm_start" not in cold_hashes["solve"]["effective_settings"]
    assert solve["input_hash"] != cold_hashes["solve"]["input_hash"]
    # Unset, the setting is left out of every dump, so earlier documents keep their hashes.
    assert "warm_start" not in RunSettings().model_dump(mode="json")
    assert "warm_start" not in cold.summary.model_dump(mode="json")


def test_changed_travel_skips_every_cluster(plan):
    warm = warm_run(plan, travel_circuity=1.3)
    assert {o.reason for o in outcomes(warm).values()} == {"travel_changed"}
    assert all(o.status == "skipped" for o in outcomes(warm).values())
    assert warm.summary.warm_start.used == 0


def test_changed_visit_set_demand_and_invalid_source_are_skipped_with_reasons(plan):
    first = plan.clusters[0]

    def drop_visit(doc):
        doc["clusters"][0]["routes"][0].pop()

    def change_load(doc):
        doc["clusters"][0]["routes"][0][0]["load"] += 1

    def invalidate(doc):
        doc["clusters"][0].update(status="no_candidate", routes=[])

    for change, reason in (
        (drop_visit, "visit_set_changed"),
        (change_load, "demand_changed"),
        (invalidate, "source_invalid"),
    ):
        found = outcomes(warm_run(edited(plan, change)))
        assert found[first.cluster_id].status == "skipped"
        assert found[first.cluster_id].reason == reason
        others = [o for cid, o in found.items() if cid != first.cluster_id]
        assert others and all(o.status == "used" for o in others)


def test_validator_gate_runs_on_the_new_problem(cold, plan):
    """A smaller trailer keeps every visit and load but makes a source truck overweight: the
    mapped plan is rejected by the independent validator, and the cluster is solved cold."""
    loads = [t.load for t in cold.summary.trucks]
    location_load = defaultdict(int)
    for t in cold.summary.trucks:
        for v in t.visits:
            location_load[v.location_id] += v.load
    capacity = max(location_load.values())  # no visit splits differently
    assert capacity < max(loads)
    warm = warm_run(plan, trailer_capacity=capacity)
    found = outcomes(warm)
    rejected = [o for o in found.values() if o.reason == "invalid_on_new_problem"]
    assert rejected and all("capacity" in o.detail for o in rejected)
    assert warm.summary.validity == "valid"  # the cold solves still validate


def test_solver_rejection_falls_back_to_a_cold_solve(plan, monkeypatch):
    """Defensive rule 5: if PyVRP does not see a validated plan as feasible, solve cold."""

    def overweight(plan_doc, run_travel, meta, prob, *args):
        return {"status": "used", "reason": None, "source_cluster_id": meta["id"]}, [
            list(range(len(prob["visits"])))
        ]

    monkeypatch.setattr(pipeline, "warm_start_for", overweight)
    warm = warm_run(plan)
    found = outcomes(warm)
    assert found and all(
        o.status == "skipped" and o.reason == "solver_rejected" for o in found.values()
    )
    assert warm.summary.validity == "valid"


def test_source_binding_errors(plan):
    with pytest.raises(PipelineError) as unbound:
        run_pipeline(SCENARIO, SETTINGS, warm_start_plan=plan)
    assert unbound.value.code == "warm_start_unbound"
    with pytest.raises(PipelineError) as mismatch:
        run_pipeline(
            SCENARIO,
            SETTINGS.model_copy(update={"warm_start": WarmStartSource(run_id="other")}),
            warm_start_plan=plan,
        )
    assert mismatch.value.code == "warm_start_source_mismatch"

    def missing(_source):
        raise RuntimeError("run_not_found")

    with pytest.raises(PipelineError) as unavailable:
        run_pipeline(
            SCENARIO,
            SETTINGS.model_copy(update={"warm_start": SOURCE}),
            warm_start_loader=missing,
        )
    assert unavailable.value.code == "warm_start_unavailable"
    loaded = run_pipeline(
        SCENARIO,
        SETTINGS.model_copy(update={"warm_start": SOURCE}),
        warm_start_loader=lambda source: plan.model_dump(mode="json"),
    )
    assert loaded.summary.warm_start.used > 0


def test_plan_from_summary_keeps_service_order_and_only_validated_routes(cold, plan):
    trucks = defaultdict(list)
    for t in cold.summary.trucks:
        trucks[t.cluster_id].append([v.visit_id for v in t.visits])
    for cluster in plan.clusters:
        assert [[v.visit_id for v in r] for r in cluster.routes] == trucks.get(
            cluster.cluster_id, []
        )
    assert plan.travel.mode == "estimated" and plan.travel.circuity == SETTINGS.travel_circuity


# ---- saved manual baselines as a source -------------------------------------------------------


def test_warm_start_source_kinds_keep_run_identity_and_name_exactly_one_id():
    assert WarmStartSource(run_id="r").model_dump(mode="json") == {"kind": "run", "run_id": "r"}
    baseline = WarmStartSource(kind="manual_baseline", baseline_id="b")
    assert baseline.model_dump(mode="json") == {"kind": "manual_baseline", "baseline_id": "b"}
    for bad in (
        {"kind": "run"},
        {"kind": "run", "run_id": "r", "baseline_id": "b"},
        {"kind": "manual_baseline", "run_id": "r"},
        {"kind": "manual_baseline"},
    ):
        with pytest.raises(ValueError):
            WarmStartSource(**bad)


BASELINE = WarmStartSource(kind="manual_baseline", baseline_id="baseline-1")


def saved_baseline(cold, cluster_id: str, valid_only: bool = True) -> dict:
    """What the web stores for a saved manual baseline of one cluster: the plan and the evaluator's
    outcome for it, as the worker transport returns them."""
    stages = {a.stage: a.payload for a in cold.artifacts}
    stages["travel"] = decode_travel(stages["travel"])
    solve = next(c for c in stages["solve"]["clusters"] if c["cluster_id"] == cluster_id)
    request = cluster_request(SCENARIO, SETTINGS, stages, cluster_id, solve["routes"])
    result = evaluate(request).manual
    assert result.valid or not valid_only
    return {
        "cluster_id": cluster_id,
        "routes": solve["routes"],
        "valid": result.valid,
        "trucks": [t.model_dump(mode="json") for t in result.trucks],
        "settings": SETTINGS.model_dump(mode="json"),
    }


@pytest.fixture(scope="module")
def baseline(cold):
    cluster = next(
        c.cluster_id
        for c in plan_from_summary(cold.summary.model_dump(mode="json"), SOURCE).clusters
        if c.routes
    )
    return saved_baseline(cold, cluster)


def test_manual_baseline_warm_starts_its_cluster_and_is_never_worse(cold, baseline):
    source = plan_from_baseline(baseline, BASELINE)
    assert source.source == BASELINE
    assert [c.cluster_id for c in source.clusters] == [baseline["cluster_id"]]
    assert source.clusters[0].status == "validated"
    config = SETTINGS.model_copy(update={"warm_start": BASELINE})
    warm = run_pipeline(SCENARIO, config, warm_start_plan=source)
    found = outcomes(warm)
    used = [cid for cid, o in found.items() if o.status == "used"]
    assert used == [baseline["cluster_id"]]
    assert all(o.reason == "visit_set_changed" for cid, o in found.items() if cid not in used)
    cluster = next(c for c in warm.summary.clusters if c.id == used[0])
    assert cluster.warm_start.final_cost <= cluster.warm_start.initial_cost
    assert warm.summary.warm_start.source == BASELINE
    assert (warm.summary.warm_start.used, warm.summary.warm_start.skipped) == (1, len(found) - 1)
    message = next(d.message for d in warm.summary.diagnostics if d.code == "warm_start")
    assert "manual baseline baseline-1" in message


def test_manual_baseline_goes_through_the_validator_gate(cold, baseline):
    """A baseline is judged on the new problem like any source: a smaller trailer keeps its visits
    and loads but makes a truck overweight, so the cluster is solved cold with the reason."""
    source = plan_from_baseline(baseline, BASELINE)
    loads = {v["visit_id"]: v["load"] for t in baseline["trucks"] for v in t["visits"]}
    capacity = max(loads.values())
    assert capacity < max(t["load"] for t in baseline["trucks"])
    config = SETTINGS.model_copy(update={"warm_start": BASELINE, "trailer_capacity": capacity})
    warm = run_pipeline(SCENARIO, config, warm_start_plan=source)
    outcome = outcomes(warm)[baseline["cluster_id"]]
    assert outcome.status == "skipped" and outcome.reason == "invalid_on_new_problem"
    assert warm.summary.validity == "valid"


def test_invalid_baseline_is_never_a_source(baseline):
    with pytest.raises(ValueError, match="invalid"):
        plan_from_baseline({**baseline, "valid": False}, BASELINE)


def test_manual_baseline_replays_from_its_bundled_plan(tmp_path, baseline):
    source = plan_from_baseline(baseline, BASELINE)
    expected = write_warm_bundle(tmp_path, source, BASELINE)
    assert expected["warm_start"]["source"] == {
        "kind": "manual_baseline",
        "baseline_id": "baseline-1",
    }
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == []
    assert lines[-1] == "REPLAY OK"


# ---- replay ------------------------------------------------------------------------------------


def write_warm_bundle(root: Path, plan_doc: WarmStartPlan, source=SOURCE) -> dict:
    """What `packages/db/src/replay.ts` writes for a warm-started run."""
    config = SETTINGS.model_copy(update={"warm_start": source})
    output = run_pipeline(SCENARIO, config, warm_start_plan=plan_doc)
    (root / "artifacts").mkdir(parents=True)
    (root / "scenario.json").write_text(json.dumps(SCENARIO.model_dump(mode="json")))
    (root / "settings.json").write_text(json.dumps(config.model_dump(mode="json")))
    expected = expected_record("run-2", output, config)
    (root / "expected.json").write_text(json.dumps(expected))
    for artifact in output.artifacts:
        if artifact.stage in DETERMINISTIC_STAGES:
            (root / "artifacts" / f"{artifact.stage}.json").write_text(
                json.dumps({"manifest": artifact.manifest, "payload": artifact.payload})
            )
        if artifact.stage == "warm_start":
            (root / "warm-start.json").write_text(json.dumps(artifact.payload))
    return expected


def test_warm_started_run_replays_from_its_bundled_plan(tmp_path, plan):
    expected = write_warm_bundle(tmp_path, plan)
    assert expected["warm_start"]["plan_id"] == content_hash(plan.model_dump(mode="json"))
    assert all(v == ["used", None] for v in expected["warm_start"]["outcomes"].values())
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == []
    assert "warm start   plan identity verified" in lines
    assert "warm outcomes reproduced" in lines
    assert lines[-1] == "REPLAY OK"


def test_replay_refuses_a_warm_started_run_without_its_exact_plan(tmp_path, plan):
    write_warm_bundle(tmp_path, plan)
    (tmp_path / "warm-start.json").unlink()
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == ["warm_start"]
    assert "warm-start.json is missing" in lines[-1]

    extra = {"cluster_id": "C99", "status": "no_candidate", "location_ids": [], "routes": []}
    tampered = edited(plan, lambda d: d["clusters"].append(extra))
    (tmp_path / "warm-start.json").write_text(json.dumps(tampered.model_dump(mode="json")))
    lines = []
    assert replay(tmp_path, out=lines.append) == ["warm_start"]
    assert "IDENTITY DIFFERS" in lines[0]
