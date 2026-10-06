"""The bundled Solver Lab examples' stated observations (`app/labs`), asserted on real solves."""

import json
import math
from pathlib import Path

import pytest

from fillrate_optimizer.lab import CandidateRoute, LabInstance, run_lab, validate_plan
from fillrate_optimizer.lab import examples as lab_examples
from fillrate_optimizer.lab.travel import lab_matrices

ROOT = Path(__file__).resolve().parents[3] / "examples"
SEEDS = range(4)


def with_seed(instance: LabInstance, seed: int) -> LabInstance:
    return instance.model_copy(update={"solver": instance.solver.model_copy(update={"seed": seed})})


@pytest.fixture(scope="module")
def runs():
    builds = {
        "dimensions": lab_examples.dimensions(True),
        "volume": lab_examples.dimensions(False),
        "fleet": lab_examples.fleet(True),
        "trucks": lab_examples.fleet(False),
        "depots": lab_examples.depots(False),
        "single": lab_examples.depots(True),
        "reloads": lab_examples.reloads(True),
        "reloads_off": lab_examples.reloads(False),
        "prizes": lab_examples.prizes(60),
        "prizes_high": lab_examples.prizes(400),
        "groups": lab_examples.groups("north"),
        "groups_south": lab_examples.groups("south"),
    }
    return {
        (name, seed): run_lab(with_seed(b, seed)) for name, b in builds.items() for seed in SEEDS
    }


@pytest.mark.parametrize("name", list(lab_examples.EXAMPLES))
def test_example_files_match_the_generator(name):
    stored = json.loads((ROOT / name).read_text())
    assert stored == lab_examples.EXAMPLES[name]().model_dump(mode="json", exclude_none=True)
    # The stored file parses back to the same instance (no default fills a dropped null).
    assert LabInstance.model_validate(stored) == lab_examples.EXAMPLES[name]()


def test_dimensions_example_is_planar_abstract_units():
    instance = lab_examples.dimensions()
    assert instance.coordinates == "planar"
    assert lab_matrices(instance).distance_unit == "planar units"
    # Coordinates are abstract: nothing is a latitude/longitude pair.
    assert all(c.lat is None and c.lon is None for c in instance.clients)


def test_weight_sets_the_truck_count(runs):
    instance = lab_examples.dimensions()
    weight = sum(c.delivery["weight"] for c in instance.clients)
    volume = sum(c.delivery["volume"] for c in instance.clients)
    assert (weight, volume) == (2_860, 4_970)
    for seed in SEEDS:
        result = runs["dimensions", seed]
        assert result.validated_feasible and result.solver_feasible
        # 3 trucks = ceil(2,860 kg / 1,200 kg); volume alone would need ceil(4,970 / 4,000) = 2.
        assert result.totals.routes == math.ceil(weight / 1_200) == 3
        assert max(r.utilization["weight"] for r in result.routes) >= 0.85
        assert max(r.utilization["volume"] for r in result.routes) < 0.6
        assert max(r.utilization["weight"] for r in result.routes) <= 1
        # The lesson page reads these per-dimension maxima and the cost split.
        assert result.objective.fixed_cost == 3 * 100
        assert result.objective.total == runs["dimensions", 0].objective.total


def test_without_weight_two_trucks_suffice_but_overload_weight(runs):
    two_dims = lab_examples.dimensions()
    for seed in SEEDS:
        result = runs["volume", seed]
        assert result.validated_feasible and result.totals.routes == 2
        assert result.objective.fixed_cost == 2 * 100
        assert set(result.units.dimensions) == {"volume"}
        assert all(r.utilization["volume"] < 0.7 for r in result.routes)
        assert result.objective.total < runs["dimensions", seed].objective.total
        assert result.problem_fingerprint != runs["dimensions", seed].problem_fingerprint
        # The same routes, checked against the two-dimension instance: every truck is too heavy.
        plan = validate_plan(
            two_dims,
            lab_matrices(two_dims),
            [
                CandidateRoute(r.vehicle_type, [v.client_id for v in r.visits])
                for r in result.routes
            ],
        )
        overloads = [v for v in plan.violations if v.code == "over_capacity"]
        assert {v.dimension for v in plan.violations} == {"weight"}
        assert len(overloads) == 2
        assert all(r.load["weight"] > 1_200 for r in plan.routes)


def test_mixed_fleet_uses_every_van_and_one_truck(runs):
    for seed in SEEDS:
        result = runs["fleet", seed]
        assert result.validated_feasible
        assert result.units.distance == "meters"
        used = {f.vehicle_type: (f.used, f.available) for f in result.fleet}
        assert used == {"van": (3, 3), "box-truck": (1, 3)}
        assert all(r.load["pallets"] <= 6 for r in result.routes if r.vehicle_type == "van")
        assert result.objective.fixed_cost == 3 * 15_000 + 40_000
        # A van fills to its 6 pallets, and the box truck is not full; the page reads these maxima.
        van = [r.utilization["pallets"] for r in result.routes if r.vehicle_type == "van"]
        truck = [r.utilization["pallets"] for r in result.routes if r.vehicle_type == "box-truck"]
        assert max(van) == 1 and max(truck) < 1
        assert result.objective.total == runs["fleet", 0].objective.total


def test_trucks_only_costs_more_for_the_same_deliveries(runs):
    for seed in SEEDS:
        mixed, trucks = runs["fleet", seed], runs["trucks", seed]
        assert trucks.validated_feasible
        assert {f.vehicle_type: f.used for f in trucks.fleet} == {"box-truck": 3}
        assert trucks.totals.load == mixed.totals.load == {"pallets": 30}
        assert trucks.objective.fixed_cost == 3 * 40_000
        assert max(r.utilization["pallets"] for r in trucks.routes) < 0.8
        assert trucks.objective.total > mixed.objective.total
        assert trucks.objective.fixed_cost > mixed.objective.fixed_cost


def test_each_depot_serves_its_own_cluster(runs):
    for seed in SEEDS:
        result = runs["depots", seed]
        assert result.validated_feasible and result.solver_feasible
        assert result.problem_fingerprint == runs["depots", 0].problem_fingerprint
        assert result.objective.total == runs["depots", 0].objective.total == 689
        assert {f.vehicle_type: f.used for f in result.fleet} == {"west-van": 2, "east-van": 2}
        for route in result.routes:
            sides = {v.client_id[0] for v in route.visits}
            assert sides == ({"W"} if route.vehicle_type == "west-van" else {"E"})
            assert len(route.visits) == 3 and route.utilization["parcels"] == 1.0
            assert (route.start_depot, route.end_depot) == (
                ("west", "west") if route.vehicle_type == "west-van" else ("east", "east")
            )
        assert sorted(v.client_id for r in result.routes for v in r.visits) == sorted(
            c.id for c in lab_examples.depots().clients
        )


def test_one_depot_makes_the_same_stops_cost_more(runs):
    for seed in SEEDS:
        two, one = runs["depots", seed], runs["single", seed]
        assert one.validated_feasible
        assert one.problem_fingerprint != two.problem_fingerprint
        # Same stops, same number of vans, so the same fixed cost; the whole difference is distance.
        assert one.totals.routes == two.totals.routes == 4
        assert one.objective.fixed_cost == two.objective.fixed_cost == 400
        assert one.totals.load == two.totals.load == {"parcels": 48}
        assert one.objective.total == runs["single", 0].objective.total == 1_096
        assert one.objective.total > two.objective.total * 1.5
        # Two vans still serve only the East stops, now driving out from the West depot.
        east = [r for r in one.routes if all(v.client_id.startswith("E") for v in r.visits)]
        assert len(east) == 2 and all(r.start_depot == "west" for r in east)
        assert min(r.distance for r in east) > 2 * 100


def test_one_van_reloads_four_times_at_the_yard(runs):
    for seed in SEEDS:
        result = runs["reloads", seed]
        assert result.validated_feasible and result.solver_feasible
        assert result.problem_fingerprint == runs["reloads", 0].problem_fingerprint
        assert result.objective.total == runs["reloads", 0].objective.total == 533
        (route,) = result.routes
        assert result.fleet[0].used == 1 and route.load == {"parcels": 40}
        assert len(route.trips) == 4 and all(len(t.client_ids) == 2 for t in route.trips)
        assert all(
            t.load == {"parcels": 10} and t.utilization["parcels"] == 1.0 for t in route.trips
        )
        assert [t.from_depot for t in route.trips] == ["dc", "yard", "yard", "yard"]
        assert [t.to_depot for t in route.trips] == ["yard", "yard", "yard", "dc"]
        assert result.objective.fixed_cost == 100 and result.totals.distance == 433


def test_without_reloads_four_vans_drive_from_the_dc(runs):
    for seed in SEEDS:
        on, off = runs["reloads", seed], runs["reloads_off", seed]
        assert off.validated_feasible and off.totals.routes == 4
        assert all(len(r.trips) == 1 and r.start_depot == r.end_depot == "dc" for r in off.routes)
        assert off.problem_fingerprint != on.problem_fingerprint
        assert off.objective.fixed_cost == 400 and on.objective.fixed_cost == 100
        assert off.objective.total == runs["reloads_off", 0].objective.total == 1_180
        assert off.totals.distance == 780 > on.totals.distance
        # The one reloading van works for longer than any single-trip van: its route is the day.
        assert on.routes[0].duration > max(r.duration for r in off.routes)


def test_low_prizes_leave_the_remote_stops_unvisited(runs):
    for seed in SEEDS:
        result = runs["prizes", seed]
        assert result.validated_feasible and result.solver_feasible
        assert result.problem_fingerprint == runs["prizes", 0].problem_fingerprint
        assert [s.client_id for s in result.skipped] == ["P-6", "P-7", "P-8"]
        assert result.totals.clients_served == 5 and result.totals.routes == 1
        o = result.objective
        # Nominal cost 315 = 100 fixed + 215 distance; prizes are a separate 180, never in costs.
        assert (o.fixed_cost, o.distance_cost, o.total) == (100, 215, 315)
        assert (o.uncollected_prizes, o.prizes_collected, o.objective_with_prizes) == (180, 0, 495)
        assert result.solver.nominal_cost == 315


def test_raised_prizes_make_the_solver_visit_them(runs):
    for seed in SEEDS:
        low, high = runs["prizes", seed], runs["prizes_high", seed]
        assert high.validated_feasible and high.skipped == []
        assert high.problem_fingerprint != low.problem_fingerprint
        assert high.totals.clients_served == 8 and high.totals.routes == 2
        o = high.objective
        assert (o.total, o.uncollected_prizes, o.prizes_collected) == (800, 0, 1_200)
        assert o.objective_with_prizes == 800 == runs["prizes_high", 0].objective.total
        # Visiting costs more as a nominal cost, but is cheaper once skipped prizes are counted.
        assert o.total > low.objective.total
        # Each remote visit is worth its prize only above the extra distance it needs: 485 > 180.
        assert o.total - low.objective.total > low.objective.uncollected_prizes
        assert high.totals.distance > low.totals.distance


def swap_member(result, old, new):
    """The solver's routes with one alternative replaced by the other."""
    return [
        CandidateRoute(
            r.vehicle_type, [new if v.client_id == old else v.client_id for v in r.visits]
        )
        for r in result.routes
    ]


@pytest.mark.parametrize(
    ("name", "chosen", "other"),
    [
        ("groups", "acme-north", "acme-south"),
        ("groups_south", "acme-south", "acme-north"),
    ],
)
def test_the_solver_picks_the_cheaper_alternative(runs, name, chosen, other):
    for seed in SEEDS:
        result = runs[name, seed]
        assert result.validated_feasible and result.solver_feasible and not result.skipped
        assert result.problem_fingerprint == runs[name, 0].problem_fingerprint
        assert [(g.group_id, g.required, g.served_by) for g in result.groups] == [
            ("acme", True, chosen)
        ]
        visited = {v.client_id for r in result.routes for v in r.visits}
        assert chosen in visited and other not in visited and len(visited) == 5
        assert result.totals.routes == 1 and result.objective.total == 312
        # Serving the other dock instead (same order) is valid but longer, so the choice is real.
        instance = lab_examples.groups("north" if name == "groups" else "south")
        swapped = validate_plan(
            instance, lab_matrices(instance), swap_member(result, chosen, other)
        )
        assert swapped.feasible and swapped.objective.total > result.objective.total + 40
        # Visiting both docks is rejected.
        both = validate_plan(
            instance,
            lab_matrices(instance),
            [
                CandidateRoute(
                    "van", [*[v.client_id for r in result.routes for v in r.visits], other]
                )
            ],
        )
        assert "group_multiple_served" in {v.code for v in both.violations}


def test_the_stops_decide_which_dock_wins(runs):
    north, south = runs["groups", 0], runs["groups_south", 0]
    assert north.groups[0].served_by != south.groups[0].served_by
    assert north.problem_fingerprint != south.problem_fingerprint
    # Mirror images of each other, so the cost is the same: only the winner changes.
    assert north.objective.total == south.objective.total == 312
