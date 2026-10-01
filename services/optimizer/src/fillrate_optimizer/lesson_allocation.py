"""Lesson scenario "Scarce stock: piece or whole order" (spec §13, M7): synthetic data only.

A small Memphis DC scenario (90 orders, 45 customers in three regional markets) where one product
(carpet rolls) is short and the others are plentiful, so the allocation strategy and the fulfillment
policy (§8) decide who gets stock. It is small enough that every strategy, including CP-SAT, proves
its answer in a fraction of a second, so the lesson's observations are exact, not heuristic. Routing
uses the pipeline defaults (haversine × circuity travel); this lesson does not use road matrices.

Regenerate with `uv run python -m fillrate_optimizer.lesson_allocation` (writes examples/).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .model import RunSettings, ScenarioDocument
from .synthetic import MEMPHIS, offset

# (label, miles east, miles north): three markets, all inside one allowed drive of the depot.
MARKETS = [("Nashville", 195, 30), ("St. Louis", 30, 245), ("Jackson MS", -20, -190)]
PRODUCTS = [
    {"id": "SKU-PALLET", "label": "Full pallet", "linear_feet_per_piece": 400},
    {"id": "SKU-ROLL", "label": "Carpet roll", "linear_feet_per_piece": 150},
    {"id": "SKU-BOX", "label": "Carton bundle", "linear_feet_per_piece": 50},
]
VALUE_CENTS = {"SKU-PALLET": 42_000, "SKU-ROLL": 12_800, "SKU-BOX": 4_100}
# Carpet rolls are the scarce product: stock covers about half of the ordered pieces.
STOCK_SHARE = {"SKU-PALLET": 1.0, "SKU-ROLL": 0.5, "SKU-BOX": 1.0}
LOCATIONS = 45
ORDERS = 90


def build() -> ScenarioDocument:
    rng = np.random.default_rng(20261002)
    locations = []
    for n in range(LOCATIONS):
        label, east, north = MARKETS[n % len(MARKETS)]
        angle = rng.uniform(0, 2 * math.pi)
        radius = 40 * math.sqrt(rng.uniform(0, 1))
        lat, lon = offset(
            offset(MEMPHIS, east, north), radius * math.cos(angle), radius * math.sin(angle)
        )
        locations.append(
            {
                "id": f"LOC-{n + 1:03d}",
                "label": f"{label} customer {n + 1}",
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
        # Every order wants carpet rolls; many also want another product, so a partial fill ships
        # an order with some lines short while whole-order mode all-or-nothing the whole order.
        others = [pid for pid in VALUE_CENTS if pid != "SKU-ROLL"]
        wanted = ["SKU-ROLL"] + (
            [others[int(rng.integers(len(others)))]] if rng.random() < 0.6 else []
        )
        for j, pid in enumerate(wanted):
            pieces = int(rng.integers(2, 9)) if pid == "SKU-ROLL" else int(rng.integers(1, 5))
            ordered[pid] += pieces
            lines.append(
                {
                    "id": f"LINE-{i + 1:03d}-{j + 1}",
                    "product_id": pid,
                    "ordered_pieces": pieces,
                    "net_value_per_piece_cents": VALUE_CENTS[pid] - int(rng.integers(0, 10)) * 100,
                }
            )
        orders.append(
            {
                "id": f"ORD-{i + 1:03d}",
                "customer_id": location["id"],
                "location_id": location["id"],
                "order_date": f"2026-09-{1 + int(rng.integers(14)):02d}",
                "priority": int(rng.integers(1, 6)),
                "lines": lines,
            }
        )
    inventory = [
        {"product_id": pid, "available_pieces": int(ordered[pid] * STOCK_SHARE[pid])}
        for pid in VALUE_CENTS
    ]
    return ScenarioDocument.model_validate(
        {
            "name": "Scarce stock lesson — 90 synthetic orders",
            "depot": {"id": "DC-MEM", "label": "Memphis DC", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
            "products": PRODUCTS,
            "locations": locations,
            "orders": orders,
            "inventory": inventory,
        }
    )


# Fixed k and an iteration budget: results repeat across machines and each run takes under a second.
SETTINGS = RunSettings(k=3, solver_max_iterations=200, solver_time_limit_s=10)


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "examples"
    document = {
        "scenario": build().model_dump(mode="json"),
        "settings": SETTINGS.model_dump(mode="json"),
    }
    (root / "lesson-allocation.json").write_text(json.dumps(document, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
