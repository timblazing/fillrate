"""Bundled M1 synthetic scenario (spec §15): small, deterministic, and exercising every
unplanned reason the pipeline reports.

- ~30 customer locations around a Memphis DC with scarce stock on two products;
- one location beyond one trailer (greedy visit split);
- a chain: depot → A ≈ 396 mi, A → B ≈ 198 mi, depot → B ≈ 594 mi (reachable via A);
- one isolated location ~870 mi away (unreachable);
- one unresolved coordinate (excluded in preflight);
- one oversize indivisible piece (excluded in preflight).

Regenerate with `uv run python -m fillrate_optimizer.synthetic` (writes examples/).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

from .model import PreflightPolicy, RunSettings, ScenarioDocument

MEMPHIS = (35.1495, -90.0490)
MILES_PER_DEG_LAT = 69.0934


def offset(origin: tuple[float, float], east_mi: float, north_mi: float) -> tuple[float, float]:
    lat = origin[0] + north_mi / MILES_PER_DEG_LAT
    lon = origin[1] + east_mi / (MILES_PER_DEG_LAT * math.cos(math.radians(origin[0])))
    return round(lat, 5), round(lon, 5)


def build() -> ScenarioDocument:
    rng = np.random.default_rng(20260930)
    products = [
        {"id": "P-PALLET", "label": "Full pallet", "linear_feet_per_piece": 400},
        {"id": "P-HALF", "label": "Half pallet", "linear_feet_per_piece": 200},
        {"id": "P-ROLL", "label": "Carpet roll", "linear_feet_per_piece": 150},
        {"id": "P-CRATE", "label": "Machine crate", "linear_feet_per_piece": 5_400},
    ]
    values = {"P-PALLET": 42_000, "P-HALF": 23_500, "P-ROLL": 12_800, "P-CRATE": 980_000}
    locations = []
    for i in range(28):
        angle = rng.uniform(0, 2 * math.pi)
        radius = rng.uniform(25, 320)
        lat, lon = offset(MEMPHIS, radius * math.cos(angle), radius * math.sin(angle))
        locations.append(
            {
                "id": f"L{i + 1:02d}",
                "label": f"Customer {i + 1:02d}",
                "lat": lat,
                "lon": lon,
                "coordinate_source": "imported",
            }
        )
    a = offset(MEMPHIS, 330, 0)
    b = offset(a, 165, 0)
    specials = [
        {"id": "L-CHAIN-A", "label": "Chain A (≈396 mi)", "lat": a[0], "lon": a[1]},
        {"id": "L-CHAIN-B", "label": "Chain B (≈594 mi, via A)", "lat": b[0], "lon": b[1]},
        {"id": "L-FAR", "label": "Isolated (Denver)", "lat": 39.7392, "lon": -104.9903},
        {
            "id": "L-BIG",
            "label": "Big box store",
            "lat": offset(MEMPHIS, -40, 60)[0],
            "lon": offset(MEMPHIS, -40, 60)[1],
        },
    ]
    for s in specials:
        locations.append({**s, "coordinate_source": "imported"})
    locations.append(
        {
            "id": "L-NOCOORD",
            "label": "Unresolved address",
            "lat": None,
            "lon": None,
            "coordinate_source": "unresolved",
        }
    )

    orders = []
    n = 0

    def order(loc: str, day: int, items: list[tuple[str, int]]):
        nonlocal n
        n += 1
        orders.append(
            {
                "id": f"O{n:03d}",
                "customer_id": f"customer-{loc}",
                "location_id": loc,
                "order_date": f"2026-09-{day:02d}",
                "lines": [
                    {
                        "id": f"O{n:03d}-{k + 1}",
                        "product_id": pid,
                        "ordered_pieces": q,
                        "net_value_per_piece_cents": values[pid],
                    }
                    for k, (pid, q) in enumerate(items)
                ],
            }
        )

    small = ["P-PALLET", "P-HALF", "P-ROLL"]
    for loc in locations[:28]:
        for _ in range(int(rng.integers(1, 3))):
            count = int(rng.integers(1, 3))
            picks = rng.choice(small, size=count, replace=False)
            order(
                loc["id"],
                int(rng.integers(1, 29)),
                [(str(p), int(rng.integers(2, 9))) for p in picks],
            )
    order("L-CHAIN-A", 3, [("P-PALLET", 6)])
    order("L-CHAIN-B", 4, [("P-PALLET", 5), ("P-ROLL", 4)])
    order("L-FAR", 2, [("P-HALF", 6)])
    order("L-BIG", 1, [("P-PALLET", 14), ("P-HALF", 10)])
    order("L-BIG", 5, [("P-ROLL", 12)])
    order("L-NOCOORD", 2, [("P-PALLET", 3)])
    order("L05", 6, [("P-CRATE", 1)])

    demand = {p: 0 for p in values}
    for o in orders:
        for line in o["lines"]:
            demand[line["product_id"]] += line["ordered_pieces"]
    inventory = [
        {"product_id": "P-PALLET", "available_pieces": int(demand["P-PALLET"] * 0.8)},
        {"product_id": "P-HALF", "available_pieces": int(demand["P-HALF"] * 0.7)},
        {"product_id": "P-ROLL", "available_pieces": demand["P-ROLL"] + 20},
        {"product_id": "P-CRATE", "available_pieces": 2},
    ]
    return ScenarioDocument.model_validate(
        {
            "name": "M1 synthetic: Memphis DC",
            "depot": {"id": "DEPOT", "label": "Memphis DC", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
            "products": products,
            "locations": locations,
            "orders": orders,
            "inventory": inventory,
        }
    )


# Iteration-bounded so the bundled run is quick and reproducible across machines.
# The example deliberately contains all three blocking preflight cases, so it declares them as
# warnings and keeps exercising those paths (spec §15 M2 scope item 8). With the diameter policy
# off, auto-k only enforces solve size, so the example uses a fixed k as the Blocks do.
SETTINGS = RunSettings(
    k=4,
    solver_max_iterations=1_500,
    solver_time_limit_s=10,
    preflight=PreflightPolicy(
        missing_coordinates="warn", far_from_depot="warn", oversize_stop="warn"
    ),
)


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "examples"
    document = {
        "scenario": build().model_dump(mode="json"),
        "settings": SETTINGS.model_dump(mode="json"),
    }
    (root / "m1-synthetic.json").write_text(json.dumps(document, indent=1) + "\n")


if __name__ == "__main__":
    main()
