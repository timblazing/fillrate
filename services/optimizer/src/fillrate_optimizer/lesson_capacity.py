"""Lesson scenario "Truck capacity" (spec §13, M7): synthetic data only.

One Memphis DC, 30 nearby customer stops and one very large stop. Stock is plentiful, so the only
binding limit is the 53 ft trailer (linear feet): every truck's load is at most 5,300 hundredths of
a foot, the plan needs at least ceil(total load / 5,300) trucks, and the large stop (more than one
trailer on its own) is split over several shipments by the default `oversize_stop` policy. One
cluster (k = 1) keeps the lesson about capacity, not clustering. Routing uses the pipeline defaults
(haversine × circuity travel); this lesson does not use road matrices.

Regenerate with `uv run python -m fillrate_optimizer.lesson_capacity` (writes examples/).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .model import RunSettings, ScenarioDocument
from .synthetic import MEMPHIS, offset

PRODUCTS = [
    {"id": "SKU-PALLET", "label": "Full pallet", "linear_feet_per_piece": 400},
    {"id": "SKU-HALF", "label": "Half pallet", "linear_feet_per_piece": 200},
    {"id": "SKU-ROLL", "label": "Carpet roll", "linear_feet_per_piece": 150},
]
VALUE_CENTS = {"SKU-PALLET": 42_000, "SKU-HALF": 23_500, "SKU-ROLL": 12_800}
LOCATIONS = 30
BIG_STOP_PALLETS = 30  # 120 ft: more than two full trailers for one customer


def build() -> ScenarioDocument:
    rng = np.random.default_rng(20261003)
    locations = []
    for n in range(LOCATIONS):
        angle = rng.uniform(0, 2 * math.pi)
        radius = rng.uniform(20, 160)
        lat, lon = offset(MEMPHIS, radius * math.cos(angle), radius * math.sin(angle))
        locations.append(
            {
                "id": f"LOC-{n + 1:02d}",
                "label": f"Customer {n + 1:02d}",
                "lat": lat,
                "lon": lon,
                "coordinate_source": "imported",
            }
        )
    lat, lon = offset(MEMPHIS, 60, 40)
    locations.append(
        {
            "id": "LOC-BIG",
            "label": "Big-box warehouse (one stop, 30 pallets)",
            "lat": lat,
            "lon": lon,
            "coordinate_source": "imported",
        }
    )
    ordered = dict.fromkeys(VALUE_CENTS, 0)
    orders = []

    def order(index: int, location_id: str, wants: list[tuple[str, int]]) -> None:
        lines = []
        for j, (pid, pieces) in enumerate(wants):
            ordered[pid] += pieces
            lines.append(
                {
                    "id": f"LINE-{index:03d}-{j + 1}",
                    "product_id": pid,
                    "ordered_pieces": pieces,
                    "net_value_per_piece_cents": VALUE_CENTS[pid],
                }
            )
        orders.append(
            {
                "id": f"ORD-{index:03d}",
                "customer_id": location_id,
                "location_id": location_id,
                "order_date": f"2026-09-{1 + int(rng.integers(14)):02d}",
                "priority": 3,
                "lines": lines,
            }
        )

    for n in range(LOCATIONS):
        wants = [("SKU-PALLET" if rng.random() < 0.5 else "SKU-HALF", int(rng.integers(2, 7)))]
        if rng.random() < 0.6:
            wants.append(("SKU-ROLL", int(rng.integers(3, 12))))
        order(n + 1, f"LOC-{n + 1:02d}", wants)
    order(LOCATIONS + 1, "LOC-BIG", [("SKU-PALLET", BIG_STOP_PALLETS)])
    return ScenarioDocument.model_validate(
        {
            "name": "Truck capacity lesson — 31 synthetic stops",
            "depot": {"id": "DC-MEM", "label": "Memphis DC", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
            "products": PRODUCTS,
            "locations": locations,
            "orders": orders,
            "inventory": [{"product_id": pid, "available_pieces": ordered[pid]} for pid in ordered],
        }
    )


# One cluster and an iteration budget: results repeat across machines and run in about a second.
SETTINGS = RunSettings(k=1, solver_max_iterations=300, solver_time_limit_s=10)


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "examples"
    document = {
        "scenario": build().model_dump(mode="json"),
        "settings": SETTINGS.model_dump(mode="json"),
    }
    (root / "lesson-capacity.json").write_text(json.dumps(document, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
