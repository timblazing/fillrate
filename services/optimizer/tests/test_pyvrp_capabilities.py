"""Capability fixtures for the pinned PyVRP release (spec §3, §15 M1).

Each test proves one behavior the capabilities document advertises, and
fails loudly if a PyVRP upgrade changes it.
"""

from importlib.metadata import version

import numpy as np
import pytest
import pyvrp
from pyvrp.constants import MAX_VALUE
from pyvrp.stop import MaxIterations

from fillrate_optimizer.loads import (
    TRAILER_53FT,
    LoadProblem,
    Truck,
    build_model,
    problem_matrix,
    solve_loads,
    validate_loads,
)
from fillrate_optimizer.travel import miles_to_m

from .conftest import MEMPHIS, east, north, stop

BIG_FIXED_COST = miles_to_m(10_000)


def problem(stops, **kwargs) -> LoadProblem:
    return LoadProblem(depot_lat=MEMPHIS[0], depot_lon=MEMPHIS[1], stops=stops, **kwargs)


def trucks_as_sets(result):
    return sorted(sorted(t.stop_ids) for t in result.trucks)


def test_pinned_pyvrp_version():
    # Upgrading PyVRP needs a recorded decision and a passing run of this file (spec §3).
    assert version("pyvrp") == "0.14.0"


def test_pyvrp_has_no_native_open_route_flag():
    # If this fails, the pinned release gained native open routes: switch the
    # open_routes behavior from "workaround" to "native".
    import inspect

    params = inspect.signature(pyvrp.Model.add_vehicle_type).parameters
    assert "end_depot" in params
    assert not any("open" in p for p in params)


def test_missing_edges_get_max_value_cost():
    m = pyvrp.Model()
    a = m.add_location(0, 0)
    b = m.add_location(1, 0)
    m.add_depot(a)
    m.add_client(b)
    m.add_vehicle_type()
    m.add_edge(a, b, 5)  # b → a is missing
    data = m.data()
    assert data.distance_matrix(0)[0, 1] == 5
    assert data.distance_matrix(0)[1, 0] == MAX_VALUE


def test_capacity_splits_across_trucks():
    stops = [stop(f"s{i}", east(50 + 10 * i), 3_000) for i in range(3)]
    result = solve_loads(problem(stops))
    assert result.feasible
    assert len(result.trucks) == 3
    assert all(t.load <= TRAILER_53FT for t in result.trucks)
    assert sorted(s for t in result.trucks for s in t.stop_ids) == ["s0", "s1", "s2"]


def test_fills_one_trailer_exactly():
    stops = [stop("a", east(40), 2_650), stop("b", east(60), 2_650)]
    result = solve_loads(problem(stops, fixed_cost_per_truck=BIG_FIXED_COST))
    assert result.feasible
    assert trucks_as_sets(result) == [["a", "b"]]
    assert result.trucks[0].load == TRAILER_53FT


def test_open_route_has_free_return():
    s = stop("far", east(200), 1_000)
    p = problem([s])
    result = solve_loads(p)
    one_way = int(problem_matrix(p)[0, 1])
    assert result.feasible
    assert result.trucks[0].distance_m == one_way
    assert result.cost == one_way


def test_closed_route_would_pay_the_return():
    # Control for the workaround: the same stop with a real return edge costs twice as much.
    p = problem([stop("far", east(200), 1_000)])
    d = problem_matrix(p)
    model = build_model(p, d)
    model.add_edge(model.locations[1], model.locations[0], int(d[1, 0]))  # overrides the 0 edge
    result = model.solve(MaxIterations(100), display=False)
    assert result.cost() == int(d[0, 1] + d[1, 0])


def test_open_route_changes_the_best_sequence():
    # Open: the truck ends at the far stop, so it visits near then far.
    stops = [stop("near", east(100), 1_000), stop("far", east(300), 1_000)]
    result = solve_loads(problem(stops, fixed_cost_per_truck=BIG_FIXED_COST))
    assert [t.stop_ids for t in result.trucks] == [["near", "far"]]


def test_fixed_cost_prefers_fewer_trucks():
    stops = [stop("e", east(100), 1_000), stop("w", east(-100), 1_000)]
    no_fixed = solve_loads(problem(stops))
    with_fixed = solve_loads(problem(stops, fixed_cost_per_truck=BIG_FIXED_COST))
    assert len(no_fixed.trucks) == 2  # two open routes are shorter than one out-and-across
    assert len(with_fixed.trucks) == 1


def test_prohibited_leg_is_avoided_when_possible():
    # e and w are each 300 mi from the depot (360 mi circuitous), but 720 mi from each other.
    stops = [stop("e", east(300), 1_000), stop("w", east(-300), 1_000)]
    allowed = solve_loads(
        problem(stops, fixed_cost_per_truck=BIG_FIXED_COST, max_leg_m=miles_to_m(5_000))
    )
    limited = solve_loads(problem(stops, fixed_cost_per_truck=BIG_FIXED_COST))
    assert trucks_as_sets(allowed) == [["e", "w"]]  # the fixed cost merges them when allowed
    assert trucks_as_sets(limited) == [["e"], ["w"]]  # the 500 mi limit splits them
    assert limited.feasible


def test_forced_prohibited_leg_is_caught_by_the_validator():
    # The only way to reach this stop is a 720 mi leg. PyVRP treats the missing
    # edge as a MAX_VALUE cost, not a hard constraint, so it still routes it and
    # calls the solution feasible. Our validator must reject it.
    result = solve_loads(problem([stop("too_far", north(600), 1_000)]))
    assert result.solver_feasible
    assert not result.feasible
    assert [v.code for v in result.violations] == ["leg_too_long"]
    assert result.trucks[0].distance_m == MAX_VALUE


def test_same_seed_is_deterministic():
    rng = np.random.default_rng(7)
    stops = [
        stop(
            f"s{i}",
            (MEMPHIS[0] + rng.uniform(-2, 2), MEMPHIS[1] + rng.uniform(-2, 2)),
            int(rng.integers(300, 2_500)),
        )
        for i in range(25)
    ]
    p = problem(stops, fixed_cost_per_truck=miles_to_m(200), seed=3, max_iterations=500)
    a, b = solve_loads(p), solve_loads(p)
    assert a.feasible
    assert [t.stop_ids for t in a.trucks] == [t.stop_ids for t in b.trucks]
    assert a.cost == b.cost


def test_oversize_stop_is_rejected():
    with pytest.raises(ValueError, match="split oversize stops"):
        solve_loads(problem([stop("big", east(10), TRAILER_53FT + 1)]))


def test_validator_flags_coverage_and_capacity():
    stops = [stop("a", east(10), 3_000), stop("b", east(20), 3_000), stop("c", east(30), 100)]
    p = problem(stops)
    d = problem_matrix(p)
    trucks = [Truck(["a", "b"], 6_000, 0), Truck(["b"], 3_000, 0)]
    codes = sorted(v.code for v in validate_loads(p, trucks, d))
    assert codes == ["duplicate_stop", "over_capacity", "unassigned_stop"]
