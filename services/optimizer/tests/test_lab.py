"""Solver Lab capability fixtures (spec §3): native PyVRP behavior plus independent validation.

Every number asserted here is recomputed by `lab.validate` from the instance and raw matrices;
the solver's own flags are compared, never trusted alone.
"""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from fillrate_optimizer.capabilities import BEHAVIORS
from fillrate_optimizer.lab import (
    CandidateRoute,
    LabError,
    LabInstance,
    problem_fingerprint,
    run_lab,
    validate_plan,
)
from fillrate_optimizer.lab.job import lab_job, parse_instance
from fillrate_optimizer.lab.travel import lab_matrices


def planar(clients, vehicle_types, dimensions=("load",), **extra) -> LabInstance:
    return LabInstance.model_validate(
        {
            "name": "fixture",
            "coordinates": "planar",
            "dimensions": [{"id": d, "unit": "units"} for d in dimensions],
            "depots": [{"id": "depot", "x": 0, "y": 0}],
            "clients": clients,
            "vehicle_types": vehicle_types,
            "solver": {"seed": 0, "max_iterations": 500},
            **extra,
        }
    )


def client(cid, x, y, **delivery):
    return {"id": cid, "x": x, "y": y, "delivery": delivery}


def two_dimension_instance(weight_capacity=100):
    # Four clients on a line; each pair weighs 100 together but takes little volume.
    clients = [
        client("a", 10, 0, weight=50, volume=10),
        client("b", 12, 0, weight=50, volume=10),
        client("c", -10, 0, weight=50, volume=10),
        client("d", -12, 0, weight=50, volume=10),
    ]
    return planar(
        clients,
        [
            {
                "id": "t",
                "count": 4,
                "capacity": {"weight": weight_capacity, "volume": 100},
                "fixed_cost": 10,
            }
        ],
        dimensions=("weight", "volume"),
    )


def test_lab_run_agrees_with_independent_validation():
    instance = two_dimension_instance()
    result = run_lab(instance)
    assert result.solver_feasible and result.validated_feasible
    assert result.proof == "heuristic"
    assert result.violations == []
    # Recomputed nominal objective equals PyVRP's own nominal cost of the same routes.
    assert result.objective.total == result.solver.nominal_cost
    assert result.objective.total == (
        result.objective.fixed_cost
        + result.objective.distance_cost
        + result.objective.duration_cost
    )
    # Closed routes: each pair is a round trip of 12 out and 12 back.
    assert sorted(r.distance for r in result.routes) == [24, 24]
    assert result.totals.clients_served == 4
    assert result.solver.stopped_by == "iterations" and result.solver.iterations == 500
    route = result.routes[0]
    first, last = route.visits[0], route.visits[-1]
    assert first.load_before == route.load
    assert last.load_after == {"weight": 0, "volume": 0}


def test_weight_dimension_binds_and_changes_the_plan():
    # With weight capacity 100, a truck takes one pair; ignoring weight, one truck takes all four.
    both = run_lab(two_dimension_instance(weight_capacity=100))
    assert both.validated_feasible
    assert both.totals.routes == 2
    assert all(r.load["weight"] <= 100 for r in both.routes)
    assert all(r.utilization["volume"] <= 0.2 for r in both.routes)  # volume never binds

    loose = run_lab(two_dimension_instance(weight_capacity=1_000))
    assert loose.validated_feasible and loose.totals.routes == 1
    assert loose.objective.total < both.objective.total

    # The one-truck plan, checked against the binding instance, overloads weight only.
    instance = two_dimension_instance(weight_capacity=100)
    plan = validate_plan(
        instance,
        lab_matrices(instance),
        [CandidateRoute(r.vehicle_type, [v.client_id for v in r.visits]) for r in loose.routes],
    )
    assert [(v.code, v.dimension) for v in plan.violations] == [("over_capacity", "weight")]


def test_validator_rejects_over_capacity_in_either_dimension():
    instance = two_dimension_instance()
    matrices = lab_matrices(instance)
    heavy = validate_plan(
        instance, matrices, [CandidateRoute("t", ["a", "b", "c"]), CandidateRoute("t", ["d"])]
    )
    assert [(v.code, v.dimension) for v in heavy.violations] == [("over_capacity", "weight")]

    bulky = planar(
        [client("a", 1, 0, weight=1, volume=60), client("b", 2, 0, weight=1, volume=60)],
        [{"id": "t", "count": 2, "capacity": {"weight": 100, "volume": 100}}],
        dimensions=("weight", "volume"),
    )
    plan = validate_plan(bulky, lab_matrices(bulky), [CandidateRoute("t", ["a", "b"])])
    assert [(v.code, v.dimension) for v in plan.violations] == [("over_capacity", "volume")]
    assert not plan.feasible


def test_validator_rejects_coverage_and_fleet_errors():
    instance = planar(
        [client("a", 1, 0, load=1), client("b", 2, 0, load=1)],
        [{"id": "small", "count": 1, "capacity": {"load": 5}}],
    )
    matrices = lab_matrices(instance)
    plan = validate_plan(
        instance,
        matrices,
        [
            CandidateRoute("small", ["a"]),
            CandidateRoute("small", ["a", "zz"]),
            CandidateRoute("big", []),
        ],
    )
    codes = sorted(v.code for v in plan.violations)
    assert codes == [
        "client_not_visited",
        "duplicate_visit",
        "empty_route",
        "fleet_exceeded",
        "unknown_client",
        "unknown_vehicle_type",
    ]


def test_mixed_fleet_uses_cheaper_type_within_its_count():
    # Nine clients of 2 units (18 in all). Vans (cap 4, cost 10) are far cheaper than trucks
    # (cap 10, cost 100) but only two exist: both vans plus one truck (120) beat two trucks (200).
    clients = [client(f"c{i}", 10 * (i + 1), 0, load=2) for i in range(9)]
    fleet = [
        {
            "id": "van",
            "count": 2,
            "capacity": {"load": 4},
            "fixed_cost": 10,
            "unit_distance_cost": 0,
        },
        {
            "id": "truck",
            "count": 3,
            "capacity": {"load": 10},
            "fixed_cost": 100,
            "unit_distance_cost": 0,
        },
    ]
    result = run_lab(planar(clients, fleet))
    assert result.validated_feasible
    used = {f.vehicle_type: f.used for f in result.fleet}
    assert used == {"van": 2, "truck": 1}
    assert result.objective.fixed_cost == 2 * 10 + 100
    assert all(f.used <= f.available for f in result.fleet)
    assert all(r.load["load"] <= 4 for r in result.routes if r.vehicle_type == "van")

    # With a single van, a van plus one truck (14) cannot carry 18, so two trucks it is: the van
    # count, not its price, decides.
    fewer = [dict(fleet[0], count=1), fleet[1]]
    one_van = run_lab(planar(clients, fewer))
    assert {f.vehicle_type: f.used for f in one_van.fleet} == {"van": 0, "truck": 2}


def test_fleet_too_small_is_reported_infeasible_not_hidden():
    clients = [client(f"c{i}", 5 * (i + 1), 0, load=3) for i in range(4)]
    result = run_lab(planar(clients, [{"id": "van", "count": 1, "capacity": {"load": 6}}]))
    assert not result.solver_feasible
    assert not result.validated_feasible
    assert {v.code for v in result.violations} == {"over_capacity"}
    assert sum(result.solver.excess_load.values()) > 0


def test_max_distance_and_shift_duration_are_native_route_limits():
    clients = [client("a", 10, 0, load=1), client("b", -10, 0, load=1)]
    # One route visiting both is 40 long; each round trip alone is 20.
    for limit in ({"max_distance": 25}, {"shift_duration": 25}):
        vt = {"id": "t", "count": 2, "capacity": {"load": 10}, "fixed_cost": 1, **limit}
        result = run_lab(planar(clients, [vt]))
        assert result.validated_feasible
        assert result.totals.routes == 2
    # Without a limit, one route is cheaper (fixed cost 1 each, distance cost the same).
    result = run_lab(
        planar(clients, [{"id": "t", "count": 2, "capacity": {"load": 10}, "fixed_cost": 1}])
    )
    assert result.totals.routes == 1
    instance = planar(
        clients, [{"id": "t", "count": 2, "capacity": {"load": 10}, "max_distance": 25}]
    )
    plan = validate_plan(instance, lab_matrices(instance), [CandidateRoute("t", ["a", "b"])])
    assert [v.code for v in plan.violations] == ["max_distance_exceeded"]


def test_service_duration_and_unit_duration_cost_enter_the_objective():
    instance = planar(
        [dict(client("a", 3, 4, load=1), service_duration=7)],
        [
            {
                "id": "t",
                "count": 1,
                "capacity": {"load": 1},
                "unit_distance_cost": 2,
                "unit_duration_cost": 3,
            }
        ],
    )
    result = run_lab(instance)
    route = result.routes[0]
    assert (route.distance, route.travel_duration, route.service_duration) == (10, 10, 7)
    assert route.duration == 17
    assert route.visits[0].arrival == 5 and route.visits[0].departure == 12
    assert result.objective.distance_cost == 20 and result.objective.duration_cost == 51
    assert result.objective.total == result.solver.nominal_cost == 71


def test_geographic_instance_uses_meters_and_seconds():
    instance = LabInstance.model_validate(
        {
            "name": "geo",
            "coordinates": "geographic",
            "dimensions": [{"id": "pallets", "unit": "pallets"}],
            "depots": [{"id": "dc", "lat": 35.0, "lon": -90.0}],
            "clients": [{"id": "a", "lat": 35.1, "lon": -90.0, "delivery": {"pallets": 1}}],
            "vehicle_types": [{"id": "t", "count": 1, "capacity": {"pallets": 2}}],
            "solver": {"max_iterations": 100},
        }
    )
    result = run_lab(instance)
    assert result.units.distance == "meters" and result.units.duration == "seconds"
    # 0.1° of latitude ≈ 11.12 km, × 1.2 circuity, out and back.
    assert 26_600 < result.routes[0].distance < 26_800
    assert result.routes[0].duration == pytest.approx(result.routes[0].distance / 11.176, abs=2)


def test_planar_coordinates_are_not_latitude_longitude():
    with pytest.raises(ValidationError, match="planar instances need x and y"):
        planar(
            [{"id": "a", "lat": 1, "lon": 2, "delivery": {"load": 1}}],
            [{"id": "t", "count": 1, "capacity": {"load": 1}}],
        )
    # Planar coordinates far outside latitude/longitude ranges are fine.
    instance = planar(
        [client("a", 5_000, -3_000, load=1)], [{"id": "t", "count": 1, "capacity": {"load": 1}}]
    )
    assert lab_matrices(instance).distance[0, 1] == 5_831


def two_depot_instance(**extra) -> LabInstance:
    """Clients cluster near each of two depots; one vehicle type is based at each depot."""
    clients = [
        client("w1", -48, 5, load=3),
        client("w2", -52, -5, load=3),
        client("e1", 48, 5, load=3),
        client("e2", 52, -5, load=3),
    ]
    types = [
        {
            "id": "west",
            "count": 2,
            "capacity": {"load": 10},
            "fixed_cost": 50,
            "start_depot": "A",
            "end_depot": "A",
        },
        {
            "id": "east",
            "count": 2,
            "capacity": {"load": 10},
            "fixed_cost": 50,
            "start_depot": "B",
            "end_depot": "B",
        },
    ]
    return planar(
        clients,
        types,
        depots=[{"id": "A", "x": -50, "y": 0}, {"id": "B", "x": 50, "y": 0}],
    )


def test_vehicles_start_and_end_at_their_types_depots():
    instance = two_depot_instance()
    result = run_lab(instance)
    assert result.solver_feasible and result.validated_feasible and not result.violations
    served = {r.vehicle_type: {v.client_id for v in r.visits} for r in result.routes}
    # Each side is served from its own depot, and nothing crosses the 100-unit gap.
    assert served == {"west": {"w1", "w2"}, "east": {"e1", "e2"}}
    assert {(r.vehicle_type, r.start_depot, r.end_depot) for r in result.routes} == {
        ("west", "A", "A"),
        ("east", "B", "B"),
    }
    assert result.totals.distance < 50
    # The matrices list the depots first, then the clients.
    matrices = lab_matrices(instance)
    assert matrices.distance.shape == (6, 6) and matrices.distance[0, 1] == 100
    # A different start/end assignment is a different problem; naming the default is not.
    swapped = LabInstance.model_validate(
        instance.model_dump()
        | {
            "vehicle_types": [
                dict(t, start_depot=("B" if t["id"] == "west" else "A"), end_depot="A")
                for t in instance.model_dump()["vehicle_types"]
            ]
        }
    )
    assert problem_fingerprint(swapped) != problem_fingerprint(instance)
    # A route may start at one depot and end at another.
    far = LabInstance.model_validate(
        instance.model_dump()
        | {
            "vehicle_types": [
                dict(t, end_depot="B") for t in instance.model_dump()["vehicle_types"]
            ]
        }
    )
    one_way = run_lab(far)
    assert one_way.validated_feasible
    assert all(r.start_depot != r.end_depot for r in one_way.routes if r.vehicle_type == "west")


def test_validator_rejects_routes_that_use_the_wrong_depot():
    instance = two_depot_instance()
    matrices = lab_matrices(instance)
    good = CandidateRoute("west", ["w1", "w2"])
    ok = validate_plan(instance, matrices, [good, CandidateRoute("east", ["e1", "e2"])])
    assert ok.feasible
    # A west-based van written as if it started at the East depot: flagged, and its distance is
    # recomputed from the depot it actually used (100 units farther each way).
    wrong = validate_plan(
        instance,
        matrices,
        [CandidateRoute("west", ["w1", "w2"], "B", "B"), CandidateRoute("east", ["e1", "e2"])],
    )
    assert {(v.code, v.route) for v in wrong.violations} == {("wrong_depot", 0)}
    assert len(wrong.violations) == 2  # start and end
    assert wrong.routes[0].distance > ok.routes[0].distance + 180
    assert (wrong.routes[0].start_depot, wrong.routes[0].end_depot) == ("B", "B")
    unknown = validate_plan(
        instance, matrices, [CandidateRoute("west", ["w1", "w2"], "nowhere"), good]
    )
    assert "unknown_depot" in {v.code for v in unknown.violations}
    # Serving a client from the wrong side is legal but costs: distance is from the type's depot.
    cross = validate_plan(instance, matrices, [CandidateRoute("west", ["e1"])])
    assert cross.routes[0].distance == 2 * 98


def test_depot_references_and_preflight_use_each_types_depots():
    with pytest.raises(ValidationError, match="start_depot 'nowhere' is not a depot id"):
        planar(
            [client("a", 1, 1, load=1)],
            [{"id": "t", "count": 1, "capacity": {"load": 1}, "start_depot": "nowhere"}],
        )
    with pytest.raises(ValidationError, match="duplicate location id"):
        planar(
            [client("a", 1, 1, load=1)],
            [{"id": "t", "count": 1, "capacity": {"load": 1}}],
            depots=[{"id": "d", "x": 0, "y": 0}, {"id": "d", "x": 5, "y": 5}],
        )
    # "far" is 100 from the first depot but 2 from the second: servable only from depot two.
    base = {"id": "t", "count": 1, "capacity": {"load": 1}, "max_distance": 10}
    depots = [{"id": "d1", "x": 0, "y": 0}, {"id": "d2", "x": 100, "y": 0}]
    ok = planar(
        [client("far", 102, 0, load=1)],
        [base | {"start_depot": "d2", "end_depot": "d2"}],
        depots=depots,
    )
    assert run_lab(ok).validated_feasible
    blocked = planar([client("far", 102, 0, load=1)], [base], depots=depots)
    with pytest.raises(LabError, match="far: no vehicle type can carry it") as error:
        run_lab(blocked)
    assert error.value.code == "preflight_blocked"


@pytest.mark.parametrize(
    ("patch", "capability"),
    [
        (
            {
                "vehicle_types": [
                    {"id": "t", "count": 1, "capacity": {"load": 1}, "profile": "bike"}
                ]
            },
            "routing_profiles",
        ),
        ({"shipments": []}, "paired_shipments"),
        ({"clients": [{"id": "a", "x": 1, "y": 1, "prize": 5}]}, "optional_clients"),
        (
            {
                "vehicle_types": [
                    {"id": "t", "count": 1, "capacity": {"load": 1}, "reload_depots": ["depot"]}
                ]
            },
            "reloads",
        ),
        ({"clients": [{"id": "a", "x": 1, "y": 1, "group": "g"}]}, "client_groups"),
    ],
)
def test_planned_capabilities_are_refused_by_name(patch, capability):
    base = {
        "name": "planned",
        "coordinates": "planar",
        "dimensions": [{"id": "load", "unit": "units"}],
        "depots": [{"id": "depot", "x": 0, "y": 0}],
        "clients": [{"id": "a", "x": 1, "y": 1}],
        "vehicle_types": [{"id": "t", "count": 1, "capacity": {"load": 1}}],
    }
    with pytest.raises(LabError, match=f"planned capability {capability}") as error:
        parse_instance(base | patch)
    assert error.value.code == "planned_capability"
    assert any(b.id == capability and b.availability == "planned" for b in BEHAVIORS)


def test_structural_errors_name_the_problem():
    with pytest.raises(ValidationError, match="fits no vehicle type"):
        planar([client("a", 1, 1, load=5)], [{"id": "t", "count": 1, "capacity": {"load": 4}}])
    with pytest.raises(ValidationError, match="unknown dimension"):
        planar([client("a", 1, 1, weight=1)], [{"id": "t", "count": 1, "capacity": {"load": 4}}])
    with pytest.raises(ValidationError, match="capacity must name exactly"):
        planar([client("a", 1, 1, load=1)], [{"id": "t", "count": 1, "capacity": {}}])
    with pytest.raises(ValidationError, match="duplicate location id"):
        planar([client("depot", 1, 1, load=1)], [{"id": "t", "count": 1, "capacity": {"load": 4}}])


def test_preflight_blocks_a_client_no_vehicle_can_reach_within_its_limit():
    instance = planar(
        [client("far", 100, 0, load=1)],
        [{"id": "t", "count": 1, "capacity": {"load": 1}, "max_distance": 150}],
    )
    with pytest.raises(LabError, match="far: no vehicle type can carry it") as error:
        run_lab(instance)
    assert error.value.code == "preflight_blocked"


def test_fingerprint_ignores_names_and_solver_settings_but_not_the_problem():
    base = two_dimension_instance()
    same = base.model_copy(update={"name": "renamed", "description": "x"})
    reseeded = LabInstance.model_validate(
        base.model_dump() | {"solver": {"seed": 7, "max_iterations": 10}}
    )
    assert problem_fingerprint(base) == problem_fingerprint(same) == problem_fingerprint(reseeded)
    assert problem_fingerprint(base) != problem_fingerprint(
        two_dimension_instance(weight_capacity=99)
    )
    moved = LabInstance.model_validate(
        base.model_dump()
        | {"clients": [dict(c, x=c["x"] + 1) for c in base.model_dump()["clients"]]}
    )
    assert problem_fingerprint(base) != problem_fingerprint(moved)


def test_same_seed_and_iteration_budget_repeat_exactly():
    a = run_lab(two_dimension_instance())
    b = run_lab(two_dimension_instance())
    strip = lambda r: r.model_dump(exclude={"solver": {"runtime_s"}})  # noqa: E731
    assert strip(a) == strip(b)


def test_lab_job_returns_one_hash_checked_artifact():
    from fillrate_optimizer.canonical import content_hash

    document = json.loads(
        (Path(__file__).resolve().parents[3] / "examples/lab-dimensions.json").read_text()
    )
    events = []
    out = lab_job(
        document,
        {"schema_version": 1, "kind": "lab"},
        "00000000-0000-4000-8000-000000000000",
        events.append,
    )
    [artifact] = out["artifacts"]
    assert artifact["manifest"]["stage_type"] == "lab"
    assert artifact["manifest"]["output_hash"] == content_hash(artifact["payload"])
    assert out["summary"]["kind"] == "lab" and out["summary"]["validated_feasible"] is True
    assert [e["stage"] for e in events] == ["build", "solve", "validate"]


def test_reproduction_checks_iteration_runs_exactly():
    from fillrate_optimizer.lab.replay import differences

    instance = two_dimension_instance()
    result = run_lab(instance)
    expected = {
        "problem_fingerprint": result.problem_fingerprint,
        "validated_feasible": result.validated_feasible,
        "stopped_by": result.solver.stopped_by,
        "objective_total": result.objective.total,
        "routes": [
            {"vehicle_type": r.vehicle_type, "client_ids": [v.client_id for v in r.visits]}
            for r in result.routes
        ],
    }
    document = instance.model_dump(mode="json")
    assert differences(document, expected) == []
    assert differences(document, expected | {"objective_total": 1}) == ["objective 68 ≠ 1"]
    # A runtime-limited run compares only identity and feasibility.
    assert differences(document, expected | {"stopped_by": "runtime", "objective_total": 1}) == []
    changed = two_dimension_instance(weight_capacity=99).model_dump(mode="json")
    assert differences(changed, expected)[0].startswith("problem fingerprint differs")
