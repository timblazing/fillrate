"""Heterogeneous fleet in the fulfillment pipeline (spec §3, §8b, §10, M6).

Vehicle types are native PyVRP `VehicleType`s per cluster; counts are fleet-wide, which PyVRP
cannot express across independent clusters, so Fillrate solves clusters in order against the
vehicles left and checks the sum independently (docs/decisions.md).
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from fillrate_optimizer import fleet_example
from fillrate_optimizer.canonical import content_hash
from fillrate_optimizer.evaluate import EvaluationError
from fillrate_optimizer.loads import (
    PartitionProblem,
    PartitionVehicle,
    PartitionVisit,
    WarmStartRejected,
    fleet_monetary_objective,
    monetary_objective,
    solve_partition,
)
from fillrate_optimizer.model import RunSettings, ScenarioDocument, WarmStartSource
from fillrate_optimizer.pipeline import check_fleet, run_pipeline
from fillrate_optimizer.preflight import preflight_checks
from fillrate_optimizer.replay import expected_record, replay
from fillrate_optimizer.warmstart import plan_from_summary

from .conftest import east
from .test_evaluate import codes, evaluated, solved_routes, stages_of
from .test_pipeline import FAST, WARN, scenario
from .test_replay import edit, write_bundle

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
TRAILER = {"id": "trailer", "label": "53 ft trailer", "capacity": 5_300}
BOX = {"id": "box", "label": "26 ft box truck", "capacity": 2_600}


def stops(spec, pieces=6, sku="P"):
    """Locations at the given miles east of the depot, one order of `pieces` each."""
    locations = [(f"S{i}", east(miles)) for i, miles in enumerate(spec)]
    orders = [
        (f"O{i}", loc, "2026-10-01", sku, pieces, 1_000) for i, (loc, _) in enumerate(locations)
    ]
    return locations, orders


def six_stops():
    # Six 24 ft stops: a box (26 ft) holds one, a trailer (53 ft) two.
    locations, orders = stops([20, 40, 60, 80, 100, 120])
    return scenario(locations, orders, [("P", 100)])


def derive(base: RunSettings, **update) -> RunSettings:
    """`base` with changes, validated (`model_copy(update=...)` would not validate a fleet)."""
    return RunSettings.model_validate({**base.model_dump(mode="json"), **update})


def fleet_settings(*types, **update) -> RunSettings:
    return derive(FAST, k=1, fleet=[dict(t) for t in types], **update)


def validated(**update) -> RunSettings:
    return RunSettings.model_validate({**FAST.model_dump(mode="json"), "k": 1, **update})


# ---- absent fleet is today's single trailer, byte for byte ---------------------------------------

GOLDEN = json.loads((Path(__file__).parent / "data/absent_fleet_golden.json").read_text())


@pytest.mark.parametrize("name", sorted(GOLDEN))
def test_absent_fleet_keeps_stage_identities_and_results_byte_identical(name):
    """Golden digests recorded from the pipeline before this feature (same pinned versions):
    every stage's output, and every input identity that does not depend on measured runtimes."""
    document = json.loads((EXAMPLES / f"{name}.json").read_text())
    settings = RunSettings.model_validate(
        {**document["settings"], "solver_max_iterations": 200, "solver_time_limit_s": 30}
    )
    out = run_pipeline(
        ScenarioDocument.model_validate(document["scenario"]),
        settings,
        execution_id="g",
        now_ms=lambda: 0,
    )
    from fillrate_optimizer.replay import stage_digest

    assert "fleet" not in settings.model_dump(mode="json")
    assert "fleet" not in document["settings"]
    for artifact in out.artifacts:
        recorded = GOLDEN[name][artifact.stage]
        assert stage_digest(artifact.payload) == recorded["output_digest"], artifact.stage
        if recorded["input_hash"]:
            assert artifact.manifest["input_hash"] == recorded["input_hash"], artifact.stage
    assert "fleet_usage" not in out.summary.model_dump(mode="json")
    assert all("vehicle_type_id" not in t for t in out.summary.model_dump(mode="json")["trucks"])


def test_fleet_settings_validation():
    with pytest.raises(ValidationError, match="unique"):
        validated(fleet=[TRAILER, TRAILER])
    with pytest.raises(ValidationError):
        validated(fleet=[])
    with pytest.raises(ValidationError):
        validated(fleet=[{**TRAILER, "count": 0}])
    with pytest.raises(ValidationError, match="every type"):
        validated(objective="cost", fleet=[TRAILER])
    # A fleet carries the cost rates, so the global cost rates are not required with it.
    validated(objective="cost", fleet=[{**TRAILER, "fixed_cost_cents": 1, "per_mile_cents": 2}])
    # Absent or null `count` is unlimited, today's trailer semantics.
    assert validated(fleet=[TRAILER]).fleet[0].count is None


# ---- types bind natively ------------------------------------------------------------------------


def test_vehicle_types_bind_capacity_and_fill_is_per_type():
    settings = fleet_settings({**TRAILER, "count": 1}, BOX)
    out = run_pipeline(six_stops(), settings)
    summary = out.summary
    assert (summary.validity, summary.coverage) == ("valid", "complete")
    capacity = {"trailer": 5_300, "box": 2_600}
    for truck in summary.trucks:
        assert truck.load <= capacity[truck.vehicle_type_id]
        assert truck.fill == truck.load / capacity[truck.vehicle_type_id]
    by_type = {u.id: u for u in summary.fleet_usage}
    # Truck-count-first: the single trailer takes two stops, the other four need a box each.
    assert (by_type["trailer"].trucks, by_type["box"].trucks) == (1, 4)
    assert by_type["trailer"].load == 4_800 and by_type["trailer"].avg_fill == 4_800 / 5_300
    assert by_type["box"].avg_fill == 2_400 / 2_600
    assert summary.totals.trucks == 5
    assert summary.totals.utilization == 14_400 / (5_300 + 4 * 2_600)
    # The largest type sets the capacity lower bound; trailers only would need 3 trucks.
    assert summary.totals.capacity_lower_bound == 3
    # Recorded per type in the problem artifact, and per route in the solve artifact.
    problem = next(a for a in out.artifacts if a.stage == "problem").payload["clusters"][0]
    assert [t["id"] for t in problem["vehicle_types"]] == ["trailer", "box"]
    solve = next(a for a in out.artifacts if a.stage == "solve").payload["clusters"][0]
    assert sorted(solve["vehicle_types"]) == ["box"] * 4 + ["trailer"]
    assert any(d.code == "fleet_counts" for d in summary.diagnostics)


def test_a_single_unlimited_type_is_exactly_the_trailer():
    base = run_pipeline(six_stops(), FAST.model_copy(update={"k": 1}))
    fleet = run_pipeline(six_stops(), fleet_settings(TRAILER))

    def rows(out):
        return [(t.load, t.distance_m, [v.visit_id for v in t.visits]) for t in out.summary.trucks]

    assert rows(fleet) == rows(base)
    assert fleet.summary.clusters[0].truck_penalty == base.summary.clusters[0].truck_penalty
    assert fleet.summary.totals.utilization == base.summary.totals.utilization


def test_every_type_carries_the_same_truck_count_first_penalty():
    """F = n·L + 1 on every type: with equal fixed costs only the number of trucks counts first,
    so a fleet that can still use the big type needs as few trucks as trailers alone."""
    base = run_pipeline(six_stops(), FAST.model_copy(update={"k": 1}))
    fleet = run_pipeline(six_stops(), fleet_settings(TRAILER, BOX))
    problem = next(a for a in fleet.artifacts if a.stage == "problem").payload["clusters"][0]
    n, leg = len(problem["visits"]), fleet.summary.settings.max_leg_m
    assert [t["fixed_cost"] for t in problem["vehicle_types"]] == [n * leg + 1] * 2
    assert problem["distance_bound_m"] == n * leg
    assert fleet.summary.totals.trucks == base.summary.totals.trucks == 3


# ---- cost objective in cents --------------------------------------------------------------------


def test_fleet_monetary_objective_reduces_to_the_single_type_conversion():
    for truck, mile in ((45_000, 320), (0, 0), (5, 0), (0, 7), (12_345, 678)):
        single = monetary_objective(truck, mile)
        fleet = fleet_monetary_objective([(truck, mile)])
        assert fleet.coefficients == [(single.truck_penalty, single.distance_cost)]
        assert (fleet.cents_numerator, fleet.cents_denominator) == (
            single.cents_numerator,
            single.cents_denominator,
        )
    mixed = fleet_monetary_objective([(45_000, 320), (12_000, 210)])
    for (fixed, per_mile), (a, b) in zip(
        [(45_000, 320), (12_000, 210)], mixed.coefficients, strict=True
    ):
        # Exact: objective × numerator / denominator is cents for every type.
        assert a * mixed.cents_numerator == fixed * 201_168
        assert b * mixed.cents_numerator == per_mile * 125
    with pytest.raises(ValueError):
        fleet_monetary_objective([])


def test_one_type_cost_objective_equals_the_global_rates():
    scenario_doc = fleet_example.build()
    base = run_pipeline(scenario_doc, fleet_example.BASELINE)
    fleet = run_pipeline(
        scenario_doc,
        derive(
            fleet_example.BASELINE,
            fleet=[{**TRAILER, "fixed_cost_cents": 45_000, "per_mile_cents": 320}],
            cost_per_truck_cents=None,
            cost_per_mile_cents=None,
        ),
    )

    def solve(out):
        return next(a for a in out.artifacts if a.stage == "solve").payload["clusters"][0]

    assert solve(fleet)["cost"] == solve(base)["cost"]
    assert [t.load for t in fleet.summary.trucks] == [t.load for t in base.summary.trucks]


@pytest.fixture(scope="module")
def mixed():
    scenario_doc, settings = fleet_example.build(), fleet_example.SETTINGS
    return scenario_doc, settings, run_pipeline(scenario_doc, settings)


def test_the_cost_objective_prices_each_truck_by_its_own_type(mixed):
    scenario_doc, settings, out = mixed
    solve = solved_routes(out, "C1")
    result = evaluated(
        scenario_doc, settings, out, "C1", solve["routes"], vehicle_types=solve["vehicle_types"]
    )
    rates = {t.id: t for t in settings.fleet}
    expected = sum(
        rates[t.vehicle_type_id].fixed_cost_cents
        + rates[t.vehicle_type_id].per_mile_cents * t.distance_m / 1609.344
        for t in out.summary.trucks
    )
    assert result.reference.metrics.objective == solve["cost"]
    assert result.reference.metrics.objective_cents == pytest.approx(expected, rel=1e-9)


# ---- the independent validator -----------------------------------------------------------------


def test_evaluating_the_optimized_fleet_routes_reproduces_the_run(mixed):
    scenario_doc, settings, out = mixed
    solve = solved_routes(out, "C1")
    result = evaluated(
        scenario_doc, settings, out, "C1", solve["routes"], vehicle_types=solve["vehicle_types"]
    )
    recorded = [t.model_dump(mode="json") for t in out.summary.trucks]
    assert [t.model_dump(mode="json") for t in result.reference.trucks] == recorded
    assert result.manual.valid and result.manual.violations == []
    assert [(t.vehicle_type_id, t.fill) for t in result.manual.trucks] == [
        (t.vehicle_type_id, t.fill) for t in out.summary.trucks
    ]


def test_validator_rejects_wrong_capacity_unknown_type_and_too_many_trucks(mixed):
    scenario_doc, settings, out = mixed
    solve = solved_routes(out, "C1")
    routes, types = solve["routes"], list(solve["vehicle_types"])

    def run(types_):
        return evaluated(scenario_doc, settings, out, "C1", routes, vehicle_types=types_).manual

    big = next(i for i, t in enumerate(types) if t == "trailer-53")
    loads = {t.id.split("-T")[1]: t.load for t in out.summary.trucks}
    assert loads[str(big + 1)] > 2_600
    as_box = list(types)
    as_box[big] = "box-26"  # the trailer's load does not fit a box truck
    over = run(as_box)
    assert not over.valid and "over_capacity" in codes(over)
    assert "box-26" in over.violations[0].message or "26 ft" in over.violations[0].message

    assert "unknown_vehicle_type" in codes(run(["ghost"] + types[1:]))
    # Eleven trucks, all typed trailer: the count is 3.
    assert "fleet_count_exceeded" in codes(run(["trailer-53"] * len(types)))
    # Eleven trucks typed alike but not exceeding capacity never hides a count: boxes only is 8.
    boxes = run(["box-26"] * len(types))
    assert "fleet_count_exceeded" in codes(boxes) and "over_capacity" in codes(boxes)


def test_a_plan_without_the_run_fleet_types_is_refused(mixed):
    scenario_doc, settings, out = mixed
    solve = solved_routes(out, "C1")
    for types in (None, solve["vehicle_types"][:-1]):
        with pytest.raises(EvaluationError) as refused:
            evaluated(scenario_doc, settings, out, "C1", solve["routes"], vehicle_types=types)
        assert refused.value.code == "vehicle_types_mismatch"
    plain = run_pipeline(six_stops(), FAST.model_copy(update={"k": 1}))
    routes = solved_routes(plain, "C1")["routes"]
    with pytest.raises(EvaluationError) as unexpected:
        evaluated(
            six_stops(), FAST.model_copy(update={"k": 1}), plain, "C1", routes,
            vehicle_types=["trailer"] * len(routes),
        )  # fmt: skip
    assert unexpected.value.code == "vehicle_types_unexpected"


# ---- counts are fleet-wide ----------------------------------------------------------------------


def two_regions():
    """Two far-apart regions of two 48 ft stops each: every stop needs its own trailer."""
    locations = [("E1", east(60)), ("E2", east(80)), ("W1", east(-60)), ("W2", east(-80))]
    orders = [(f"O{i}", loc, "2026-10-01", "P", 12, 1_000) for i, (loc, _) in enumerate(locations)]
    return scenario(locations, orders, [("P", 100)])


def test_counts_are_fleet_wide_across_clusters():
    settings = derive(FAST, k=2)
    enough = run_pipeline(two_regions(), derive(settings, fleet=[{**TRAILER, "count": 4}]))
    assert enough.summary.validity == "valid" and enough.summary.totals.trucks == 4
    assert enough.summary.fleet_usage[0].trucks == 4
    solves = next(a for a in enough.artifacts if a.stage == "solve").payload["clusters"]
    # The second cluster was solved against what the first left.
    assert [c["available"]["trailer"] for c in solves] == [4, 2]

    tight = run_pipeline(two_regions(), derive(settings, fleet=[{**TRAILER, "count": 3}]))
    solves = next(a for a in tight.artifacts if a.stage == "solve").payload["clusters"]
    assert [c["available"]["trailer"] for c in solves] == [3, 1]
    assert tight.summary.validity == "invalid" and tight.summary.coverage == "partial"
    assert tight.summary.totals.trucks <= 3  # never more than the fleet, even when invalid
    assert tight.summary.clusters[1].status == "no_candidate"
    assert any(d.code == "partial_plan" for d in tight.summary.diagnostics)
    unplanned = {u.reason for u in tight.summary.unplanned}
    assert unplanned == {"no_valid_candidate"}


def test_the_fleet_wide_check_is_independent_of_the_solves():
    """Even if every per-cluster solve respected its own bound, the sum is verified."""
    settings = derive(FAST, fleet=[{**TRAILER, "count": 2}, BOX])

    def row(type_id):
        return {"vehicle_type": type_id}

    clusters = [{"trucks": [row("trailer"), row("trailer")]}, {"trucks": [row("trailer")]}]
    result = check_fleet(settings, clusters)
    assert result["usage"] == {"trailer": 3, "box": 0}
    assert result["violations"] == ["3 53 ft trailer trucks exceed the fleet count 2"]
    assert check_fleet(settings, clusters[:1])["violations"] == []


def test_a_type_with_no_vehicles_left_gives_no_candidate_not_a_crash():
    visits = [PartitionVisit("v1", 1, 1_000)]
    import numpy as np

    problem = PartitionProblem(
        np.array([[0, 1000], [1000, 0]], dtype=np.int64),
        visits,
        5_300,
        max_leg_m=10**6,
        truck_penalty=0,
        fleet=(PartitionVehicle("t", 5_300, 0, 1, 1),),
    )
    result = solve_partition(problem)
    assert not result.solver_feasible and result.routes == [] and result.vehicle_types == []


# ---- preflight against the largest type ---------------------------------------------------------


def test_oversize_checks_use_the_largest_vehicle_type():
    products = [
        {"id": "P", "label": "Pallet", "linear_feet_per_piece": 400},
        {"id": "ROLL", "label": "Long roll", "linear_feet_per_piece": 3_000},
    ]
    locations = [("A", east(30)), ("B", east(50))]
    orders = [
        ("O1", "A", "2026-10-01", "ROLL", 1, 1_000),  # one 30 ft piece
        ("O2", "B", "2026-10-01", "P", 7, 1_000),  # 28 ft of pallets at one stop
    ]
    doc = scenario(locations, orders, [("ROLL", 5), ("P", 50)], products)
    boxes = derive(FAST, k=1, fleet=[BOX], preflight=WARN.model_dump(mode="json"))
    both = derive(boxes, fleet=[BOX, TRAILER])

    found = {f.check: f for f in preflight_checks(doc, boxes)}
    assert found["oversize_stop"].location_ids == ["A", "B"]  # both exceed the 26 ft box
    assert not any(f.check == "oversize_stop" for f in preflight_checks(doc, both))

    # The indivisible 30 ft piece cannot ride any box truck: excluded, never split.
    out = run_pipeline(doc, boxes)
    piece = next(u for u in out.summary.unplanned if u.reason == "oversize_piece")
    assert "largest vehicle type holds 26 ft" in piece.evidence
    assert not any(u.reason == "oversize_piece" for u in run_pipeline(doc, both).summary.unplanned)
    # Stops split greedily to the largest type: 28 ft needs two boxes.
    assert (
        sum(
            1
            for v in next(a for a in out.artifacts if a.stage == "aggregation").payload["visits"]
            if v["location_id"] == "B"
        )
        == 2
    )


# ---- warm starts carry the type per route ------------------------------------------------------

SOURCE = WarmStartSource(run_id="source")


def warm(settings, plan_doc):
    return run_pipeline(
        six_stops(), derive(settings, warm_start=SOURCE.model_dump()), warm_start_plan=plan_doc
    )


@pytest.fixture(scope="module")
def fleet_plan():
    settings = fleet_settings({**TRAILER, "count": 1}, BOX)
    out = run_pipeline(six_stops(), settings)
    return settings, plan_from_summary(out.summary.model_dump(mode="json"), SOURCE)


def outcome(out):
    return out.summary.clusters[0].warm_start


def test_a_fleet_plan_warm_starts_a_fleet_run_with_its_types(fleet_plan):
    settings, plan = fleet_plan
    assert plan.fleet == ["trailer", "box"]
    assert sorted(plan.clusters[0].vehicle_types) == ["box"] * 4 + ["trailer"]
    out = warm(settings, plan)
    assert outcome(out).status == "used" and out.summary.validity == "valid"
    assert outcome(out).final_cost <= outcome(out).initial_cost


def test_warm_start_refuses_a_plan_that_does_not_match_the_fleet(fleet_plan):
    settings, plan = fleet_plan
    # Fleet source into a run without a fleet, and the reverse.
    plain = FAST.model_copy(update={"k": 1})
    assert outcome(warm(plain, plan)).reason == "fleet_changed"
    plain_out = run_pipeline(six_stops(), plain)
    plain_plan = plan_from_summary(plain_out.summary.model_dump(mode="json"), SOURCE)
    assert plain_plan.fleet is None
    assert outcome(warm(settings, plain_plan)).reason == "fleet_changed"
    # A type that no longer exists, or fewer vehicles than the plan uses: validator, not solver.
    renamed = plan.model_copy(deep=True)
    renamed.clusters[0].vehicle_types = ["ghost"] * len(renamed.clusters[0].vehicle_types)
    gone = outcome(warm(settings, renamed))
    assert (gone.status, gone.reason) == ("skipped", "invalid_on_new_problem")
    fewer = fleet_settings({**TRAILER, "count": 1}, {**BOX, "count": 2})
    short = outcome(warm(fewer, plan))
    assert (short.status, short.reason) == ("skipped", "invalid_on_new_problem")
    assert "fleet count" in short.detail


def test_the_solver_refuses_initial_routes_that_exceed_a_type_count():
    import numpy as np

    distance = np.array([[0, 100, 100], [100, 0, 100], [100, 100, 0]], dtype=np.int64)
    problem = PartitionProblem(
        distance,
        [PartitionVisit("a", 1, 900), PartitionVisit("b", 2, 900)],
        5_300,
        max_leg_m=10**6,
        truck_penalty=0,
        fleet=(PartitionVehicle("t", 5_300, 1, 0, 1), PartitionVehicle("u", 5_300, 1, 0, 1)),
    )
    with pytest.raises(WarmStartRejected):
        solve_partition(problem, [[0], [1]], ["t", "t"])
    with pytest.raises(WarmStartRejected):
        solve_partition(problem, [[0], [1]], ["t", "ghost"])
    with pytest.raises(WarmStartRejected):
        solve_partition(problem, [[0], [1]], None)
    assert solve_partition(problem, [[0], [1]], ["t", "u"]).initial_cost is not None


# ---- comparison identity and replay ------------------------------------------------------------


def test_fleet_replay_reproduces_the_fleet(tmp_path):
    settings = fleet_settings({**TRAILER, "count": 1}, BOX, solver_max_iterations=100)
    expected = write_bundle(tmp_path, settings, six_stops())
    assert expected["fleet"]["id"] == content_hash(
        [t.model_dump(mode="json") for t in settings.fleet]
    )
    assert expected["fleet"]["usage"] == {"trailer": 1, "box": 4}
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == []
    assert any(line.startswith("fleet") and "identity reproduced" in line for line in lines)

    # A different fleet is a different problem, whatever else reproduces.
    changed = {**TRAILER, "count": 1, "capacity": 5_400}
    edit(tmp_path, "settings.json", lambda d: d["fleet"].__setitem__(0, changed))
    assert "fleet" in replay(tmp_path, out=lambda _: None)


def test_replay_without_the_recorded_fleet_fails(tmp_path):
    settings = fleet_settings(TRAILER, BOX, solver_max_iterations=100)
    write_bundle(tmp_path, settings, six_stops())
    edit(tmp_path, "expected.json", lambda d: d.pop("fleet"))
    assert "fleet" in replay(tmp_path, out=lambda _: None)


def test_expected_record_has_no_fleet_without_one():
    out = run_pipeline(six_stops(), FAST.model_copy(update={"k": 1}))
    assert "fleet" not in expected_record("r", out, out.summary.settings)


# ---- the bundled example ----------------------------------------------------------------------


def test_example_file_matches_the_generator():
    document = json.loads((EXAMPLES / "fleet-mixed.json").read_text())
    assert document["scenario"] == fleet_example.build().model_dump(mode="json")
    assert document["settings"] == fleet_example.SETTINGS.model_dump(mode="json")
    RunSettings.model_validate(document["settings"])


def test_example_observations(mixed):
    """The claims the example's description makes, on a real run."""
    _, _, out = mixed
    summary = out.summary
    assert (summary.validity, summary.coverage) == ("valid", "complete")
    use = {u.id: u for u in summary.fleet_usage}
    # Both finite counts are exhausted: the fleet binds, and both types are in use.
    assert (use["trailer-53"].trucks, use["box-26"].trucks) == (3, 8)
    assert use["trailer-53"].count == 3 and use["box-26"].count == 8
    assert stages_of(out)["problem"]["clusters"][0]["vehicle_types"][0]["id"] == "trailer-53"
    # Fill is measured against each truck's own capacity, so no truck exceeds 100%.
    assert max(t.fill for t in summary.trucks) <= 1.0
    assert all(t.fill == t.load / (5_300 if t.vehicle_type_id == "trailer-53" else 2_600)
               for t in summary.trucks)  # fmt: skip
    # Seven trailers' worth of freight (the single-trailer baseline) needs 11 mixed trucks.
    baseline = run_pipeline(fleet_example.build(), fleet_example.BASELINE).summary
    assert baseline.totals.trucks == 7 and summary.totals.trucks == 11
    assert summary.totals.load == baseline.totals.load == 32_200
