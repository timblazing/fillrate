"""Lesson scenario "Haversine versus recorded road matrices" (spec §7, §13, M7): synthetic only.

One Memphis DC and seven customers. The same scenario runs twice: once on the estimated
travel the pipeline uses by default (straight-line distance × 1.2 at a constant speed) and once on
a recorded directed travel snapshot bundled in `examples/`. That snapshot is a **synthetic
recorded matrix** standing in for a road-provider snapshot. It is not real roads: it is computed
here from an invented road network around invented barriers, so the lesson can show what a
recorded matrix changes without shipping real road data (spec §14).

The invented network:

- a river runs north–south 40 miles east of the DC. The only crossing near the DC is a one-way
  eastbound bridge; westbound traffic uses a two-way bridge 110 miles south. So legs across the
  river are directed: short eastbound, long westbound.
- a ridge runs north from 60 miles south of the DC, 200 miles east of it. Roads go around its
  southern end, so the resort beyond it is far more than 500 road miles from everywhere, although
  the straight-line estimate puts it within the 500-mile single-drive limit.

Each road segment's length is its great-circle length times a factor that is larger for short
local roads (1.12 to 1.32); its speed is 30 to 55 mph, faster on longer segments, and 20 mph on a
bridge. A pair's recorded distance and duration are those of the shortest-distance path. The
snapshot stores kilometres and seconds, like a Valhalla matrix.

Regenerate with `uv run python -m fillrate_optimizer.lesson_matrix` (writes examples/).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .model import PreflightPolicy, RunSettings, ScenarioDocument
from .synthetic import MEMPHIS, offset
from .travel import METERS_PER_MILE, haversine_m
from .travel_provider import TravelNode, TravelSnapshot

DEPOT = ("DC-MEM", "Memphis DC")
# id, label, east mi, north mi, full pallets
STOPS = [
    ("RM-01", "Lumber yard", -25, 35, 2),
    ("RM-02", "Farm supply", 15, -60, 3),
    ("RM-03", "Hardware store", 20, 45, 2),
    ("RM-04", "Grocery warehouse", 60, 15, 2),
    ("RM-05", "Clinic", 75, -40, 2),
    ("RM-06", "Builder yard", 95, 50, 2),
    ("RM-07", "Ridge resort", 300, 260, 4),
]
PALLET_CENTS = 42_000
RIVER_EAST = 40  # miles east of the DC
ONE_WAY_BRIDGE_NORTH = 5  # eastbound only
TWO_WAY_BRIDGE_NORTH = -110
RIDGE = ((200, -60), (200, 600))  # the road goes around the southern end
PASS = (200, -70)

PROVIDER_VERSION = "fillrate-synthetic-roads/1"
DATASET_REVISION = "synthetic-lesson-network-2026-10 (not real roads)"
PROFILE = "truck (synthetic)"
OPTIONS = {
    "synthetic": True,
    "description": (
        "Synthetic recorded matrix for the Haversine versus recorded road matrices lesson: an "
        "invented road network with a one-way river crossing and a ridge detour. Not real roads."
    ),
    "generator": "fillrate_optimizer.lesson_matrix",
}
WARNINGS = [
    {
        "code": "synthetic_matrix",
        "message": (
            "Synthetic recorded matrix standing in for a road-provider snapshot; not real roads."
        ),
    }
]


def _crosses(a, b, p, q) -> bool:
    """Whether segment a–b properly crosses segment p–q (planar miles)."""

    def side(o, u, v):
        return (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0])

    d1, d2 = side(p, q, a), side(p, q, b)
    d3, d4 = side(a, b, p), side(a, b, q)
    return d1 * d2 < 0 and d3 * d4 < 0


def _points() -> dict[str, tuple[float, float]]:
    """Every point of the invented network in planar miles east/north of the DC."""
    points = {DEPOT[0]: (0.0, 0.0)}
    points.update({s[0]: (float(s[2]), float(s[3])) for s in STOPS})
    points.update(
        {
            "one-way-west": (RIVER_EAST - 1.0, float(ONE_WAY_BRIDGE_NORTH)),
            "one-way-east": (RIVER_EAST + 1.0, float(ONE_WAY_BRIDGE_NORTH)),
            "bridge-west": (RIVER_EAST - 1.0, float(TWO_WAY_BRIDGE_NORTH)),
            "bridge-east": (RIVER_EAST + 1.0, float(TWO_WAY_BRIDGE_NORTH)),
            "ridge-pass": (float(PASS[0]), float(PASS[1])),
        }
    )
    return points


def coordinates() -> dict[str, tuple[float, float]]:
    """Latitude/longitude of the DC and the stops (the scenario's and the snapshot's)."""
    return {name: offset(MEMPHIS, east, north) for name, (east, north) in _points().items()}


def _segments():
    """Directed road segments: (from, to, meters, seconds)."""
    points = _points()
    names = list(points)
    latlon = np.array([offset(MEMPHIS, *points[n]) for n in names])
    straight = haversine_m(latlon)
    bridges = {("one-way-west", "one-way-east")} | {
        ("bridge-west", "bridge-east"),
        ("bridge-east", "bridge-west"),
    }
    river = ((RIVER_EAST, -1000), (RIVER_EAST, 1000))
    out = []
    for i, a in enumerate(names):
        for j, b in enumerate(names):
            if i == j:
                continue
            bridge = (a, b) in bridges
            if not bridge and (
                _crosses(points[a], points[b], *river) or _crosses(points[a], points[b], *RIDGE)
            ):
                continue
            if "one-way" in a and "one-way" in b and not bridge:
                continue  # the one-way bridge has no westbound lane
            miles = straight[i, j] / METERS_PER_MILE
            factor = 1.12 + 0.2 * math.exp(-miles / 40)
            mph = 20 if bridge else 30 + 25 * (1 - math.exp(-miles / 60))
            road_m = straight[i, j] * factor
            out.append((a, b, road_m, road_m / METERS_PER_MILE / mph * 3600))
    return out


def _shortest() -> tuple[dict, dict]:
    """All-pairs shortest-distance paths (Floyd–Warshall) with their durations."""
    names = list(_points())
    index = {n: i for i, n in enumerate(names)}
    n = len(names)
    dist = np.full((n, n), math.inf)
    time = np.full((n, n), math.inf)
    np.fill_diagonal(dist, 0)
    np.fill_diagonal(time, 0)
    for a, b, meters, seconds in _segments():
        dist[index[a], index[b]] = meters
        time[index[a], index[b]] = seconds
    for k in range(n):
        for i in range(n):
            for j in range(n):
                if dist[i, k] + dist[k, j] < dist[i, j]:
                    dist[i, j] = dist[i, k] + dist[k, j]
                    time[i, j] = time[i, k] + time[k, j]
    return (
        {(a, b): dist[index[a], index[b]] for a in names for b in names},
        {(a, b): time[index[a], index[b]] for a in names for b in names},
    )


def nodes() -> list[TravelNode]:
    """The snapshot's nodes, in the order the pipeline binds them: the DC, then stops by ID."""
    coords = coordinates()
    order = [DEPOT[0], *sorted(s[0] for s in STOPS)]
    return [TravelNode(id=name, lat=coords[name][0], lon=coords[name][1]) for name in order]


def snapshot() -> TravelSnapshot:
    dist, time = _shortest()
    ids = [node.id for node in nodes()]
    return TravelSnapshot(
        nodes=nodes(),
        provider="imported",
        provider_version=PROVIDER_VERSION,
        dataset_revision=DATASET_REVISION,
        profile=PROFILE,
        options=OPTIONS,
        distance_units="kilometers",
        duration_units="seconds",
        distances=[[round(dist[a, b] / 1000, 3) for b in ids] for a in ids],
        durations=[[round(time[a, b], 1) for b in ids] for a in ids],
        warnings=WARNINGS,
    )


def build() -> ScenarioDocument:
    coords = coordinates()
    locations, orders = [], []
    for n, (loc_id, label, _east, _north, pallets) in enumerate(STOPS, 1):
        lat, lon = coords[loc_id]
        locations.append(
            {"id": loc_id, "label": label, "lat": lat, "lon": lon, "coordinate_source": "imported"}
        )
        orders.append(
            {
                "id": f"RM-ORD-{n:02d}",
                "customer_id": loc_id,
                "location_id": loc_id,
                "order_date": "2026-10-01",
                "priority": 3,
                "lines": [
                    {
                        "id": f"RM-ORD-{n:02d}-1",
                        "product_id": "SKU-PALLET",
                        "ordered_pieces": pallets,
                        "net_value_per_piece_cents": PALLET_CENTS,
                    }
                ],
            }
        )
    lat, lon = coords[DEPOT[0]]
    return ScenarioDocument.model_validate(
        {
            "name": "Road matrix lesson — 7 synthetic stops",
            "depot": {"id": DEPOT[0], "label": DEPOT[1], "lat": lat, "lon": lon},
            "products": [
                {"id": "SKU-PALLET", "label": "Full pallet", "linear_feet_per_piece": 400}
            ],
            "locations": locations,
            "orders": orders,
            "inventory": [
                {"product_id": "SKU-PALLET", "available_pieces": sum(s[4] for s in STOPS)}
            ],
        }
    )


# One cluster and an iteration budget: results repeat across machines and run in about a second.
# A stop no allowed chain of drives reaches is left unshipped (`unreachable`) instead of blocking
# the run, so both travel modes plan the same scenario.
ESTIMATED = RunSettings(
    k=1,
    solver_max_iterations=1_000,
    solver_time_limit_s=10,
    preflight=PreflightPolicy(far_from_depot="warn"),
)


def settings(recorded: bool) -> RunSettings:
    if not recorded:
        return ESTIMATED
    return ESTIMATED.model_copy(update={"travel_snapshot_id": snapshot().identity})


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "examples"
    scenario = build().model_dump(mode="json")
    for name, recorded in (("lesson-matrix.json", True), ("lesson-matrix-estimated.json", False)):
        document = {"scenario": scenario, "settings": settings(recorded).model_dump(mode="json")}
        (root / name).write_text(json.dumps(document, indent=1) + "\n")
    (root / "lesson-matrix-snapshot.json").write_text(
        json.dumps(snapshot().model_dump(mode="json"), indent=1) + "\n"
    )


if __name__ == "__main__":
    main()
