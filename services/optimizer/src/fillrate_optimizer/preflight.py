"""Submission policy checks mirrored by packages/db/src/preflight.ts.

These checks are user policy, not routing feasibility. Excluded lines do not
contribute to a stop's demand or its policy findings. With estimated travel the leg test is
haversine × circuity; with a selected travel snapshot it uses that directed matrix, so a stop
is "far" when the depot → stop leg is missing or over the limit, and "reachable via stops" when
a chain of allowed directed legs reaches it.
"""

from collections import defaultdict
from math import asin, cos, radians, sin, sqrt

from .model import PreflightFinding, RunSettings, ScenarioDocument
from .travel import EARTH_RADIUS_M, reachable
from .travel_provider import TravelSnapshot, stop_nodes


def _straight_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    a = (
        sin(radians(lat2 - lat1) / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * asin(sqrt(min(1, max(0, a))))


WARN_ONLY = {"far_via_stop"}


def _reachable_via_stops(depot, points: dict[str, tuple[float, float]], max_leg_m, circuity):
    """Locations reachable from the depot through a chain of drives each within the leg limit."""
    seen: set[str] = set()
    frontier = [(depot.lat, depot.lon)]
    while frontier:
        lat, lon = frontier.pop()
        for loc_id, (lat2, lon2) in points.items():
            if loc_id not in seen and (
                round(_straight_distance_m(lat, lon, lat2, lon2) * circuity) <= max_leg_m
            ):
                seen.add(loc_id)
                frontier.append((lat2, lon2))
    return seen


def _far_stops(
    scenario: ScenarioDocument,
    settings: RunSettings,
    points: dict[str, tuple[float, float]],
    snapshot: TravelSnapshot | None,
) -> tuple[set[str], set[str]]:
    """Stops whose direct leg from the depot is not allowed, and the stops reachable by a chain."""
    depot = scenario.depot
    if snapshot is None:
        circuity, limit = settings.travel_circuity, settings.max_leg_m
        far = {
            loc_id
            for loc_id, (lat, lon) in points.items()
            if round(_straight_distance_m(depot.lat, depot.lon, lat, lon) * circuity) > limit
        }
        return far, (_reachable_via_stops(depot, points, limit, circuity) if far else set())
    nodes = stop_nodes(depot.id, (depot.lat, depot.lon), points)
    meters, _ = snapshot.effective(nodes)
    far = {
        node.id
        for j, node in enumerate(nodes[1:], start=1)
        if not 0 <= meters[0, j] <= settings.max_leg_m
    }
    return far, {nodes[i].id for i in reachable(meters, settings.max_leg_m) if i > 0}


def preflight_checks(
    scenario: ScenarioDocument, settings: RunSettings, snapshot: TravelSnapshot | None = None
) -> list[PreflightFinding]:
    locations = {loc.id: loc for loc in scenario.locations}
    products = {product.id: product for product in scenario.products}
    all_ids = {line.id for order in scenario.orders for line in order.lines}
    excluded = set(settings.excluded_line_ids)
    if excluded - all_ids:
        raise ValueError("Unknown excluded line IDs: " + ", ".join(sorted(excluded - all_ids)))
    found: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    grouped: dict[tuple[str, str], list[tuple[str, int]]] = defaultdict(list)
    located_lines: dict[str, list[str]] = defaultdict(list)
    points: dict[str, tuple[float, float]] = {}
    for order in scenario.orders:
        loc = locations[order.location_id]
        active = [line for line in order.lines if line.ordered_pieces and line.id not in excluded]
        if not active:
            continue
        missing = loc.lat is None or loc.lon is None or loc.coordinate_source == "unresolved"
        if not missing:
            points[loc.id] = (loc.lat, loc.lon)
        for line in active:
            if missing:
                found["missing_coordinates"][loc.id].append(line.id)
            if not missing:
                located_lines[loc.id].append(line.id)
            if not missing and loc.coordinate_source == "zcta":
                found["approximate_coordinates"][loc.id].append(line.id)
            lf = line.linear_feet_per_piece or products[line.product_id].linear_feet_per_piece
            grouped[(loc.id, order.customer_id or order.id)].append(
                (line.id, line.ordered_pieces * lf)
            )
    far, chained = _far_stops(scenario, settings, points, snapshot)
    for loc_id in sorted(far):
        check = "far_via_stop" if loc_id in chained else "far_from_depot"
        found[check][loc_id].extend(located_lines[loc_id])
    for (loc_id, _customer_id), lines in grouped.items():
        if sum(load for _, load in lines) > settings.trailer_capacity:
            found["oversize_stop"][loc_id].extend(line_id for line_id, _ in lines)
    out = []
    for check in (
        "missing_coordinates",
        "far_from_depot",
        "oversize_stop",
        "far_via_stop",
        "approximate_coordinates",
    ):
        hits = found.get(check)
        if hits:
            line_ids = sorted(line_id for ids in hits.values() for line_id in ids)
            out.append(
                PreflightFinding(
                    check=check,
                    action="warn" if check in WARN_ONLY else getattr(settings.preflight, check),
                    location_ids=sorted(hits),
                    line_ids=line_ids,
                    message=f"{check}: {len(line_ids)} line(s) at {len(hits)} location(s).",
                )
            )
    return out
