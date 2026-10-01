"""Flagship lesson scenario "Fulfillment pipeline" (spec §13, M4): synthetic data only.

About 2,000 open orders from 600 customer locations in eight regional markets around a Memphis
DC, four products with scarce stock, and US-scale distances. Every location is within one allowed
drive of the depot (straight line ≤ 400 mi, so ≤ 480 mi at the 1.2 circuity), so a validated plan
can ship every allocated piece and sweeps have complete plans to rank. Stock shortages, trailer
fill and k / seed trade-offs are what the lesson shows.

Regenerate with `uv run python -m fillrate_optimizer.lesson` (writes examples/).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .model import RunSettings, ScenarioDocument
from .synthetic import MEMPHIS, offset

# (label, miles east, miles north, share of locations): regional markets, all within 400 mi.
MARKETS = [
    ("Memphis metro", 0, 0, 0.18),
    ("Nashville", 195, 30, 0.14),
    ("St. Louis", 30, 245, 0.13),
    ("Little Rock", -125, -20, 0.10),
    ("Jackson MS", -20, -190, 0.10),
    ("Birmingham", 215, -95, 0.13),
    ("Louisville", 280, 215, 0.10),
    ("Shreveport", -245, -180, 0.12),
]
PRODUCTS = [
    {"id": "SKU-PALLET", "label": "Full pallet", "linear_feet_per_piece": 400},
    {"id": "SKU-HALF", "label": "Half pallet", "linear_feet_per_piece": 200},
    {"id": "SKU-ROLL", "label": "Carpet roll", "linear_feet_per_piece": 150},
    {"id": "SKU-BOX", "label": "Carton bundle", "linear_feet_per_piece": 50},
]
VALUE_CENTS = {"SKU-PALLET": 42_000, "SKU-HALF": 23_500, "SKU-ROLL": 12_800, "SKU-BOX": 4_100}
# Share of ordered pieces in stock: two products are scarce.
STOCK_SHARE = {"SKU-PALLET": 0.72, "SKU-HALF": 1.0, "SKU-ROLL": 0.85, "SKU-BOX": 1.0}
LOCATIONS = 600
ORDERS = 2_000


def build() -> ScenarioDocument:
    rng = np.random.default_rng(20261001)
    locations = []
    counts = [round(share * LOCATIONS) for *_, share in MARKETS]
    counts[0] += LOCATIONS - sum(counts)
    for (label, east, north, _), count in zip(MARKETS, counts, strict=True):
        center = offset(MEMPHIS, east, north)
        for _ in range(count):
            angle = rng.uniform(0, 2 * math.pi)
            radius = 55 * math.sqrt(rng.uniform(0, 1))
            lat, lon = offset(center, radius * math.cos(angle), radius * math.sin(angle))
            n = len(locations) + 1
            locations.append(
                {
                    "id": f"LOC-{n:04d}",
                    "label": f"{label} customer {n}",
                    "lat": lat,
                    "lon": lon,
                    "coordinate_source": "imported",
                }
            )
    ordered = dict.fromkeys(VALUE_CENTS, 0)
    orders = []
    for i in range(ORDERS):
        location = locations[int(rng.integers(len(locations)))]
        lines = []
        for j, product in enumerate(
            rng.choice(len(PRODUCTS), size=int(rng.integers(1, 3)), replace=False)
        ):
            pid = PRODUCTS[int(product)]["id"]
            pieces = int(rng.integers(1, 9))
            ordered[pid] += pieces
            discount = int(rng.integers(0, 15)) * 100
            lines.append(
                {
                    "id": f"LINE-{i + 1:05d}-{j + 1}",
                    "product_id": pid,
                    "ordered_pieces": pieces,
                    "net_value_per_piece_cents": VALUE_CENTS[pid] - discount,
                }
            )
        orders.append(
            {
                "id": f"ORD-{i + 1:05d}",
                "customer_id": location["id"],
                "location_id": location["id"],
                "order_date": f"2026-09-{1 + int(rng.integers(28)):02d}",
                "lines": lines,
            }
        )
    inventory = [
        {"product_id": pid, "available_pieces": int(ordered[pid] * STOCK_SHARE[pid])}
        for pid in VALUE_CENTS
    ]
    return ScenarioDocument.model_validate(
        {
            "name": "Fulfillment pipeline lesson — 2,000 synthetic orders",
            "depot": {"id": "DC-MEM", "label": "Memphis DC", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
            "products": PRODUCTS,
            "locations": locations,
            "orders": orders,
            "inventory": inventory,
        }
    )


# Iteration budget: reproducible across machines and fast enough for a 25-run sweep.
SETTINGS = RunSettings(k=8, solver_max_iterations=300, solver_time_limit_s=10)


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "examples"
    document = {
        "scenario": build().model_dump(mode="json"),
        "settings": SETTINGS.model_dump(mode="json"),
    }
    (root / "lesson-fulfillment.json").write_text(
        json.dumps(document, separators=(",", ":")) + "\n"
    )


if __name__ == "__main__":
    main()
