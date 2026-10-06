"""Independent Solver Lab validation (spec §3 "Retain both solverFeasible and validatedFeasible").

``validate_plan`` recomputes every route from the instance and the raw matrices only: coverage,
per-dimension loads before and after each visit, vehicle counts per type, capacities, route limits,
distances, durations and the nominal objective. It never reads PyVRP's feasibility flag or costs;
`lab.solve` compares those with this result separately.

Each rule is a small function in ``ROUTE_CHECKS`` or ``PLAN_CHECKS`` so a later capability adds
its own rule (group membership, shipment precedence) without
editing the others.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field

from .schema import (
    LabFleetUse,
    LabGroupOutcome,
    LabInstance,
    LabObjective,
    LabPairOutcome,
    LabRoute,
    LabSkipped,
    LabTotals,
    LabTrip,
    LabViolation,
    LabVisit,
)
from .travel import LabMatrices, client_nodes, depot_nodes, stop_nodes


@dataclass(frozen=True)
class CandidateRoute:
    """One vehicle's ordered client IDs, from the solver or written by hand. ``start_depot`` and
    ``end_depot`` name the depots the route actually runs from and to; None means "its vehicle
    type's" (a hand-written route may name others, which ``check_route_depots`` rejects)."""

    vehicle_type: str
    client_ids: list[str]
    start_depot: str | None = None
    end_depot: str | None = None
    # Trips: client ids between reloads; None means one trip with ``client_ids``. ``reload_depots``
    # are the depot ids where the vehicle reloads between consecutive trips (one fewer than trips;
    # None means the vehicle type's first reload depot each time).
    trips: list[list[str]] | None = None
    reload_depots: list[str] | None = None

    def __post_init__(self):
        if self.trips is not None:  # the flat list is always the trips in order
            object.__setattr__(self, "client_ids", [cid for trip in self.trips for cid in trip])

    def trip_lists(self) -> list[list[str]]:
        return self.trips if self.trips is not None else [list(self.client_ids)]


@dataclass
class ValidatedPlan:
    routes: list[LabRoute]
    violations: list[LabViolation]
    objective: LabObjective
    totals: LabTotals
    fleet: list[LabFleetUse]
    skipped: list[LabSkipped] = field(default_factory=list)
    groups: list[LabGroupOutcome] = field(default_factory=list)
    pairs: list[LabPairOutcome] = field(default_factory=list)

    @property
    def feasible(self) -> bool:
        return not self.violations


# ---- Instance checks (structure; run by the schema and mirrored in TypeScript) ---------------


def instance_problems(instance: LabInstance) -> list[str]:
    problems: list[str] = []
    dims = instance.dimension_ids()
    ids = {c.id for c in instance.clients}
    by_id = {c.id: c for c in instance.clients}
    group_ids = [g.id for g in instance.groups or []]
    for gid, n in Counter(group_ids).items():
        if n > 1:
            problems.append(f"duplicate group id {gid!r}")
    seen_member: dict[str, str] = {}
    for g in instance.groups or []:
        for m in g.members:
            if m not in ids:
                problems.append(f"group {g.id} member {m!r} is not a client id")
                continue
            if m in seen_member:
                problems.append(f"client {m} is in groups {seen_member[m]} and {g.id}")
            seen_member[m] = g.id
            if by_id[m].required is not False:
                problems.append(
                    f"group {g.id} member {m} must be an optional client (required: false)"
                )
            if by_id[m].prize_value:
                problems.append(
                    f"group {g.id} member {m} has a prize: members carry none, the group decides"
                )
        if len(set(g.members)) != len(g.members):
            problems.append(f"group {g.id} lists a member twice")
    for client in instance.clients:
        if client.prize_value and client.is_required:
            problems.append(
                f"client {client.id} has a prize but is required: set required to false "
                "to let it be skipped, or remove the prize"
            )

    def unique(kind: str, ids: list[str]) -> None:
        for value, n in Counter(ids).items():
            if n > 1:
                problems.append(f"duplicate {kind} id {value!r}")

    unique("dimension", dims)
    stops = [s for _p, s, _k in instance.pair_stops()]
    unique(
        "location",
        [d.id for d in instance.depots] + [c.id for c in instance.clients] + [s.id for s in stops],
    )
    unique("pair", [pair.id for pair in instance.pairs or []])
    unique("vehicle type", [v.id for v in instance.vehicle_types])
    depot_ids = {d.id for d in instance.depots}
    for vt in instance.vehicle_types:
        for role, value in (("start_depot", vt.start_depot), ("end_depot", vt.end_depot)):
            if value is not None and value not in depot_ids:
                problems.append(f"vehicle type {vt.id} {role} {value!r} is not a depot id")

    planar = instance.coordinates == "planar"
    for place in [*instance.depots, *instance.clients, *stops]:
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
    for pair in instance.pairs or []:
        for key in pair.amount:
            if key not in known:
                problems.append(f"pair {pair.id} moves unknown dimension {key!r}")
    if instance.pairs and any(vt.reload_depots for vt in instance.vehicle_types):
        problems.append(
            "pickup-delivery pairs and reloads cannot be combined yet: remove reload_depots "
            "or the pairs"
        )
    for vt in instance.vehicle_types:
        reload_ids = vt.reload_depots or []
        max_reloads = vt.max_reloads or 0
        for rid in reload_ids:
            if rid not in depot_ids:
                problems.append(f"vehicle type {vt.id} reload depot {rid!r} is not a depot id")
        if len(set(reload_ids)) != len(reload_ids):
            problems.append(f"vehicle type {vt.id} lists a reload depot twice")
        if max_reloads > 0 and not reload_ids:
            problems.append(f"vehicle type {vt.id} max_reloads needs at least one reload depot")
        if reload_ids and max_reloads == 0:
            problems.append(f"vehicle type {vt.id} reload_depots need max_reloads of at least 1")
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
    for pair in instance.pairs or []:
        demand = instance.amount_vector(pair)
        if not any(
            all(q <= c for q, c in zip(demand, instance.capacity_vector(vt), strict=True))
            for vt in instance.vehicle_types
        ):
            problems.append(f"pair {pair.id} amount {pair.amount} fits no vehicle type's capacity")
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
    nodes = stop_nodes(instance)
    for pair in instance.pairs or []:
        demand = instance.amount_vector(pair)
        pick, drop = nodes[pair.pickup.id], nodes[pair.delivery.id]
        busy_service = pair.pickup.service_duration + pair.delivery.service_duration
        best: tuple[int, int] | None = None
        servable = False
        for vt in instance.vehicle_types:
            if not all(q <= c for q, c in zip(demand, instance.capacity_vector(vt), strict=True)):
                continue
            start = depots[instance.start_depot_of(vt)]
            end = depots[instance.end_depot_of(vt)]
            trip = int(dist[start, pick] + dist[pick, drop] + dist[drop, end])
            busy = int(dur[start, pick] + dur[pick, drop] + dur[drop, end]) + busy_service
            best = min(best or (trip, busy), (trip, busy))
            servable |= (vt.max_distance is None or trip <= vt.max_distance) and (
                vt.shift_duration is None or busy <= vt.shift_duration
            )
        if not servable:
            trip, busy = best or (0, 0)
            findings.append(
                f"pair {pair.id}: no vehicle type can carry it and serve pickup and delivery "
                f"alone within its max distance and shift (shortest trip {trip} "
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
    # pair stop id → (pair id, "pickup" | "delivery", amount vector)
    stop_info: dict[str, tuple[str, str, list[int]]] = field(default_factory=dict)
    stop_service: dict[str, int] = field(default_factory=dict)  # pair stop id → service duration
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


def check_route_trips(ctx: Context, index: int, route: CandidateRoute) -> None:
    """Reloads happen only at the vehicle type's reload depots, at most max_reloads times, and no
    trip is empty."""
    vt = next((v for v in ctx.instance.vehicle_types if v.id == route.vehicle_type), None)
    if vt is None:
        return
    trips = route.trip_lists()
    reloads = len(trips) - 1
    allowed = (vt.max_reloads or 0) if vt.reload_depots else 0
    if reloads > allowed:
        ctx.flag(
            "too_many_reloads",
            f"Route reloads {reloads} times; {vt.id} allows {allowed}.",
            route=index,
            vehicle_type=vt.id,
        )
    for t, ids in enumerate(trips):
        if not ids and len(trips) > 1:
            ctx.flag("empty_trip", f"Trip {t + 1} has no visits.", route=index, trip=t)
    for depot_id in route.reload_depots or []:
        if depot_id not in ctx.depot_node:
            ctx.flag("unknown_depot", f"Unknown reload depot {depot_id}.", route=index)
        elif depot_id not in (vt.reload_depots or []):
            ctx.flag(
                "wrong_reload_depot",
                f"{vt.id} cannot reload at {depot_id}.",
                route=index,
                vehicle_type=vt.id,
            )


def check_route_capacity(ctx: Context, index: int, route: CandidateRoute) -> None:
    """Every trip fits the vehicle's capacity on its own (the load resets at each reload)."""
    vt = next((v for v in ctx.instance.vehicle_types if v.id == route.vehicle_type), None)
    if vt is None:
        return
    for trip in ctx.routes[-1].trips:
        for dim in ctx.instance.dimension_ids():
            if trip.peak_load[dim] > vt.capacity[dim]:
                ctx.flag(
                    "over_capacity",
                    f"Load {trip.peak_load[dim]} exceeds {vt.id} capacity "
                    f"{vt.capacity[dim]} in {dim}"
                    + (f" on trip {trip.index + 1}." if len(ctx.routes[-1].trips) > 1 else "."),
                    route=index,
                    vehicle_type=vt.id,
                    dimension=dim,
                    trip=trip.index,
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
            if not client.is_required:
                continue  # an optional client may be skipped; its prize is reported, not flagged
            ctx.flag(
                "client_not_visited", f"Client {client.id} is not visited.", client_id=client.id
            )
        elif seen[client.id] > 1:
            ctx.flag(
                "duplicate_visit",
                f"Client {client.id} is visited {seen[client.id]} times.",
                client_id=client.id,
            )


def check_groups(ctx: Context) -> None:
    """A required group is served by exactly one member, an optional group by at most one."""
    seen = Counter(cid for r in ctx.candidate for cid in r.client_ids if cid in ctx.node)
    for group in ctx.instance.groups or []:
        served = [m for m in group.members if seen[m] > 0]
        visits = sum(seen[m] for m in group.members)
        if visits > 1:
            ctx.flag(
                "group_multiple_served",
                f"Group {group.id} is served {visits} times ({', '.join(served)}); "
                "its members are alternatives, so only one may be visited.",
            )
        elif visits == 0 and group.required:
            ctx.flag("group_not_served", f"Required group {group.id} is not served by any member.")


def pair_positions(ctx: Context) -> dict[str, dict[str, list[tuple[int, int]]]]:
    """pair id → {"pickup" | "delivery": [(route index, position in that route's visit list)]}."""
    found: dict[str, dict[str, list[tuple[int, int]]]] = {}
    for r, route in enumerate(ctx.candidate):
        for position, cid in enumerate(route.client_ids):
            if cid in ctx.stop_info:
                pair_id, kind, _amount = ctx.stop_info[cid]
                found.setdefault(pair_id, {"pickup": [], "delivery": []})[kind].append(
                    (r, position)
                )
    return found


def check_pairs(ctx: Context) -> None:
    """A pair's pickup and delivery are visited exactly once, on the same route, pickup first."""
    found = pair_positions(ctx)
    for pair in ctx.instance.pairs or []:
        spots = found.get(pair.id, {"pickup": [], "delivery": []})
        pick, drop = spots["pickup"], spots["delivery"]
        for stop, where in ((pair.pickup, pick), (pair.delivery, drop)):
            if len(where) > 1:
                ctx.flag(
                    "duplicate_visit",
                    f"Stop {stop.id} is visited {len(where)} times.",
                    client_id=stop.id,
                )
        if not pick and not drop:
            ctx.flag("pair_not_served", f"Pair {pair.id} is not served.")
        elif not pick or not drop:
            ctx.flag(
                "pair_incomplete",
                f"Pair {pair.id} has only its {'pickup' if pick else 'delivery'} visited.",
            )
        elif pick[0][0] != drop[0][0]:
            ctx.flag(
                "pair_split",
                f"Pair {pair.id} is picked up on route {pick[0][0] + 1} but delivered on route "
                f"{drop[0][0] + 1}: both stops must be on one vehicle.",
                route=pick[0][0],
            )
        elif drop[0][1] < pick[0][1]:
            ctx.flag(
                "pair_order",
                f"Pair {pair.id} is delivered before it is picked up.",
                route=pick[0][0],
            )


def pair_outcomes(ctx: Context) -> list[LabPairOutcome]:
    found = pair_positions(ctx)
    spans: dict[str, tuple[int, int, int]] = {}
    for pair in ctx.instance.pairs or []:
        spots = found.get(pair.id)
        if (
            spots
            and spots["pickup"]
            and spots["delivery"]
            and spots["pickup"][0][0] == spots["delivery"][0][0]
        ):
            spans[pair.id] = (spots["pickup"][0][0], spots["pickup"][0][1], spots["delivery"][0][1])
    out = []
    for pair in ctx.instance.pairs or []:
        if pair.id not in spans:
            out.append(
                LabPairOutcome(
                    pair_id=pair.id,
                    route=None,
                    pickup_position=None,
                    delivery_position=None,
                    shared_with=[],
                )
            )
            continue
        r, lo, hi = spans[pair.id]
        shared = [
            other
            for other, (r2, lo2, hi2) in spans.items()
            if other != pair.id and r2 == r and lo2 < hi and lo < hi2
        ]
        out.append(
            LabPairOutcome(
                pair_id=pair.id,
                route=r,
                pickup_position=lo,
                delivery_position=hi,
                shared_with=shared,
            )
        )
    return out


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
    check_route_trips,
    check_route_capacity,
    check_route_limits,
]
PLAN_CHECKS: list[PlanCheck] = [check_coverage, check_groups, check_pairs, check_fleet]


def build_route(ctx: Context, index: int, route: CandidateRoute) -> LabRoute:
    """Recompute one route: trips, loads per trip, schedule (no waiting: lab routes have no time
    windows), costs. A trip runs from the start depot or a reload depot to the next reload depot or
    the end depot; the vehicle is full again after every reload."""
    instance, dist, dur = ctx.instance, ctx.matrices.distance, ctx.matrices.duration
    dims = instance.dimension_ids()
    clients = {c.id: c for c in instance.clients}
    vt = next((v for v in instance.vehicle_types if v.id == route.vehicle_type), None)
    trips = [[cid for cid in trip if cid in ctx.node] for trip in route.trip_lists()]
    start_id = route.start_depot or (instance.start_depot_of(vt) if vt else instance.depot.id)
    end_id = route.end_depot or (instance.end_depot_of(vt) if vt else instance.depot.id)
    default_reload = vt.reload_depots[0] if vt and vt.reload_depots else start_id
    reloads = list(route.reload_depots or [])
    reloads += [default_reload] * max(0, len(trips) - 1 - len(reloads))
    # Depot at each end of each trip: start, reload 1, ..., reload k, end.
    stops = [start_id, *reloads[: max(0, len(trips) - 1)], end_id]
    node = lambda depot_id: ctx.depot_node.get(depot_id, 0)  # noqa: E731
    visits: list[LabVisit] = []
    trip_docs: list[LabTrip] = []
    capacity = vt.capacity if vt else {}
    total_load = dict.fromkeys(dims, 0)
    clock, distance, travel, service = 0, 0, 0, 0
    for t, ids in enumerate(trips):
        prev = node(stops[t])
        # The vehicle leaves loaded with every client delivery of the trip; pair amounts join at
        # their pickup and leave at their delivery.
        on_board = {
            d: sum(clients[cid].delivery.get(d, 0) for cid in ids if cid in clients) for d in dims
        }
        trip_load = dict(on_board)
        peak = dict(on_board)
        trip_distance = 0
        for cid in ids:
            n = ctx.node[cid]
            leg_d, leg_t = int(dist[prev, n]), int(dur[prev, n])
            arrival = clock + leg_t
            if cid in ctx.stop_info:
                pair_id, kind, amount = ctx.stop_info[cid]
                sign = 1 if kind == "pickup" else -1
                after = {d: on_board[d] + sign * amount[k] for k, d in enumerate(dims)}
                sd = ctx.stop_service[cid]
            else:
                pair_id, kind = None, "client"
                after = {d: on_board[d] - clients[cid].delivery.get(d, 0) for d in dims}
                sd = clients[cid].service_duration
            peak = {d: max(peak[d], after[d]) for d in dims}
            visits.append(
                LabVisit(
                    client_id=cid,
                    kind=kind,
                    pair=pair_id,
                    trip=t,
                    load_before=dict(on_board),
                    load_after=after,
                    leg_distance=leg_d,
                    leg_duration=leg_t,
                    arrival=arrival,
                    service_duration=sd,
                    departure=arrival + sd,
                )
            )
            on_board, clock, prev = after, arrival + sd, n
            trip_distance += leg_d
            distance, travel, service = distance + leg_d, travel + leg_t, service + sd
        if ids or len(trips) > 1:  # the trip ends at its reload depot or the route's end depot
            back = node(stops[t + 1])
            trip_distance += int(dist[prev, back])
            distance += int(dist[prev, back])
            travel += int(dur[prev, back])
            clock += int(dur[prev, back])
        for d in dims:
            total_load[d] += trip_load[d]
        trip_docs.append(
            LabTrip(
                index=t,
                from_depot=stops[t],
                to_depot=stops[t + 1],
                client_ids=ids,
                load=trip_load,
                peak_load=peak,
                utilization={
                    d: round(peak[d] / capacity[d], 4) if capacity.get(d) else 0.0 for d in dims
                },
                distance=trip_distance,
            )
        )
    fixed = vt.fixed_cost if vt else 0
    d_cost = (vt.unit_distance_cost if vt else 0) * distance
    t_cost = (vt.unit_duration_cost if vt else 0) * clock
    return LabRoute(
        index=index,
        vehicle_type=route.vehicle_type,
        start_depot=start_id,
        end_depot=end_id,
        trips=trip_docs,
        visits=visits,
        load=total_load,
        peak_load={d: max(t.peak_load[d] for t in trip_docs) for d in dims},
        utilization={d: max(t.utilization[d] for t in trip_docs) for d in dims},
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
        node={**client_nodes(instance), **stop_nodes(instance)},
        depot_node=depot_nodes(instance),
        stop_info={
            stop.id: (pair.id, kind, instance.amount_vector(pair))
            for pair, stop, kind in instance.pair_stops()
        },
        stop_service={s.id: s.service_duration for _p, s, _k in instance.pair_stops()},
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
    visited = {v.client_id for r in routes for v in r.visits if v.kind == "client"}
    in_group = instance.group_of()
    # Unvisited group members are alternatives not taken, not skipped prizes: reported per group.
    skipped = [
        LabSkipped(client_id=c.id, prize=c.prize_value)
        for c in instance.clients
        if not c.is_required and c.id not in visited and c.id not in in_group
    ]
    outcomes = []
    for g in instance.groups or []:
        served = [m for m in g.members if m in visited]
        outcomes.append(
            LabGroupOutcome(
                group_id=g.id, required=g.required, served_by=served[0] if served else None
            )
        )
    uncollected = sum(s.prize for s in skipped)
    nominal = sum(r.cost for r in routes)
    return ValidatedPlan(
        routes=routes,
        violations=ctx.violations,
        skipped=skipped,
        groups=outcomes,
        pairs=pair_outcomes(ctx),
        objective=LabObjective(
            fixed_cost=sum(r.fixed_cost for r in routes),
            distance_cost=sum(r.distance_cost for r in routes),
            duration_cost=sum(r.duration_cost for r in routes),
            total=nominal,
            uncollected_prizes=uncollected,
            prizes_collected=sum(
                c.prize_value for c in instance.clients if not c.is_required and c.id in visited
            ),
            objective_with_prizes=nominal + uncollected,
        ),
        totals=LabTotals(
            routes=len(routes),
            clients_total=len(instance.clients),
            clients_served=len(visited),
            distance=sum(r.distance for r in routes),
            duration=sum(r.duration for r in routes),
            travel_duration=sum(r.travel_duration for r in routes),
            service_duration=sum(r.service_duration for r in routes),
            load={d: sum(r.load[d] for r in routes) for d in dims},
            pairs_total=len(instance.pairs or []),
            pairs_served=sum(1 for p in pair_outcomes(ctx) if p.route is not None),
        ),
        fleet=[
            LabFleetUse(vehicle_type=v.id, available=v.count, used=used[v.id])
            for v in instance.vehicle_types
        ],
    )
