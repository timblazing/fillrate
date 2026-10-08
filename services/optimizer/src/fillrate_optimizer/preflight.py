"""Submission policy checks mirrored by packages/db/src/preflight.ts.

These checks are user policy, not routing feasibility. Excluded lines do not
contribute to a stop's demand or its policy findings. With estimated travel the leg test is
haversine × circuity; with a selected travel snapshot it uses that directed matrix, so a stop
is "far" when the depot → stop leg is missing or over the limit, and "reachable via stops" when
a chain of allowed directed legs reaches it.
"""

from collections import defaultdict
from math import asin, cos, radians, sin, sqrt

import numpy as np

from .model import PreflightFinding, RunSettings, ScenarioDocument
from .timeplan import (
    TimeContext,
    estimated_seconds,
    shortest_seconds_from_depot,
    time_context,
)
from .travel import EARTH_RADIUS_M, distance_matrix_m, reachable
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


def _hms(seconds: float) -> str:
    total = int(seconds)
    return f"{total // 3600:02d}:{total % 3600 // 60:02d}:{total % 60:02d}"


def _time_findings(
    tctx: TimeContext,
    scenario: ScenarioDocument,
    settings: RunSettings,
    points: dict[str, tuple[float, float]],
    active: dict[str, list[str]],
    snapshot: TravelSnapshot | None,
) -> list[PreflightFinding]:
    """Provable time findings only. `window_unreachable` uses the shortest chain of allowed
    legs from the depot, ignoring other stops' service and waiting, so it is a lower bound on
    the earliest possible start: if even that misses the window, no plan can serve the stop."""
    empty: dict[str, str] = {}
    for loc_id in sorted(active):
        vt = tctx.locations.get(loc_id)
        if (
            vt
            and vt.earliest_s is not None
            and vt.latest_s is not None
            and (vt.earliest_s > vt.latest_s)
        ):
            empty[loc_id] = (
                f"{loc_id}: earliest {_hms(vt.earliest_s)} is after latest {_hms(vt.latest_s)}"
            )
    unreachable: dict[str, str] = {}
    depot = scenario.depot
    nodes = stop_nodes(depot.id, (depot.lat, depot.lon), points)
    if snapshot is None:
        coords = np.array([(n.lat, n.lon) for n in nodes])
        meters = distance_matrix_m(coords, settings.travel_circuity)
        seconds = estimated_seconds(coords, settings.travel_circuity)
    else:
        meters, seconds = snapshot.effective(nodes)
    shortest = shortest_seconds_from_depot(meters, seconds, settings.max_leg_m)
    for i, node in enumerate(nodes[1:], start=1):
        loc_id = node.id
        vt = tctx.locations.get(loc_id)
        if loc_id in empty or not np.isfinite(shortest[i]):
            continue
        earliest_arrival = tctx.depot_open_s + float(shortest[i])
        start = max(earliest_arrival, vt.earliest_s or 0) if vt else earliest_arrival
        service = vt.service_s if vt else 0
        base = (
            f"{loc_id}: shortest allowed drive from the depot is {_hms(shortest[i])}; leaving at "
            f"{_hms(tctx.depot_open_s)} the earliest arrival is {_hms(earliest_arrival)}"
        )
        if vt and vt.latest_s is not None and start > vt.latest_s:
            unreachable[loc_id] = f"{base}, after the window end {_hms(vt.latest_s)}"
        elif start + service > tctx.horizon_end_s:
            unreachable[loc_id] = (
                f"{base}; service would end at {_hms(start + service)}, after the horizon end "
                f"{_hms(tctx.horizon_end_s)}"
            )
    out = []
    for check, hits in (("window_empty", empty), ("window_unreachable", unreachable)):
        if hits:
            line_ids = sorted(line for loc in hits for line in active[loc])
            out.append(
                PreflightFinding(
                    check=check,
                    action="block",
                    location_ids=sorted(hits),
                    line_ids=line_ids,
                    message=f"{check}: " + "; ".join(hits[k] for k in sorted(hits)) + ".",
                )
            )
    return out


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
    active_lines: dict[str, list[str]] = defaultdict(list)
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
            active_lines[loc.id].append(line.id)
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
    if tctx := time_context(scenario):
        out.extend(_time_findings(tctx, scenario, settings, points, active_lines, snapshot))
    return out
