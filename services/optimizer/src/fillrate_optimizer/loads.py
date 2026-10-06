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

from .timewin import VisitTime
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
        physical_distance = 0
        for a, b in zip(path, path[1:], strict=False):
            leg = int(distance[a, b])
            if leg < 0:
                violations.append(
                    Violation("unreachable_leg", "Route uses a missing provider edge.", t)
                )
            else:
                physical_distance += leg
            if leg > problem.max_leg_m:
                to_id = problem.stops[b - 1].id
                violations.append(
                    Violation(
                        "leg_too_long",
                        f"Leg to {to_id} is {distance[a, b]} m; limit {problem.max_leg_m} m.",
                        t,
                        to_id,
                    )
                )
        if all(distance[a, b] >= 0 for a, b in zip(path, path[1:], strict=False)) and (
            physical_distance != truck.distance_m
        ):
            violations.append(
                Violation(
                    "distance_mismatch",
                    f"Reported distance {truck.distance_m} ≠ "
                    f"physical distance {physical_distance}.",
                    t,
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
class PartitionTime:
    """Time-window adapter input (M6). Present only when windows or service durations exist.

    ``duration`` is the raw directed duration matrix in seconds (-1 = missing), same node order
    as the distance matrix. ``visits`` is parallel to ``PartitionProblem.visits``. Trucks leave
    the depot at ``depot_open_s`` and must be done by ``horizon_end_s``. Synthetic return edges
    have zero duration, so the route end equals the last departure.
    """

    duration: np.ndarray
    visits: list[VisitTime]
    depot_open_s: int
    horizon_end_s: int


@dataclass(frozen=True)
class PartitionVehicle:
    """One vehicle type of a partition's fleet (M6): becomes one PyVRP ``VehicleType``.

    ``available`` is how many vehicles of this type this partition may use: the type's fleet-wide
    count less what earlier clusters used (spec decisions: sequential allocation), or the visit
    count when the type is unlimited. ``fixed_cost`` and ``distance_cost`` are the exact integer
    PyVRP coefficients."""

    id: str
    capacity: int
    available: int
    fixed_cost: int
    distance_cost: int


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
    time: PartitionTime | None = None
    # M6 heterogeneous fleet. None: the single unlimited type of `capacity`, `truck_penalty` and
    # `distance_cost` (the model every earlier run used, unchanged).
    fleet: tuple[PartitionVehicle, ...] | None = None


@dataclass
class PartitionResult:
    routes: list[list[int]]  # visit indices, in service order
    solver_feasible: bool
    iterations: int
    runtime_s: float
    cost: int | None
    # Warm start only: PyVRP's objective of the initial solution on this problem.
    initial_cost: int | None = None
    # Fleet only: the vehicle type ID of each route, parallel to ``routes``.
    vehicle_types: list[str] | None = None


class WarmStartRejected(ValueError):
    """The initial routes are not a complete, PyVRP-feasible solution of this exact problem."""


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


@dataclass(frozen=True)
class FleetMonetaryObjective:
    """Per-type PyVRP coefficients, scaled by one common divisor so that
    ``objective × cents_numerator / cents_denominator`` is exactly cents."""

    coefficients: list[tuple[int, int]]  # (fixed_cost, distance_cost) per type, input order
    cents_numerator: int
    cents_denominator: int = 201_168


def fleet_monetary_objective(rates: list[tuple[int, int]]) -> FleetMonetaryObjective:
    """The exact rational cost objective of a fleet: each type's fixed cents and per-mile cents,
    reduced together by one common divisor (a mixed fleet shares one PyVRP objective). One type
    gives exactly ``monetary_objective``."""
    if not rates or any(type(rate) is not int or rate < 0 for pair in rates for rate in pair):
        raise ValueError("cost rates must be nonnegative integer cents")
    scaled = [(fixed * 201_168, mile * 125) for fixed, mile in rates]
    divisor = gcd(*[v for pair in scaled for v in pair]) or 1
    return FleetMonetaryObjective([(a // divisor, b // divisor) for a, b in scaled], divisor)


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


def build_partition_model(problem: PartitionProblem) -> pyvrp.Model:
    """The PyVRP model for one partition (inputs already validated by ``solve_partition``).

    Without ``problem.time`` the model carries no time data. With it: client ``tw_early`` /
    ``tw_late`` / ``service_duration`` and edge durations are native; the vehicle shift is
    [depot_open, horizon_end] and ``start_late`` pins the departure to depot_open. Depot windows
    stay open and return edges have zero duration, so the end depot never constrains and the
    route end equals the last departure. Time never enters the cost (unit_duration_cost 0).
    """
    distance, time = problem.distance, problem.time
    nodes = distance.shape[0]
    model = pyvrp.Model()
    locations = [model.add_location(0, i, name=f"node-{i}") for i in range(nodes)]
    depot = model.add_depot(locations[0], name="depot")
    for k, visit in enumerate(problem.visits):
        window: dict[str, int] = {}
        if time:
            vt = time.visits[k]
            window = {
                "service_duration": vt.service_s,
                "tw_early": vt.earliest_s if vt.earliest_s is not None else 0,
                "tw_late": vt.latest_s if vt.latest_s is not None else time.horizon_end_s,
            }
        model.add_client(locations[visit.node], delivery=[visit.load], name=visit.id, **window)
    shift: dict[str, int] = {}
    if time:
        shift = {
            "tw_early": time.depot_open_s,
            "tw_late": time.horizon_end_s,
            "start_late": time.depot_open_s,
        }
    if problem.fleet is None:
        model.add_vehicle_type(
            num_available=len(problem.visits),
            capacity=[problem.capacity],
            start_depot=depot,
            end_depot=depot,
            fixed_cost=problem.truck_penalty,
            unit_distance_cost=problem.distance_cost,
            name="53ft",
            **shift,
        )
    else:
        # One PyVRP vehicle type per fleet entry with a vehicle left for this partition, in fleet
        # order; ``fleet_types`` maps PyVRP's type index back to the fleet type ID.
        for vehicle in problem.fleet:
            if vehicle.available > 0:
                model.add_vehicle_type(
                    num_available=min(vehicle.available, len(problem.visits)),
                    capacity=[vehicle.capacity],
                    start_depot=depot,
                    end_depot=depot,
                    fixed_cost=vehicle.fixed_cost,
                    unit_distance_cost=vehicle.distance_cost,
                    name=vehicle.id,
                    **shift,
                )
    for i in range(nodes):
        for j in range(nodes):
            if i == j:
                continue
            if j == 0:
                model.add_edge(locations[i], locations[0], 0)  # open-route workaround
            elif 0 <= distance[i, j] <= problem.max_leg_m:
                if time is None:
                    model.add_edge(locations[i], locations[j], int(distance[i, j]))
                elif time.duration[i, j] >= 0:  # a leg without a duration is as good as missing
                    model.add_edge(
                        locations[i], locations[j], int(distance[i, j]), int(time.duration[i, j])
                    )
            # Missing/long legs are omitted. Independent validation rejects their use.
    return model


def initial_solution(
    data: pyvrp.ProblemData, routes: list[list[int]], types: list[int] | None = None
) -> tuple[pyvrp.Solution, int]:
    """A warm start on exactly `data`, with its objective (spec §3, §10).

    Pinned PyVRP 0.14.0 accepts an incomplete or infeasible initial solution, and even one built
    on different problem data, without complaint (tests/test_warm_start.py). Fillrate refuses those
    instead: every client exactly once, built on the same data, complete and feasible.
    """
    visited = sorted(k for route in routes for k in route)
    if visited != list(range(data.num_clients)) or any(not route for route in routes):
        raise WarmStartRejected("initial routes must visit every client exactly once")
    if types is None:
        solution = pyvrp.Solution(data, routes)
    else:
        if len(types) != len(routes) or any(not 0 <= t < data.num_vehicle_types for t in types):
            raise WarmStartRejected("initial routes need one available vehicle type each")
        try:
            solution = pyvrp.Solution(
                data, [pyvrp.Route(data, route, t) for route, t in zip(routes, types, strict=True)]
            )
        except (
            ValueError,
            RuntimeError,
        ) as error:  # more vehicles of a type than this partition may use
            raise WarmStartRejected(str(error)) from error
    if not solution.is_complete() or not solution.is_feasible():
        raise WarmStartRejected("PyVRP reports the initial solution incomplete or infeasible")
    cost = pyvrp.CostEvaluator([0] * len(solution.excess_load()), 0, 0).cost(solution)
    return solution, int(cost)


def solve_partition(
    problem: PartitionProblem,
    initial_routes: list[list[int]] | None = None,
    initial_types: list[str] | None = None,
) -> PartitionResult:
    """Solve one partition; `initial_routes` (visit indices) warm-starts PyVRP from a plan that
    the caller has already validated independently. It raises ``WarmStartRejected`` before any
    search when PyVRP does not see that plan as complete and feasible."""
    if not problem.visits:
        return PartitionResult([], True, 0, 0.0, 0)
    fleet = problem.fleet
    active = [v for v in fleet if v.available > 0] if fleet is not None else None
    largest = max(v.capacity for v in fleet) if fleet else problem.capacity
    for visit in problem.visits:
        if not 0 < visit.load <= largest:
            raise ValueError(f"visit {visit.id} load {visit.load} is outside (0, capacity]")
    check_objective_range(
        len(problem.visits),
        max(v.fixed_cost for v in fleet) if fleet else problem.truck_penalty,
        problem.max_leg_m,
        max(v.distance_cost for v in fleet) if fleet else problem.distance_cost,
    )
    if fleet is not None and not active:
        # Every vehicle of every type is already used by earlier clusters: no candidate.
        return PartitionResult([], False, 0, 0.0, None, vehicle_types=[])

    distance = problem.distance
    if (
        distance.ndim != 2
        or distance.shape[0] != distance.shape[1]
        or distance.dtype.kind not in "iu"
        or np.any(distance < -1)
        or np.any(np.diag(distance) != 0)
    ):
        raise ValueError(
            "partition matrix must be square integer meters with zero diagonal; -1 is missing"
        )
    nodes = distance.shape[0]
    if len({visit.id for visit in problem.visits}) != len(problem.visits) or any(
        not 0 < visit.node < nodes for visit in problem.visits
    ):
        raise ValueError("partition visits must have unique IDs and valid non-depot matrix nodes")
    if problem.time and (
        problem.time.duration.shape != distance.shape
        or len(problem.time.visits) != len(problem.visits)
        or not 0 <= problem.time.depot_open_s < problem.time.horizon_end_s
    ):
        raise ValueError("time data must match the partition matrix and visits")
    # `Model.solve` is `pyvrp.solve(model.data())`; one data object keeps the initial solution
    # on exactly the problem that is solved.
    data = build_partition_model(problem).data()
    initial_type_index = None
    if active is not None and initial_routes is not None:
        position = {v.id: k for k, v in enumerate(active)}
        if initial_types is None or any(t not in position for t in initial_types):
            raise WarmStartRejected("initial routes use a vehicle type with none available")
        initial_type_index = [position[t] for t in initial_types]
    initial, initial_cost = (
        initial_solution(data, initial_routes, initial_type_index)
        if initial_routes is not None
        else (None, None)
    )

    stop = MaxRuntime(problem.max_runtime_s)
    if problem.max_iterations is not None:
        stop = MultipleCriteria([MaxIterations(problem.max_iterations), stop])
    result = pyvrp.solve(data, stop, seed=problem.seed, display=False, initial_solution=initial)
    routes = [[a.idx for a in route if a.is_client()] for route in result.best.routes()]
    return PartitionResult(
        routes=routes,
        solver_feasible=result.is_feasible(),
        iterations=result.num_iterations,
        runtime_s=result.runtime,
        cost=int(result.cost()) if result.is_feasible() else None,
        initial_cost=initial_cost,
        vehicle_types=(
            [active[route.vehicle_type()].id for route in result.best.routes()]
            if active is not None
            else None
        ),
    )
