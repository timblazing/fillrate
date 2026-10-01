"""Build truckloads for one cluster with PyVRP (spec §1 step 3, §3, §8a).

Semantics for the pinned PyVRP 0.14.0 (see tests/test_pyvrp_capabilities.py):

- Open routes are not native: every vehicle type has an end depot. The
  workaround gives every stop → depot edge zero distance, so the return leg
  costs nothing and is excluded from reported distance.
- Prohibited legs are omitted from the model. PyVRP fills missing edges with
  a large finite cost (``pyvrp.constants.MAX_VALUE``), not a hard constraint,
  so a solution can still use one when no alternative exists. ``validate_loads``
  catches that and the result is reported infeasible.
- Linear feet (integer hundredths of a foot) are the only load dimension.
- Truck count is unlimited: one vehicle is available per stop.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from math import gcd

import numpy as np
import pyvrp
from pyvrp.constants import MAX_VALUE
from pyvrp.stop import MaxIterations, MaxRuntime, MultipleCriteria

from .travel import DEFAULT_CIRCUITY, DEFAULT_MAX_LEG_M, distance_matrix_m, prohibited_legs

TRAILER_53FT = 5_300  # hundredths of a foot


@dataclass(frozen=True)
class Stop:
    id: str
    lat: float
    lon: float
    load: int  # hundredths of a foot


@dataclass(frozen=True)
class LoadProblem:
    depot_lat: float
    depot_lon: float
    stops: list[Stop]
    capacity: int = TRAILER_53FT
    fixed_cost_per_truck: int = 0
    circuity: float = DEFAULT_CIRCUITY
    max_leg_m: int = DEFAULT_MAX_LEG_M
    seed: int = 0
    max_iterations: int = 2_000
    max_runtime_s: float | None = None


@dataclass
class Truck:
    stop_ids: list[str]
    load: int
    distance_m: int  # depot → last stop; the zero-cost return leg adds nothing


@dataclass
class Violation:
    code: str
    message: str
    truck: int | None = None
    stop_id: str | None = None


@dataclass
class LoadResult:
    trucks: list[Truck]
    feasible: bool
    solver_feasible: bool
    violations: list[Violation] = field(default_factory=list)
    cost: int | None = None
    iterations: int = 0
    runtime_s: float = 0.0


def problem_matrix(problem: LoadProblem) -> np.ndarray:
    """Distance matrix in meters; index 0 is the depot, then stops in input order."""
    coords = [(problem.depot_lat, problem.depot_lon)] + [(s.lat, s.lon) for s in problem.stops]
    return distance_matrix_m(np.array(coords), problem.circuity)


def build_model(problem: LoadProblem, distance: np.ndarray) -> pyvrp.Model:
    for stop in problem.stops:
        if stop.load > problem.capacity:
            raise ValueError(
                f"stop {stop.id} load {stop.load} exceeds trailer capacity {problem.capacity};"
                " split oversize stops before building loads"
            )
        if stop.load <= 0:
            raise ValueError(f"stop {stop.id} has no load")

    prohibited = prohibited_legs(distance, problem.max_leg_m)
    model = pyvrp.Model()
    # Location coordinates are informational; all costs come from explicit edges.
    locations = [model.add_location(problem.depot_lon, problem.depot_lat, name="depot")]
    depot = model.add_depot(locations[0], name="depot")
    for stop in problem.stops:
        loc = model.add_location(stop.lon, stop.lat, name=stop.id)
        locations.append(loc)
        model.add_client(loc, delivery=[stop.load], name=stop.id)

    model.add_vehicle_type(
        num_available=max(1, len(problem.stops)),
        capacity=[problem.capacity],
        start_depot=depot,
        end_depot=depot,
        fixed_cost=problem.fixed_cost_per_truck,
        name="53ft",
    )

    for i, frm in enumerate(locations):
        for j, to in enumerate(locations):
            if i == j:
                continue
            if j == 0:
                model.add_edge(frm, to, 0)  # open-route workaround
            elif not prohibited[i, j]:
                model.add_edge(frm, to, int(distance[i, j]))
    return model


def validate_loads(
    problem: LoadProblem, trucks: list[Truck], distance: np.ndarray
) -> list[Violation]:
    """Independent check of solver output against the real matrix (spec §16)."""
    violations: list[Violation] = []
    index = {s.id: i + 1 for i, s in enumerate(problem.stops)}
    loads = {s.id: s.load for s in problem.stops}
    seen: dict[str, int] = {}

    for t, truck in enumerate(trucks):
        if not truck.stop_ids:
            violations.append(Violation("empty_truck", "Truck has no stops.", truck=t))
            continue
        for stop_id in truck.stop_ids:
            if stop_id not in index:
                violations.append(Violation("unknown_stop", f"Unknown stop {stop_id}.", t, stop_id))
            elif stop_id in seen:
                violations.append(
                    Violation(
                        "duplicate_stop", f"Stop {stop_id} is on more than one truck.", t, stop_id
                    )
                )
            seen.setdefault(stop_id, t)

        load = sum(loads.get(s, 0) for s in truck.stop_ids)
        if load > problem.capacity:
            violations.append(
                Violation("over_capacity", f"Load {load} exceeds capacity {problem.capacity}.", t)
            )
        if load != truck.load:
            violations.append(
                Violation("load_mismatch", f"Reported load {truck.load} ≠ {load}.", t)
            )

        path = [0] + [index[s] for s in truck.stop_ids if s in index]
        for a, b in zip(path, path[1:], strict=False):
            if distance[a, b] > problem.max_leg_m:
                to_id = problem.stops[b - 1].id
                violations.append(
                    Violation(
                        "leg_too_long",
                        f"Leg to {to_id} is {distance[a, b]} m; limit {problem.max_leg_m} m.",
                        t,
                        to_id,
                    )
                )

    for stop in problem.stops:
        if stop.id not in seen:
            violations.append(
                Violation("unassigned_stop", f"Stop {stop.id} is not loaded.", None, stop.id)
            )
    return violations


def solve_loads(problem: LoadProblem) -> LoadResult:
    if not problem.stops:
        return LoadResult(trucks=[], feasible=True, solver_feasible=True, cost=0)

    distance = problem_matrix(problem)
    model = build_model(problem, distance)
    stop = MaxIterations(problem.max_iterations)
    if problem.max_runtime_s is not None:
        stop = MultipleCriteria([stop, MaxRuntime(problem.max_runtime_s)])
    result = model.solve(stop, seed=problem.seed, display=False)

    trucks: list[Truck] = []
    for route in result.best.routes():
        ids = [problem.stops[a.idx].id for a in route if a.is_client()]
        trucks.append(
            Truck(
                stop_ids=ids,
                load=int(route.delivery()[0]),
                distance_m=int(route.distance()),
            )
        )

    violations = validate_loads(problem, trucks, distance)
    return LoadResult(
        trucks=trucks,
        feasible=result.is_feasible() and not violations,
        solver_feasible=result.is_feasible(),
        violations=violations,
        cost=int(result.cost()) if result.is_feasible() else None,
        iterations=result.num_iterations,
        runtime_s=result.runtime,
    )


# ---- Pipeline partitions (spec §8a step 5–6, §8b) ---------------------------------------------
#
# A partition has one depot node plus one node per distinct location; several
# visits (split bundles) can share a location node. Only allowed physical legs
# become model edges; every return to the depot is free (open routes).


@dataclass(frozen=True)
class PartitionVisit:
    id: str
    node: int  # index into the partition's distance matrix; 0 is the depot
    load: int


@dataclass(frozen=True)
class PartitionProblem:
    distance: np.ndarray  # raw directed meters, (m + 1) × (m + 1)
    visits: list[PartitionVisit]
    capacity: int
    max_leg_m: int
    truck_penalty: int
    distance_cost: int = 1
    seed: int = 0
    max_iterations: int | None = None
    max_runtime_s: float = 10.0


@dataclass
class PartitionResult:
    routes: list[list[int]]  # visit indices, in service order
    solver_feasible: bool
    iterations: int
    runtime_s: float
    cost: int | None


def truck_count_first_penalty(num_visits: int, max_leg_m: int) -> tuple[int, int]:
    """Derived dominance penalty F = n·L + 1 (spec §8b).

    An open route over n mandatory visits has exactly n physical legs, each at
    most L, so any feasible plan's distance is at most B = n·L. With a fixed
    truck cost F > B, a feasible plan with fewer trucks always has a lower
    objective than one with more. Returns (F, B).
    """
    bound = num_visits * max_leg_m
    return bound + 1, bound


@dataclass(frozen=True)
class MonetaryObjective:
    truck_penalty: int
    distance_cost: int
    # Integer objective × numerator / denominator gives exact cents.
    cents_numerator: int
    cents_denominator: int = 201_168


def monetary_objective(truck_cents: int, mile_cents: int) -> MonetaryObjective:
    """Exact rational monetary ordering, including zero truck or mileage rates.

    An international mile is exactly 201168/125 meters. Reduce the integer
    coefficients together; physical distances remain meters for validation.
    """
    if any(type(rate) is not int or rate < 0 for rate in (truck_cents, mile_cents)):
        raise ValueError("cost rates must be nonnegative integer cents")
    fixed, distance = truck_cents * 201_168, mile_cents * 125
    divisor = gcd(fixed, distance) or 1
    return MonetaryObjective(fixed // divisor, distance // divisor, divisor)


def check_objective_range(
    num_visits: int, truck_penalty: int, max_leg_m: int, distance_cost: int = 1
) -> None:
    """Bound all costs without rounding monetary rates or risking overflow."""
    if truck_penalty < 0 or distance_cost < 0:
        raise ValueError("objective coefficients must be nonnegative")
    worst = num_visits * truck_penalty + num_visits * max_leg_m * distance_cost
    if worst >= MAX_VALUE // 4:
        raise ValueError(
            f"objective range {worst} exceeds the safe bound for pinned PyVRP ({MAX_VALUE // 4});"
            " reduce the cluster size, leg limit or cost rates"
        )


def solve_partition(problem: PartitionProblem) -> PartitionResult:
    if not problem.visits:
        return PartitionResult([], True, 0, 0.0, 0)
    for visit in problem.visits:
        if not 0 < visit.load <= problem.capacity:
            raise ValueError(f"visit {visit.id} load {visit.load} is outside (0, capacity]")
    check_objective_range(
        len(problem.visits), problem.truck_penalty, problem.max_leg_m, problem.distance_cost
    )

    distance = problem.distance
    nodes = distance.shape[0]
    model = pyvrp.Model()
    locations = [model.add_location(0, i, name=f"node-{i}") for i in range(nodes)]
    depot = model.add_depot(locations[0], name="depot")
    for visit in problem.visits:
        model.add_client(locations[visit.node], delivery=[visit.load], name=visit.id)
    model.add_vehicle_type(
        num_available=len(problem.visits),
        capacity=[problem.capacity],
        start_depot=depot,
        end_depot=depot,
        fixed_cost=problem.truck_penalty,
        unit_distance_cost=problem.distance_cost,
        name="53ft",
    )
    for i in range(nodes):
        for j in range(nodes):
            if i == j:
                continue
            if j == 0:
                model.add_edge(locations[i], locations[0], 0)  # open-route workaround
            elif distance[i, j] <= problem.max_leg_m:
                model.add_edge(locations[i], locations[j], int(distance[i, j]))
            # Longer legs are omitted: PyVRP prices them at MAX_VALUE; validation rejects them.

    stop = MaxRuntime(problem.max_runtime_s)
    if problem.max_iterations is not None:
        stop = MultipleCriteria([MaxIterations(problem.max_iterations), stop])
    result = model.solve(stop, seed=problem.seed, display=False)
    routes = [[a.idx for a in route if a.is_client()] for route in result.best.routes()]
    return PartitionResult(
        routes=routes,
        solver_feasible=result.is_feasible(),
        iterations=result.num_iterations,
        runtime_s=result.runtime,
        cost=int(result.cost()) if result.is_feasible() else None,
    )
