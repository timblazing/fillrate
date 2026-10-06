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

- ``reloads()``: a planar instance with a DC at the origin, a yard at (60, 0) and eight stops of
  5 parcels around x = 70..110. One van of 10 parcels starts and ends at the DC and may reload
  at the yard up to 3 times, so it makes four trips. ``reloads(allowed=False)`` removes the
  reload (and the yard) and gives four vans, each with a long single trip from the DC.

- ``prizes()``: a planar instance with five required stops near the depot and three optional,
  remote stops, each with a prize of 60 cost units. The detour to the remote cluster costs far
  more than the 180 of prizes it would collect, so the solver skips them and pays 180 of
  uncollected prizes. ``prizes(prize=400)`` raises each prize to 400, so the same solver visits
  all three and collects 1,200.

- ``groups()``: a planar instance where customer "Acme" can be served at one of two alternative
  service points, its north dock or its south dock (a required group of two optional clients).
  Four required stops lie on the north side, so the north dock is the cheaper alternative and the
  solver picks it. ``groups(side="south")`` puts the required stops on the south side instead, and
  the south dock wins.

- ``pairs()``: a planar instance with six pickup-delivery pairs of 6 parcels moved from a west
  cluster of pickup points to an east cluster of delivery points, vans with a 450-unit route limit
  and capacity 12, so a van can carry two pairs at once. ``pairs(capacity=6)`` lets a van carry one
  pair at a time: the pairs can no longer ride together, routes run longer, and the limit forces
  more vans.

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

# id, label, x, y, parcels
RELOAD_CLIENTS = [
    ("R-1", "Store", 72, 20, 5),
    ("R-2", "Store", 78, -22, 5),
    ("R-3", "Store", 88, 8, 5),
    ("R-4", "Store", 95, -12, 5),
    ("R-5", "Store", 70, 0, 5),
    ("R-6", "Store", 100, 22, 5),
    ("R-7", "Store", 108, -4, 5),
    ("R-8", "Store", 90, -28, 5),
]
RELOAD_VAN_CAPACITY = 10

# id, label, x, y, parcels, optional
PRIZE_CLIENTS = [
    ("P-1", "Nearby stop", 25, 10, 2, False),
    ("P-2", "Nearby stop", 35, -15, 2, False),
    ("P-3", "Nearby stop", -20, 25, 2, False),
    ("P-4", "Nearby stop", -30, -20, 2, False),
    ("P-5", "Nearby stop", 10, 40, 2, False),
    ("P-6", "Remote stop", 190, 10, 2, True),
    ("P-7", "Remote stop", 200, -12, 2, True),
    ("P-8", "Remote stop", 215, 4, 2, True),
]
PRIZE_VAN_CAPACITY = 10

# id, label, x, y, parcels (required stops; the y sign flips with the side)
GROUP_STOPS = [
    ("G-1", "Stop", 30, 28, 2),
    ("G-2", "Stop", -25, 35, 2),
    ("G-3", "Stop", 55, 50, 2),
    ("G-4", "Stop", 5, 60, 2),
]
GROUP_VAN_CAPACITY = 10

# pickup (x, y), delivery (x, y); every pair moves 6 parcels
PAIRS = [
    ((-40, 10), (70, 5)),
    ((-55, -12), (85, -15)),
    ((-30, -25), (60, 25)),
    ((-62, 20), (95, 8)),
    ((-45, 0), (78, -30)),
    ((-35, 30), (100, -5)),
]
PAIR_ROUTE_LIMIT = 450

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


def reloads(allowed: bool = True) -> LabInstance:
    van = {
        "id": "van",
        "label": "Van",
        "count": 1 if allowed else 4,
        "capacity": {"parcels": RELOAD_VAN_CAPACITY},
        "fixed_cost": 100,
        "unit_distance_cost": 1,
    }
    if allowed:
        van |= {"reload_depots": ["yard"], "max_reloads": 3}
    return LabInstance.model_validate(
        {
            "name": "Reloads" + ("" if allowed else " off") + " (planar, 8 clients)",
            "description": (
                "Abstract planar coordinates. One van (10 parcels) starts and ends at the DC and "
                "may reload at the yard up to 3 times; eight stops of 5 parcels lie beyond it."
                if allowed
                else "The same stops without reloading: four vans, one trip each from the DC."
            ),
            "coordinates": "planar",
            "dimensions": [{"id": "parcels", "label": "Parcels", "unit": "parcels"}],
            "depots": [
                {"id": "dc", "label": "Distribution center", "x": 0, "y": 0},
                *([{"id": "yard", "label": "Reload yard", "x": 60, "y": 0}] if allowed else []),
            ],
            "clients": [
                {
                    "id": cid,
                    "label": label,
                    "x": x,
                    "y": y,
                    "delivery": {"parcels": parcels},
                    "service_duration": 10,
                }
                for cid, label, x, y, parcels in RELOAD_CLIENTS
            ],
            "vehicle_types": [van],
            "solver": SOLVER,
        }
    )


def prizes(prize: int = 60) -> LabInstance:
    return LabInstance.model_validate(
        {
            "name": f"Optional stops, prize {prize} (planar, 8 clients)",
            "description": (
                "Abstract planar coordinates. Five required stops lie near the depot; three "
                f"optional stops are far away and each carries a prize of {prize} cost units that "
                "the solver pays if it skips the stop. Vans carry 10 parcels, cost 100 per use "
                "and 1 per planar unit."
            ),
            "coordinates": "planar",
            "dimensions": [{"id": "parcels", "label": "Parcels", "unit": "parcels"}],
            "depots": [{"id": "depot", "label": "Depot", "x": 0, "y": 0}],
            "clients": [
                {
                    "id": cid,
                    "label": label,
                    "x": x,
                    "y": y,
                    "delivery": {"parcels": parcels},
                    "service_duration": 10,
                }
                | ({"required": False, "prize": prize} if optional else {})
                for cid, label, x, y, parcels, optional in PRIZE_CLIENTS
            ],
            "vehicle_types": [
                {
                    "id": "van",
                    "label": "Van",
                    "count": 3,
                    "capacity": {"parcels": PRIZE_VAN_CAPACITY},
                    "fixed_cost": 100,
                    "unit_distance_cost": 1,
                }
            ],
            "solver": SOLVER,
        }
    )


def groups(side: str = "north") -> LabInstance:
    sign = 1 if side == "north" else -1
    return LabInstance.model_validate(
        {
            "name": f"Alternative service points, stops on the {side} side (planar, 6 clients)",
            "description": (
                "Abstract planar coordinates. Customer Acme (2 parcels) can be served at its north "
                "dock or its south dock: the two docks are one required group, so exactly one is "
                f"visited. Four required stops lie on the {side} side of the depot."
            ),
            "coordinates": "planar",
            "dimensions": [{"id": "parcels", "label": "Parcels", "unit": "parcels"}],
            "depots": [{"id": "depot", "label": "Depot", "x": 0, "y": 0}],
            "clients": [
                {
                    "id": cid,
                    "label": label,
                    "x": x,
                    "y": sign * y,
                    "delivery": {"parcels": parcels},
                    "service_duration": 10,
                }
                for cid, label, x, y, parcels in GROUP_STOPS
            ]
            + [
                {
                    "id": "acme-north",
                    "label": "Acme, north dock",
                    "x": 20,
                    "y": 45,
                    "delivery": {"parcels": 2},
                    "service_duration": 10,
                    "required": False,
                },
                {
                    "id": "acme-south",
                    "label": "Acme, south dock",
                    "x": 20,
                    "y": -45,
                    "delivery": {"parcels": 2},
                    "service_duration": 10,
                    "required": False,
                },
            ],
            "groups": [
                {
                    "id": "acme",
                    "label": "Acme (one dock)",
                    "members": ["acme-north", "acme-south"],
                    "required": True,
                }
            ],
            "vehicle_types": [
                {
                    "id": "van",
                    "label": "Van",
                    "count": 2,
                    "capacity": {"parcels": GROUP_VAN_CAPACITY},
                    "fixed_cost": 100,
                    "unit_distance_cost": 1,
                }
            ],
            "solver": SOLVER,
        }
    )


def pairs(capacity: int = 12) -> LabInstance:
    return LabInstance.model_validate(
        {
            "name": f"Pickup-delivery pairs, capacity {capacity} (planar, 6 pairs)",
            "description": (
                "Abstract planar coordinates. Six pairs of 6 parcels each are picked up in the "
                "west and delivered in the east, pickup before delivery on the same van. Vans "
                "carry "
                f"{capacity} parcels and may drive at most {PAIR_ROUTE_LIMIT} planar units."
            ),
            "coordinates": "planar",
            "dimensions": [{"id": "parcels", "label": "Parcels", "unit": "parcels"}],
            "depots": [{"id": "depot", "label": "Depot", "x": 0, "y": 0}],
            "clients": [
                {
                    "id": "return",
                    "label": "Return stop",
                    "x": 10,
                    "y": 5,
                    "delivery": {"parcels": 1},
                    "service_duration": 10,
                }
            ],
            "pairs": [
                {
                    "id": f"pair-{i}",
                    "label": f"Pair {i}",
                    "amount": {"parcels": 6},
                    "pickup": {
                        "id": f"pick-{i}",
                        "label": "Pickup",
                        "x": px,
                        "y": py,
                        "service_duration": 10,
                    },
                    "delivery": {
                        "id": f"drop-{i}",
                        "label": "Delivery",
                        "x": dx,
                        "y": dy,
                        "service_duration": 10,
                    },
                }
                for i, ((px, py), (dx, dy)) in enumerate(PAIRS, 1)
            ],
            "vehicle_types": [
                {
                    "id": "van",
                    "label": "Van",
                    "count": 6,
                    "capacity": {"parcels": capacity},
                    "fixed_cost": 100,
                    "unit_distance_cost": 1,
                    "max_distance": PAIR_ROUTE_LIMIT,
                }
            ],
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
    "lab-reloads.json": lambda: reloads(True),
    "lab-reloads-off.json": lambda: reloads(False),
    "lab-prizes.json": lambda: prizes(60),
    "lab-prizes-high.json": lambda: prizes(400),
    "lab-groups.json": lambda: groups("north"),
    "lab-groups-south.json": lambda: groups("south"),
    "lab-pairs.json": lambda: pairs(12),
    "lab-pairs-small.json": lambda: pairs(6),
}


def main() -> None:
    root = Path(__file__).resolve().parents[5] / "examples"
    for name, build in EXAMPLES.items():
        document = build().model_dump(mode="json", exclude_none=True)
        (root / name).write_text(json.dumps(document, indent=1) + "\n")


if __name__ == "__main__":
    main()
