"""Road geometry for one inspected truck from Valhalla's Route API (spec §4, §7, §10, §13).

Display only. The plan was optimized and validated on the recorded travel snapshot; these paths are
Valhalla's route for the same physical legs, in the same order, and never prove which roads the
solver used. Each leg is checked against the snapshot's matrix and any difference is recorded.

Stateless and bounded: no SQLite, no resequencing, no synthetic return leg (the caller sends the
depot and the visits as validated), no retries. Endpoints come only from deployment configuration.
"""

from __future__ import annotations

import math
import os
import time
from collections.abc import Callable
from typing import Annotated, Any, Literal

from pydantic import Field

from .canonical import content_hash
from .model import Doc, Id
from .travel_provider import SnapshotBindingError, TravelNode, TravelSnapshot
from .valhalla import ProviderError, TransientProviderError, ValhallaConfig, post_json

GEOMETRY_VERSION = "fillrate-route-geometry/1"
DEFAULT_MAX_ROUTE_LOCATIONS = 20
MAX_STOPS = 1000
MAX_REQUESTS = 120
TOTAL_TIMEOUT_S = 90.0
MAX_POINTS_PER_LEG = 200_000
# A leg is "notable" only past both thresholds; every difference is recorded regardless.
NOTABLE_M = (50.0, 0.01)
NOTABLE_S = (30.0, 0.05)
NOTE = (
    "Valhalla's route for the same legs, shown for display. The plan was optimized on the recorded "
    "travel matrix; these paths do not prove which roads the solver used."
)

Reason = Literal[
    "estimated_travel", "imported_matrix", "provider_context_mismatch", "valhalla_not_configured"
]


class GeometryUnavailable(ValueError):
    """The run's travel data cannot honestly be drawn as Valhalla roads."""

    def __init__(self, reason: Reason, message: str):
        super().__init__(message)
        self.reason = reason


class GeometryError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class GeometryStop(Doc):
    """A node of the truck's physical sequence: the depot, then each visit's location in order."""

    id: Id
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    lon: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]


class RouteGeometryRequest(Doc):
    schema_version: Literal[1] = 1
    snapshot_id: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    snapshot: dict[str, Any]
    truck_id: Annotated[str, Field(min_length=1, max_length=200)]
    stops: Annotated[list[GeometryStop], Field(min_length=2, max_length=MAX_STOPS)]


class GeometryLeg(Doc):
    index: int
    from_id: str
    to_id: str
    status: Literal["ok", "same_location", "no_route", "rejected"]
    # [lon, lat] pairs (RFC 7946). None when Valhalla returned no path for this leg.
    coordinates: list[list[float]] | None = None
    route_m: float | None = None
    route_s: float | None = None
    # What the run used for this leg (rounded integer meters/seconds from the snapshot).
    matrix_m: int | None = None
    matrix_s: int | None = None
    delta_m: float | None = None
    delta_s: float | None = None
    relative_m: float | None = None
    relative_s: float | None = None
    notable: bool = False
    error: str | None = None


class RouteGeometryResponse(Doc):
    schema_version: Literal[1] = 1
    kind: Literal["valhalla_road"] = "valhalla_road"
    geometry_version: str = GEOMETRY_VERSION
    note: str = NOTE
    snapshot_id: str
    truck_id: str
    provider: dict[str, Any]
    legs: list[GeometryLeg]
    chunks: dict[str, Any]
    summary: dict[str, Any]


def max_route_locations(env: dict[str, str] | None = None) -> int:
    """The deployed `/route` location limit (Valhalla's `max_locations`); default 20."""
    raw = (env if env is not None else os.environ).get("VALHALLA_MAX_ROUTE_LOCATIONS")
    try:
        value = int(raw) if raw else DEFAULT_MAX_ROUTE_LOCATIONS
    except ValueError as error:
        raise GeometryError("valhalla_misconfigured", "Invalid route location limit") from error
    if not 2 <= value <= 200:
        raise GeometryError("valhalla_misconfigured", "Route location limit must be 2-200")
    return value


def deployment_identity(config: ValhallaConfig) -> dict[str, Any]:
    return {
        "provider": "valhalla",
        "version": config.provider_version,
        "dataset_revision": config.dataset_revision,
        "graph_config_hash": config.graph_config_hash,
        "costing": config.costing,
        "costing_options": config.costing_options,
    }


def check_context(snapshot: TravelSnapshot, config: ValhallaConfig | None) -> None:
    """Hard rule: only a Valhalla snapshot recorded under this deployment's identity."""
    if snapshot.provider == "haversine":
        raise GeometryUnavailable("estimated_travel", "Estimated travel has no road geometry.")
    if snapshot.provider != "valhalla":
        raise GeometryUnavailable("imported_matrix", "Imported matrices have no road geometry.")
    if config is None:
        raise GeometryUnavailable(
            "valhalla_not_configured", "Valhalla is not configured on this server."
        )
    options = snapshot.options
    recorded = {
        "version": snapshot.provider_version,
        "dataset_revision": snapshot.dataset_revision,
        "graph_config_hash": options.get("graph_config_hash"),
        "costing": snapshot.profile,
        "costing_options": options.get("costing_options"),
    }
    current = deployment_identity(config)
    differs = [
        name
        for name, value in recorded.items()
        if content_hash(value) != content_hash(current[name])
    ]
    if differs:
        raise GeometryUnavailable(
            "provider_context_mismatch",
            "This deployment's Valhalla differs from the snapshot's recorded context ("
            + ", ".join(differs)
            + "); geometry from it would not describe the same roads.",
        )


def decode_polyline6(shape: str) -> list[list[float]]:
    """Google-style encoded polyline at 1e-6 precision to [lon, lat] pairs."""
    if not isinstance(shape, str) or not shape:
        raise ProviderError("Valhalla leg has no shape")
    coords: list[list[float]] = []
    index = lat = lon = 0
    n = len(shape)

    def value() -> int:
        nonlocal index
        result = shift = 0
        while True:
            if index >= n:
                raise ProviderError("Valhalla shape is truncated")
            b = ord(shape[index]) - 63
            index += 1
            if not 0 <= b < 64:
                raise ProviderError("Valhalla shape has an invalid character")
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
            if shift > 60:
                raise ProviderError("Valhalla shape is malformed")
        return ~(result >> 1) if result & 1 else result >> 1

    while index < n:
        lat += value()
        lon += value()
        if len(coords) >= MAX_POINTS_PER_LEG:
            raise ProviderError("Valhalla leg shape is too long")
        coords.append([round(lon / 1e6, 6), round(lat / 1e6, 6)])
    return coords


def chunk_ranges(count: int, limit: int) -> list[tuple[int, int]]:
    """Inclusive-start/exclusive-end location ranges; consecutive chunks share one location."""
    if count < 2 or limit < 2:
        raise ValueError("need at least two locations and a limit of two")
    ranges, start = [], 0
    while start < count - 1:
        end = min(start + limit, count)
        ranges.append((start, end))
        start = end - 1
    return ranges


def _route_body(config: ValhallaConfig, stops: list[GeometryStop]) -> dict:
    return {
        "locations": [{"lat": s.lat, "lon": s.lon, "type": "break"} for s in stops],
        "costing": config.costing,
        "costing_options": {config.costing: config.costing_options},
        "units": "kilometers",
        "shape_format": "polyline6",
        "directions_type": "none",
    }


def _parse_legs(result: dict, expected: int) -> list[tuple[list[list[float]], float, float]]:
    if result.get("error") or result.get("error_code"):
        raise ProviderError("Valhalla rejected the route request")
    trip = result.get("trip")
    if not isinstance(trip, dict) or trip.get("units") != "kilometers":
        raise ProviderError("Valhalla route response units differ from kilometers")
    legs = trip.get("legs")
    if not isinstance(legs, list) or len(legs) != expected:
        raise ProviderError("Valhalla returned an unexpected number of legs")
    out = []
    for leg in legs:
        summary = leg.get("summary") if isinstance(leg, dict) else None
        if not isinstance(summary, dict):
            raise ProviderError("Valhalla leg has no summary")
        length, seconds = summary.get("length"), summary.get("time")
        if any(
            type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in (length, seconds)
        ):
            raise ProviderError("Valhalla leg length/time is invalid")
        out.append((decode_polyline6(leg.get("shape")), float(length) * 1000, float(seconds)))
    return out


def fetch_route_geometry(
    request: RouteGeometryRequest,
    config: ValhallaConfig | None,
    *,
    transport: Callable = post_json,
    clock: Callable = time.monotonic,
    max_locations: int | None = None,
) -> RouteGeometryResponse:
    """Geometry for the truck's legs in the given order, checked against the snapshot's matrix."""
    try:
        snapshot = TravelSnapshot.model_validate(request.snapshot)
    except ValueError as error:
        raise GeometryError("invalid_snapshot", "The travel snapshot is invalid.") from error
    if snapshot.identity != request.snapshot_id:
        raise GeometryError("travel_snapshot_identity", "The snapshot does not match its identity.")
    check_context(snapshot, config)
    assert config is not None
    limit = max_locations if max_locations is not None else max_route_locations()
    stops = request.stops
    nodes = {}
    for s in stops:
        nodes.setdefault(s.id, TravelNode(id=s.id, lat=s.lat, lon=s.lon))
        if nodes[s.id].lat != s.lat or nodes[s.id].lon != s.lon:
            raise GeometryError("stop_conflict", f"Node {s.id} has two coordinates.")
    order = list(nodes.values())
    try:
        meters, seconds = snapshot.effective(order)
    except SnapshotBindingError as error:
        raise GeometryError("travel_snapshot_mismatch", str(error)) from error
    position = {node.id: i for i, node in enumerate(order)}

    def same(a: GeometryStop, b: GeometryStop) -> bool:
        return round(a.lat, 6) == round(b.lat, 6) and round(a.lon, 6) == round(b.lon, 6)

    legs: list[GeometryLeg] = []
    results: dict[int, tuple[list[list[float]], float, float] | tuple[str, str]] = {}
    deadline = clock() + TOTAL_TIMEOUT_S
    requests = 0

    def post(group: list[GeometryStop]):
        nonlocal requests
        requests += 1
        if requests > MAX_REQUESTS or clock() >= deadline:
            raise GeometryError("geometry_budget", "Route geometry request budget exhausted.")
        timeout = max(1.0, min(config.timeout_s, deadline - clock()))
        try:
            return _parse_legs(
                transport(config.url.rstrip("/") + "/route", _route_body(config, group), timeout),
                len(group) - 1,
            )
        except TransientProviderError as error:
            raise GeometryError("provider_unavailable", "Valhalla did not answer.") from error

    chunk_sizes = []
    for start, end in chunk_ranges(len(stops), limit):
        group = stops[start:end]
        chunk_sizes.append(len(group))
        # Identical consecutive coordinates are a zero-length leg: nothing to route.
        pending = [i for i in range(len(group) - 1) if not same(group[i], group[i + 1])]
        for i in range(len(group) - 1):
            if i not in pending:
                p = [group[i].lon, group[i].lat]
                results[start + i] = ([p, list(p)], 0.0, 0.0)
        if len(pending) == len(group) - 1:
            try:
                parsed = post(group)
                for i, item in enumerate(parsed):
                    results[start + i] = item
                continue
            except ProviderError as error:
                if isinstance(error, TransientProviderError):
                    raise
        # Rejected or mixed chunk: report each remaining leg on its own, never as a straight line.
        for i in pending:
            if start + i in results:
                continue
            try:
                results[start + i] = post(group[i : i + 2])[0]
            except GeometryError:
                raise
            except ProviderError as error:
                results[start + i] = ("no_route", str(error)[:200])

    for i in range(len(stops) - 1):
        a, b = stops[i], stops[i + 1]
        mi, mj = position[a.id], position[b.id]
        m_m, m_s = (int(meters[mi, mj]), int(seconds[mi, mj]))
        m_m, m_s = (None if m_m < 0 else m_m), (None if m_s < 0 else m_s)
        got = results[i]
        if isinstance(got[0], str):
            legs.append(
                GeometryLeg(
                    index=i,
                    from_id=a.id,
                    to_id=b.id,
                    status="no_route",
                    matrix_m=m_m,
                    matrix_s=m_s,
                    error=got[1],
                )  # fmt: skip
            )
            continue
        coords, route_m, route_s = got
        route_m, route_s = round(route_m, 1), round(route_s, 1)
        leg = GeometryLeg(
            index=i, from_id=a.id, to_id=b.id,
            status="same_location" if same(a, b) else "ok",
            coordinates=coords, route_m=route_m, route_s=route_s, matrix_m=m_m, matrix_s=m_s,
        )  # fmt: skip
        if m_m is not None and m_s is not None:
            leg.delta_m, leg.delta_s = round(route_m - m_m, 1), round(route_s - m_s, 1)
            leg.relative_m = round(leg.delta_m / m_m, 5) if m_m else None
            leg.relative_s = round(leg.delta_s / m_s, 5) if m_s else None
            leg.notable = (
                abs(leg.delta_m) > NOTABLE_M[0] and abs(leg.relative_m or 1) > NOTABLE_M[1]
            ) or (abs(leg.delta_s) > NOTABLE_S[0] and abs(leg.relative_s or 1) > NOTABLE_S[1])
        legs.append(leg)

    drawn = [leg for leg in legs if leg.coordinates]
    return RouteGeometryResponse(
        snapshot_id=request.snapshot_id,
        truck_id=request.truck_id,
        provider=deployment_identity(config),
        legs=legs,
        chunks={
            "max_locations": limit,
            "chunk_sizes": chunk_sizes,
            "requests": requests,
            "overlap": 1,
            "resequenced": False,
        },  # fmt: skip
        summary={
            "legs": len(legs),
            "drawn": len(drawn),
            "missing": len(legs) - len(drawn),
            "notable": sum(1 for leg in legs if leg.notable),
            "route_m": round(sum(leg.route_m or 0 for leg in drawn), 1),
            "matrix_m": sum(leg.matrix_m or 0 for leg in drawn),
            "route_s": round(sum(leg.route_s or 0 for leg in drawn), 1),
            "matrix_s": sum(leg.matrix_s or 0 for leg in drawn),
            "thresholds": {
                "distance": {"absolute_m": NOTABLE_M[0], "relative": NOTABLE_M[1]},
                "duration": {"absolute_s": NOTABLE_S[0], "relative": NOTABLE_S[1]},
            },
        },
    )
