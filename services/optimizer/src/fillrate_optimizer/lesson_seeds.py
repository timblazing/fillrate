"""Lesson scenario "Seeds and solver budgets" (spec §13, M7): synthetic data only.

One Memphis DC and 60 customer stops scattered evenly around it, with no natural market
boundaries, so k-means has many near-equal ways to cut them into k = 5 groups. A single k-means
start (`kmeans_n_init` = 1) makes the cut depend on the seed. Stock is plentiful and every order is
one line, so the plan is about partitions and routes, not allocation. The scenario uses an iteration
budget for PyVRP (`solver_max_iterations`), so a run repeats exactly for the same seeds; a time
budget stops on the clock, which differs from run to run and is provenance, not a result.

Regenerate with `uv run python -m fillrate_optimizer.lesson_seeds` (writes examples/).
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
LOCATIONS = 60


def build() -> ScenarioDocument:
    rng = np.random.default_rng(20261004)
    locations, orders = [], []
    ordered = dict.fromkeys(VALUE_CENTS, 0)
    for n in range(LOCATIONS):
        angle = rng.uniform(0, 2 * math.pi)
        radius = 170 * math.sqrt(rng.uniform(0.02, 1))  # even spread over a disc
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
        pid = "SKU-PALLET" if rng.random() < 0.5 else "SKU-HALF"
        pieces = int(rng.integers(2, 8))
        ordered[pid] += pieces
        orders.append(
            {
                "id": f"ORD-{n + 1:03d}",
                "customer_id": f"LOC-{n + 1:02d}",
                "location_id": f"LOC-{n + 1:02d}",
                "order_date": f"2026-09-{1 + int(rng.integers(14)):02d}",
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
            "name": "Seeds lesson — 60 synthetic stops",
            "depot": {"id": "DC-MEM", "label": "Memphis DC", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
            "products": PRODUCTS,
            "locations": locations,
            "orders": orders,
            "inventory": [{"product_id": pid, "available_pieces": ordered[pid]} for pid in ordered],
        }
    )


# k = 5, one k-means start so the seed matters, and an iteration budget so runs repeat exactly.
SETTINGS = RunSettings(
    k=5,
    kmeans_n_init=1,
    kmeans_seed=0,
    solver_seed=0,
    solver_max_iterations=300,
    solver_time_limit_s=10,
)


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "examples"
    document = {
        "scenario": build().model_dump(mode="json"),
        "settings": SETTINGS.model_dump(mode="json"),
    }
    (root / "lesson-seeds.json").write_text(json.dumps(document, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
