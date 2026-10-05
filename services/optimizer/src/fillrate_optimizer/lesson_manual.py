"""Lesson scenario "Manual versus optimized routes" (spec §10, §13, M6/M7): synthetic data only.

One Memphis DC and ten customers within about 50 miles, in every direction. Their 29 pallets need at
least three 53 ft trailers (13 pallets each). The order numbers run around the map, not along it, so
a dispatcher who loads trucks in order-number sequence (filling each trailer before starting the
next) makes a valid plan with the same three trucks but far more miles. A dispatcher who splits the
map east and west makes a plan that looks tidy and is invalid: the west half is 16 pallets.

The two dispatcher plans are stored with the example (location IDs per truck, in visit order). The
lesson page evaluates them with the manual evaluator against a real run of this scenario, so every
number it shows comes from the run's own matrix and validator. Routing uses the pipeline's
estimated travel (straight-line distance × 1.2); this lesson does not use road matrices.

Regenerate with `uv run python -m fillrate_optimizer.lesson_manual` (writes examples/).
"""

from __future__ import annotations

import json
from pathlib import Path

from .model import RunSettings, ScenarioDocument
from .synthetic import MEMPHIS, offset

# id, label, east mi, north mi, full pallets; listed in order-number sequence.
STOPS = [
    ("MR-01", "Hardware store", 40, 5, 4),
    ("MR-02", "Garden center", -35, 10, 3),
    ("MR-03", "School district", 10, 30, 3),
    ("MR-04", "Builder yard", -20, -25, 4),
    ("MR-05", "Farm co-op", 45, -10, 2),
    ("MR-06", "Clinic", -40, -5, 3),
    ("MR-07", "Bakery supply", 25, 20, 2),
    ("MR-08", "Grocery warehouse", 0, 40, 3),
    ("MR-09", "Pharmacy", 30, -30, 2),
    ("MR-10", "Restaurant depot", -10, 15, 3),
]
PALLET_FEET = 400  # hundredths of a foot
PALLET_CENTS = 42_000
CAPACITY = 5_300

# One cluster and an iteration budget: results repeat across machines and run in about a second.
SETTINGS = RunSettings(k=1, solver_max_iterations=1_000, solver_time_limit_s=10)


def in_order_plan() -> list[list[str]]:
    """Trucks loaded in order-number sequence: a stop goes on the current truck if its pallets fit,
    otherwise it starts the next truck. Stops are visited in that same sequence."""
    routes: list[list[str]] = [[]]
    room = CAPACITY
    for loc_id, _label, _east, _north, pallets in STOPS:
        if pallets * PALLET_FEET > room:
            routes.append([])
            room = CAPACITY
        routes[-1].append(loc_id)
        room -= pallets * PALLET_FEET
    return routes


def east_west_plan() -> list[list[str]]:
    """One truck for the stops east of the DC and one for the stops west of it, in order-number
    sequence. The west truck carries 16 pallets."""
    return [
        [s[0] for s in STOPS if s[2] > 0],
        [s[0] for s in STOPS if s[2] <= 0],
    ]


PLANS = {"in_order": in_order_plan(), "east_west": east_west_plan()}


def build() -> ScenarioDocument:
    locations, orders = [], []
    for n, (loc_id, label, east_mi, north_mi, pallets) in enumerate(STOPS, 1):
        lat, lon = offset(MEMPHIS, east_mi, north_mi)
        locations.append(
            {"id": loc_id, "label": label, "lat": lat, "lon": lon, "coordinate_source": "imported"}
        )
        orders.append(
            {
                "id": f"MR-ORD-{n:02d}",
                "customer_id": loc_id,
                "location_id": loc_id,
                "order_date": "2026-10-01",
                "priority": 3,
                "lines": [
                    {
                        "id": f"MR-ORD-{n:02d}-1",
                        "product_id": "SKU-PALLET",
                        "ordered_pieces": pallets,
                        "net_value_per_piece_cents": PALLET_CENTS,
                    }
                ],
            }
        )
    return ScenarioDocument.model_validate(
        {
            "name": "Manual routes lesson — 10 synthetic stops",
            "depot": {"id": "DC-MEM", "label": "Memphis DC", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
            "products": [
                {"id": "SKU-PALLET", "label": "Full pallet", "linear_feet_per_piece": PALLET_FEET}
            ],
            "locations": locations,
            "orders": orders,
            "inventory": [
                {"product_id": "SKU-PALLET", "available_pieces": sum(s[4] for s in STOPS)}
            ],
        }
    )


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "examples"
    document = {
        "scenario": build().model_dump(mode="json"),
        "settings": SETTINGS.model_dump(mode="json"),
        # Dispatcher plans: location IDs per truck, in visit order (each stop is one visit).
        "plans": PLANS,
    }
    (root / "lesson-manual.json").write_text(json.dumps(document, indent=1) + "\n")


if __name__ == "__main__":
    main()
