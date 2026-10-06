"""Bundled Solver Lab examples (spec §13): synthetic data only, generated here.

- ``dimensions()``: a planar (abstract units, not latitude/longitude) instance with two load
  dimensions. Dense steel and tile bind on weight while bulky foam never fills a truck's volume,
  so weight sets the number of trucks. ``dimensions(weight=False)`` drops the weight dimension:
  the same stops then fit in fewer trucks, a plan that overloads weight when checked against
  the two-dimension instance.
- ``fleet()``: a geographic instance around Memphis with a heterogeneous fleet of three cheap,
  small cargo vans and three larger, costlier box trucks. ``fleet(vans=False)`` keeps only the
  trucks, which costs more for the same deliveries.

- ``depots()``: a planar instance with two depots, West (-60, 0) and East (60, 0), a cluster of six
  stops near each, and two vans based at each depot (``start_depot`` and ``end_depot``).
  ``depots(single=True)`` keeps the same stops and four vans but only the West depot, so every
  East stop is a long trip from it and the plan costs more.

The observations each page states are asserted in tests/test_lab_examples.py. Regenerate with
`uv run python -m fillrate_optimizer.lab.examples` (writes examples/lab-*.json).
"""

from __future__ import annotations

import json
from pathlib import Path

from ..synthetic import MEMPHIS, offset
from .schema import LabInstance

# id, label, x, y, weight kg, volume L
DIMENSION_CLIENTS = [
    ("steel-1", "Steel coils", 30, 10, 420, 150),
    ("steel-2", "Steel coils", 35, -20, 380, 140),
    ("steel-3", "Steel coils", -25, 30, 450, 160),
    ("steel-4", "Steel coils", -40, -15, 400, 150),
    ("foam-1", "Foam insulation", 20, 40, 60, 900),
    ("foam-2", "Foam insulation", -10, -45, 50, 850),
    ("foam-3", "Foam insulation", 45, 25, 70, 950),
    ("tile-1", "Floor tile", -35, 5, 300, 200),
    ("tile-2", "Floor tile", 10, -30, 280, 180),
    ("foam-4", "Foam insulation", -30, -35, 40, 800),
    ("tile-3", "Floor tile", 5, 35, 260, 190),
    ("glass-1", "Glass panels", 40, -5, 150, 300),
]
TRUCK_WEIGHT_KG, TRUCK_VOLUME_L = 1_200, 4_000

# id, label, miles east, miles north, pallets
FLEET_CLIENTS = [
    ("F-01", "Hardware store", 12, 4, 3),
    ("F-02", "Garden center", 18, -6, 2),
    ("F-03", "Grocery", -9, 14, 4),
    ("F-04", "Pharmacy", -15, -3, 2),
    ("F-05", "School", 6, -17, 3),
    ("F-06", "Builder yard", 25, 12, 5),
    ("F-07", "Clinic", -22, 10, 2),
    ("F-08", "Restaurant supply", 3, 22, 3),
    ("F-09", "Farm co-op", -6, -24, 4),
    ("F-10", "Office park", 14, -20, 2),
]
VAN = {
    "id": "van",
    "label": "Cargo van",
    "count": 3,
    "capacity": {"pallets": 6},
    "fixed_cost": 15_000,
    "unit_distance_cost": 1,
}
TRUCK = {
    "id": "box-truck",
    "label": "26 ft box truck",
    "count": 3,
    "capacity": {"pallets": 14},
    "fixed_cost": 40_000,
    "unit_distance_cost": 2,
}
# id, label, x, y, parcels. West cluster first, then East.
DEPOT_CLIENTS = [
    ("W-1", "West stop", -75, 12, 4),
    ("W-2", "West stop", -68, -14, 4),
    ("W-3", "West stop", -52, 18, 4),
    ("W-4", "West stop", -45, -8, 4),
    ("W-5", "West stop", -80, -2, 4),
    ("W-6", "West stop", -58, -22, 4),
    ("E-1", "East stop", 74, 10, 4),
    ("E-2", "East stop", 66, -16, 4),
    ("E-3", "East stop", 50, 15, 4),
    ("E-4", "East stop", 46, -10, 4),
    ("E-5", "East stop", 82, -4, 4),
    ("E-6", "East stop", 57, -24, 4),
]
DEPOT_VAN_CAPACITY = 12
DEPOTS = [
    {"id": "west", "label": "West depot", "x": -60, "y": 0},
    {"id": "east", "label": "East depot", "x": 60, "y": 0},
]

# An iteration budget makes results repeat across machines; the runtime is only a safety cap.
SOLVER = {"seed": 0, "max_iterations": 2_000, "max_runtime_s": 30}


def dimensions(weight: bool = True) -> LabInstance:
    dims = [
        *([{"id": "weight", "label": "Weight", "unit": "kg"}] if weight else []),
        {"id": "volume", "label": "Volume", "unit": "L"},
    ]
    capacity = {"volume": TRUCK_VOLUME_L} | ({"weight": TRUCK_WEIGHT_KG} if weight else {})
    return LabInstance.model_validate(
        {
            "name": "Two load dimensions"
            + ("" if weight else ", weight removed")
            + " (planar, 12 clients)",
            "description": (
                "Abstract planar coordinates (not latitude/longitude). Each truck carries 1,200 kg "
                "and 4,000 L. Steel and tile are heavy and compact; foam is light and bulky."
                if weight
                else "The same clients and trucks with the weight dimension removed: only "
                "volume limits a truck."
            ),
            "coordinates": "planar",
            "dimensions": dims,
            "depots": [{"id": "depot", "label": "Depot", "x": 0, "y": 0}],
            "clients": [
                {
                    "id": cid,
                    "label": label,
                    "x": x,
                    "y": y,
                    "delivery": {"volume": volume} | ({"weight": kg} if weight else {}),
                    "service_duration": 10,
                }
                for cid, label, x, y, kg, volume in DIMENSION_CLIENTS
            ],
            "vehicle_types": [
                {
                    "id": "truck",
                    "label": "Truck",
                    "count": 5,
                    "capacity": capacity,
                    "fixed_cost": 100,
                    "unit_distance_cost": 1,
                }
            ],
            "solver": SOLVER,
        }
    )


def fleet(vans: bool = True) -> LabInstance:
    clients = []
    for cid, label, east, north, pallets in FLEET_CLIENTS:
        lat, lon = offset(MEMPHIS, east, north)
        clients.append(
            {
                "id": cid,
                "label": label,
                "lat": lat,
                "lon": lon,
                "delivery": {"pallets": pallets},
                "service_duration": 900,
            }
        )
    return LabInstance.model_validate(
        {
            "name": "Heterogeneous fleet"
            + ("" if vans else ", trucks only")
            + " (Memphis, 10 clients)",
            "description": (
                "Three cargo vans (6 pallets, 15,000 per use, 1 per meter) and three box trucks "
                "(14 pallets, 40,000 per use, 2 per meter). Travel is straight-line × 1.2."
                if vans
                else "The same clients served by the three box trucks only."
            ),
            "coordinates": "geographic",
            "cost_unit": "cost units",
            "dimensions": [{"id": "pallets", "label": "Pallets", "unit": "pallets"}],
            "depots": [{"id": "DC", "label": "Memphis DC", "lat": MEMPHIS[0], "lon": MEMPHIS[1]}],
            "clients": clients,
            "vehicle_types": [VAN, TRUCK] if vans else [TRUCK],
            "solver": SOLVER,
        }
    )


def depots(single: bool = False) -> LabInstance:
    def van(vid: str, label: str, depot: str, count: int) -> dict:
        return {
            "id": vid,
            "label": label,
            "count": count,
            "capacity": {"parcels": DEPOT_VAN_CAPACITY},
            "fixed_cost": 100,
            "unit_distance_cost": 1,
            "start_depot": depot,
            "end_depot": depot,
        }

    return LabInstance.model_validate(
        {
            "name": "Two depots" + (", West only" if single else "") + " (planar, 12 clients)",
            "description": (
                "Abstract planar coordinates. All four vans (12 parcels each) are based at the "
                "West depot; the six East stops are far from it."
                if single
                else "Abstract planar coordinates. Two vans are based at the West depot and two at "
                "the East depot (each van starts and ends at its own depot). Six stops sit near "
                "each depot, 4 parcels each."
            ),
            "coordinates": "planar",
            "dimensions": [{"id": "parcels", "label": "Parcels", "unit": "parcels"}],
            "depots": DEPOTS[:1] if single else DEPOTS,
            "clients": [
                {
                    "id": cid,
                    "label": label,
                    "x": x,
                    "y": y,
                    "delivery": {"parcels": parcels},
                    "service_duration": 10,
                }
                for cid, label, x, y, parcels in DEPOT_CLIENTS
            ],
            "vehicle_types": (
                [van("van", "Van", "west", 4)]
                if single
                else [
                    van("west-van", "West van", "west", 2),
                    van("east-van", "East van", "east", 2),
                ]
            ),
            "solver": SOLVER,
        }
    )


EXAMPLES = {
    "lab-dimensions.json": lambda: dimensions(True),
    "lab-dimensions-volume.json": lambda: dimensions(False),
    "lab-fleet.json": lambda: fleet(True),
    "lab-fleet-trucks.json": lambda: fleet(False),
    "lab-depots.json": lambda: depots(False),
    "lab-depots-single.json": lambda: depots(True),
}


def main() -> None:
    root = Path(__file__).resolve().parents[5] / "examples"
    for name, build in EXAMPLES.items():
        document = build().model_dump(mode="json", exclude_none=True)
        (root / name).write_text(json.dumps(document, indent=1) + "\n")


if __name__ == "__main__":
    main()
