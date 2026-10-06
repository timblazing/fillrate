"""Bundled example "Mixed fleet" (spec §3, M6): synthetic data only.

One Memphis DC and 24 nearby stops that each order a few pallets. The fleet has two vehicle types,
a 53 ft trailer (cheap per foot, expensive per mile) and a 26 ft box truck (cheap to send, costly
per foot), with finite counts, under the `cost` objective with rates in integer cents. One cluster
(k = 1) keeps the example about the fleet: the counts are exact for the whole dispatch. Routing
uses the pipeline defaults (haversine × circuity travel).

Regenerate with `uv run python -m fillrate_optimizer.fleet_example` (writes examples/).
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
]
VALUE_CENTS = {"SKU-PALLET": 42_000, "SKU-HALF": 23_500}
LOCATIONS = 24

FLEET = [
    {
        "id": "trailer-53",
        "label": "53 ft trailer",
        "count": 3,
        "capacity": 5_300,
        "fixed_cost_cents": 45_000,
        "per_mile_cents": 320,
    },
    {
        "id": "box-26",
        "label": "26 ft box truck",
        "count": 8,
        "capacity": 2_600,
        "fixed_cost_cents": 12_000,
        "per_mile_cents": 210,
    },
]


def build() -> ScenarioDocument:
    rng = np.random.default_rng(20261005)
    locations, orders = [], []
    ordered = dict.fromkeys(VALUE_CENTS, 0)
    for n in range(LOCATIONS):
        angle = rng.uniform(0, 2 * math.pi)
        radius = rng.uniform(15, 140)
        lat, lon = offset(MEMPHIS, radius * math.cos(angle), radius * math.sin(angle))
        loc = f"LOC-{n + 1:02d}"
        locations.append(
            {
                "id": loc,
                "label": f"Customer {n + 1:02d}",
                "lat": lat,
                "lon": lon,
                "coordinate_source": "imported",
            }
        )
        pid = "SKU-PALLET" if rng.random() < 0.6 else "SKU-HALF"
        pieces = int(rng.integers(2, 7))
        ordered[pid] += pieces
        orders.append(
            {
                "id": f"ORD-{n + 1:03d}",
                "customer_id": loc,
                "location_id": loc,
                "order_date": f"2026-10-{1 + int(rng.integers(14)):02d}",
                "priority": 3,
                "lines": [
                    {
                        "id": f"LINE-{n + 1:03d}-1",
                        "product_id": pid,
                        "ordered_pieces": pieces,
                        "net_value_per_piece_cents": VALUE_CENTS[pid],
                    }
                ],
            }
        )
    return ScenarioDocument.model_validate(
        {
            "name": "Mixed fleet — 24 synthetic stops",
            "depot": {"id": "DC-MEM", "label": "Memphis DC", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
            "products": PRODUCTS,
            "locations": locations,
            "orders": orders,
            "inventory": [{"product_id": pid, "available_pieces": ordered[pid]} for pid in ordered],
        }
    )


# One cluster and an iteration budget: results repeat across machines and run in about a second.
SETTINGS = RunSettings(
    k=1, solver_max_iterations=300, solver_time_limit_s=10, objective="cost", fleet=FLEET
)
# The same scenario on today's single trailer: the baseline the example compares against.
BASELINE = RunSettings(
    k=1,
    solver_max_iterations=300,
    solver_time_limit_s=10,
    objective="cost",
    cost_per_truck_cents=45_000,
    cost_per_mile_cents=320,
)


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "examples"
    document = {
        "scenario": build().model_dump(mode="json"),
        "settings": SETTINGS.model_dump(mode="json"),
    }
    (root / "fleet-mixed.json").write_text(json.dumps(document, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
