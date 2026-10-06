"""Independent Solver Lab validation (spec §3 "Retain both solverFeasible and validatedFeasible").

``validate_plan`` recomputes every route from the instance and the raw matrices only: coverage,
per-dimension loads before and after each visit, vehicle counts per type, capacities, route limits,
distances, durations and the nominal objective. It never reads PyVRP's feasibility flag or costs;
`lab.solve` compares those with this result separately.

Each rule is a small function in ``ROUTE_CHECKS`` or ``PLAN_CHECKS`` so a later capability adds
its own rule (reload trips, optional prizes, group membership, shipment precedence) without
editing the others.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field

from .schema import (
    LabFleetUse,
    LabInstance,
    LabObjective,
    LabRoute,
    LabTotals,
    LabViolation,
    LabVisit,
)
from .travel import LabMatrices, client_nodes, depot_nodes


@dataclass(frozen=True)
class CandidateRoute:
    """One vehicle's ordered client IDs, from the solver or written by hand. ``start_depot`` and
    ``end_depot`` name the depots the route actually runs from and to; None means "its vehicle
    type's" (a hand-written route may name others, which ``check_route_depots`` rejects)."""

    vehicle_type: str
    client_ids: list[str]
    start_depot: str | None = None
    end_depot: str | None = None


@dataclass
class ValidatedPlan:
    routes: list[LabRoute]
    violations: list[LabViolation]
    objective: LabObjective
    totals: LabTotals
    fleet: list[LabFleetUse]

    @property
    def feasible(self) -> bool:
        return not self.violations


# ---- Instance checks (structure; run by the schema and mirrored in TypeScript) ---------------


def instance_problems(instance: LabInstance) -> list[str]:
    problems: list[str] = []
    dims = instance.dimension_ids()

    def unique(kind: str, ids: list[str]) -> None:
        for value, n in Counter(ids).items():
            if n > 1:
                problems.append(f"duplicate {kind} id {value!r}")

    unique("dimension", dims)
    unique("location", [d.id for d in instance.depots] + [c.id for c in instance.clients])
    unique("vehicle type", [v.id for v in instance.vehicle_types])
    depot_ids = {d.id for d in instance.depots}
    for vt in instance.vehicle_types:
        for role, value in (("start_depot", vt.start_depot), ("end_depot", vt.end_depot)):
            if value is not None and value not in depot_ids:
                problems.append(f"vehicle type {vt.id} {role} {value!r} is not a depot id")

    planar = instance.coordinates == "planar"
    for place in [*instance.depots, *instance.clients]:
        xy = place.x is not None and place.y is not None
        ll = place.lat is not None and place.lon is not None
        has_xy = place.x is not None or place.y is not None
        has_ll = place.lat is not None or place.lon is not None
        if planar and not (xy and not has_ll):
            problems.append(f"{place.id}: planar instances need x and y (and no lat/lon)")
        if not planar and not (ll and not has_xy):
            problems.append(f"{place.id}: geographic instances need lat and lon (and no x/y)")

    known = set(dims)
    for client in instance.clients:
        for key in client.delivery:
            if key not in known:
                problems.append(f"client {client.id} delivers unknown dimension {key!r}")
    for vt in instance.vehicle_types:
        if set(vt.capacity) != known:
            problems.append(
                f"vehicle type {vt.id} capacity must name exactly the dimensions {dims}"
            )
    if problems:
        return problems

    # Provable infeasibility (spec §10 preflight): an indivisible visit no vehicle type can carry.
    for client in instance.clients:
        demand = instance.delivery_vector(client)
        fits = any(
            all(q <= c for q, c in zip(demand, instance.capacity_vector(vt), strict=True))
            for vt in instance.vehicle_types
        )
        if not fits:
            problems.append(
                f"client {client.id} delivery {client.delivery} fits no vehicle type's capacity"
            )
    return problems


def preflight(instance: LabInstance, matrices: LabMatrices) -> list[str]:
    """Visits no vehicle type can serve even alone: out and back between the type's own start and
    end depots, over its distance or shift limit."""
    findings: list[str] = []
    dist, dur = matrices.distance, matrices.duration
    depots, clients = depot_nodes(instance), client_nodes(instance)
    for client in instance.clients:
        node = clients[client.id]
        demand = instance.delivery_vector(client)
        trips: list[tuple[int, int]] = []  # (distance, busy time) per type that can carry it
        servable = False
        for vt in instance.vehicle_types:
            if not all(q <= c for q, c in zip(demand, instance.capacity_vector(vt), strict=True)):
                continue
            start = depots[instance.start_depot_of(vt)]
            end = depots[instance.end_depot_of(vt)]
            trip = int(dist[start, node] + dist[node, end])
            busy = int(dur[start, node] + dur[node, end]) + client.service_duration
            trips.append((trip, busy))
            servable |= (vt.max_distance is None or trip <= vt.max_distance) and (
                vt.shift_duration is None or busy <= vt.shift_duration
            )
        if not servable:
            trip, busy = min(trips) if trips else (0, 0)
            findings.append(
                f"client {client.id}: no vehicle type can carry it and serve it alone from its "
                f"depots within its max distance and shift (shortest trip {trip} "
                f"{matrices.distance_unit}, {busy} {matrices.duration_unit} with service)"
            )
    return findings


# ---- Route and plan checks ---------------------------------------------------------------------


@dataclass
class Context:
    instance: LabInstance
    matrices: LabMatrices
    candidate: list[CandidateRoute]
    node: dict[str, int] = field(default_factory=dict)  # client id → matrix node
    depot_node: dict[str, int] = field(default_factory=dict)  # depot id → matrix node
    routes: list[LabRoute] = field(default_factory=list)
    violations: list[LabViolation] = field(default_factory=list)

    def flag(self, code: str, message: str, **where) -> None:
        self.violations.append(LabViolation(code=code, message=message, **where))


def check_route_clients(ctx: Context, index: int, route: CandidateRoute) -> None:
    if not route.client_ids:
        ctx.flag("empty_route", "Route has no visits.", route=index)
    for cid in route.client_ids:
        if cid not in ctx.node:
            ctx.flag("unknown_client", f"Unknown client {cid}.", route=index, client_id=cid)


def check_route_depots(ctx: Context, index: int, route: CandidateRoute) -> None:
    """A route starts and ends at its vehicle type's depots, and those depots exist."""
    vt = next((v for v in ctx.instance.vehicle_types if v.id == route.vehicle_type), None)
    if vt is None:
        return
    expected = (ctx.instance.start_depot_of(vt), ctx.instance.end_depot_of(vt))
    actual = (route.start_depot or expected[0], route.end_depot or expected[1])
    for role, want, got in zip(("start", "end"), expected, actual, strict=True):
        if got not in ctx.depot_node:
            ctx.flag(
                "unknown_depot",
                f"Unknown {role} depot {got}.",
                route=index,
                vehicle_type=vt.id,
            )
        elif got != want:
            ctx.flag(
                "wrong_depot",
                f"Route {role}s at {got}; vehicle type {vt.id} {role}s at {want}.",
                route=index,
                vehicle_type=vt.id,
            )


def check_route_capacity(ctx: Context, index: int, route: CandidateRoute) -> None:
    vt = next((v for v in ctx.instance.vehicle_types if v.id == route.vehicle_type), None)
    if vt is None:
        return
    load = ctx.routes[-1].load
    for dim in ctx.instance.dimension_ids():
        if load[dim] > vt.capacity[dim]:
            ctx.flag(
                "over_capacity",
                f"Load {load[dim]} exceeds {vt.id} capacity {vt.capacity[dim]} in {dim}.",
                route=index,
                vehicle_type=vt.id,
                dimension=dim,
            )


def check_route_limits(ctx: Context, index: int, route: CandidateRoute) -> None:
    vt = next((v for v in ctx.instance.vehicle_types if v.id == route.vehicle_type), None)
    if vt is None:
        return
    built = ctx.routes[-1]
    if vt.max_distance is not None and built.distance > vt.max_distance:
        ctx.flag(
            "max_distance_exceeded",
            f"Route distance {built.distance} exceeds {vt.id} max distance {vt.max_distance}.",
            route=index,
            vehicle_type=vt.id,
        )
    if vt.shift_duration is not None and built.duration > vt.shift_duration:
        ctx.flag(
            "shift_duration_exceeded",
            f"Route duration {built.duration} exceeds {vt.id} shift {vt.shift_duration}.",
            route=index,
            vehicle_type=vt.id,
        )


def check_coverage(ctx: Context) -> None:
    seen = Counter(cid for r in ctx.candidate for cid in r.client_ids if cid in ctx.node)
    for client in ctx.instance.clients:
        if seen[client.id] == 0:
            ctx.flag(
                "client_not_visited", f"Client {client.id} is not visited.", client_id=client.id
            )
        elif seen[client.id] > 1:
            ctx.flag(
                "duplicate_visit",
                f"Client {client.id} is visited {seen[client.id]} times.",
                client_id=client.id,
            )


def check_fleet(ctx: Context) -> None:
    used = Counter(r.vehicle_type for r in ctx.candidate)
    types = {v.id: v for v in ctx.instance.vehicle_types}
    for type_id, n in used.items():
        if type_id not in types:
            ctx.flag(
                "unknown_vehicle_type", f"Unknown vehicle type {type_id}.", vehicle_type=type_id
            )
        elif n > types[type_id].count:
            ctx.flag(
                "fleet_exceeded",
                f"{n} routes use {type_id}; only {types[type_id].count} are available.",
                vehicle_type=type_id,
            )


RouteCheck = Callable[[Context, int, CandidateRoute], None]
PlanCheck = Callable[[Context], None]
ROUTE_CHECKS: list[RouteCheck] = [
    check_route_clients,
    check_route_depots,
    check_route_capacity,
    check_route_limits,
]
PLAN_CHECKS: list[PlanCheck] = [check_coverage, check_fleet]


def build_route(ctx: Context, index: int, route: CandidateRoute) -> LabRoute:
    """Recompute one route: loads, schedule (no waiting: lab routes have no time windows), costs."""
    instance, dist, dur = ctx.instance, ctx.matrices.distance, ctx.matrices.duration
    dims = instance.dimension_ids()
    clients = {c.id: c for c in instance.clients}
    vt = next((v for v in instance.vehicle_types if v.id == route.vehicle_type), None)
    ids = [cid for cid in route.client_ids if cid in ctx.node]
    on_board = {d: sum(clients[cid].delivery.get(d, 0) for cid in ids) for d in dims}
    load = dict(on_board)
    visits: list[LabVisit] = []
    start_id = route.start_depot or (instance.start_depot_of(vt) if vt else instance.depot.id)
    end_id = route.end_depot or (instance.end_depot_of(vt) if vt else instance.depot.id)
    start = ctx.depot_node.get(start_id, 0)
    end = ctx.depot_node.get(end_id, 0)
    prev, clock, distance, travel, service = start, 0, 0, 0, 0
    for cid in ids:
        node = ctx.node[cid]
        leg_d, leg_t = int(dist[prev, node]), int(dur[prev, node])
        arrival = clock + leg_t
        after = {d: on_board[d] - clients[cid].delivery.get(d, 0) for d in dims}
        sd = clients[cid].service_duration
        visits.append(
            LabVisit(
                client_id=cid,
                load_before=dict(on_board),
                load_after=after,
                leg_distance=leg_d,
                leg_duration=leg_t,
                arrival=arrival,
                service_duration=sd,
                departure=arrival + sd,
            )
        )
        on_board, clock, prev = after, arrival + sd, node
        distance, travel, service = distance + leg_d, travel + leg_t, service + sd
    if ids:  # the route ends at its end depot
        distance += int(dist[prev, end])
        travel += int(dur[prev, end])
        clock += int(dur[prev, end])
    capacity = vt.capacity if vt else {}
    fixed = vt.fixed_cost if vt else 0
    d_cost = (vt.unit_distance_cost if vt else 0) * distance
    t_cost = (vt.unit_duration_cost if vt else 0) * clock
    return LabRoute(
        index=index,
        vehicle_type=route.vehicle_type,
        start_depot=start_id,
        end_depot=end_id,
        visits=visits,
        load=load,
        utilization={d: round(load[d] / capacity[d], 4) if capacity.get(d) else 0.0 for d in dims},
        distance=distance,
        duration=clock,
        travel_duration=travel,
        service_duration=service,
        fixed_cost=fixed,
        distance_cost=d_cost,
        duration_cost=t_cost,
        cost=fixed + d_cost + t_cost,
    )


def validate_plan(
    instance: LabInstance, matrices: LabMatrices, candidate: list[CandidateRoute]
) -> ValidatedPlan:
    ctx = Context(
        instance,
        matrices,
        candidate,
        node=client_nodes(instance),
        depot_node=depot_nodes(instance),
    )
    for index, route in enumerate(candidate):
        ctx.routes.append(build_route(ctx, index, route))
        for check in ROUTE_CHECKS:
            check(ctx, index, route)
    for check in PLAN_CHECKS:
        check(ctx)
    routes = ctx.routes
    used = Counter(r.vehicle_type for r in candidate)
    dims = instance.dimension_ids()
    return ValidatedPlan(
        routes=routes,
        violations=ctx.violations,
        objective=LabObjective(
            fixed_cost=sum(r.fixed_cost for r in routes),
            distance_cost=sum(r.distance_cost for r in routes),
            duration_cost=sum(r.duration_cost for r in routes),
            total=sum(r.cost for r in routes),
        ),
        totals=LabTotals(
            routes=len(routes),
            clients_total=len(instance.clients),
            clients_served=len({v.client_id for r in routes for v in r.visits}),
            distance=sum(r.distance for r in routes),
            duration=sum(r.duration for r in routes),
            travel_duration=sum(r.travel_duration for r in routes),
            service_duration=sum(r.service_duration for r in routes),
            load={d: sum(r.load[d] for r in routes) for d in dims},
        ),
        fleet=[
            LabFleetUse(vehicle_type=v.id, available=v.count, used=used[v.id])
            for v in instance.vehicle_types
        ],
    )
