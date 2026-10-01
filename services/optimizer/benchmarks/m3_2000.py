"""Reproducible M3 throughput probe: 2,000 order lines and 640 locations.

Run from services/optimizer: uv run python benchmarks/m3_2000.py.
This generates synthetic input only and writes no customer data.
"""

from __future__ import annotations

import json
import math
import time
from collections import defaultdict
from pathlib import Path

from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import Limits, run_pipeline
from fillrate_optimizer.synthetic import build


def make_scenario() -> ScenarioDocument:
    doc = build().model_dump(mode="json")
    doc["name"] = "M3 benchmark — 2,000 synthetic orders"
    doc["locations"] = []
    for index in range(640):
        angle = index * 2.399963229728653
        radius = 0.08 + 0.90 * math.sqrt((index + 0.5) / 640)
        doc["locations"].append(
            {
                "id": f"benchmark-location-{index:04d}",
                "label": f"Synthetic stop {index + 1}",
                "lat": round(35.1495 + radius * math.sin(angle), 6),
                "lon": round(-90.049 + radius * math.cos(angle), 6),
                "coordinate_source": "imported",
            }
        )
    product_ids = [x["id"] for x in doc["products"]]
    doc["orders"] = []
    for index in range(2000):
        doc["orders"].append(
            {
                "id": f"benchmark-order-{index:05d}",
                "location_id": f"benchmark-location-{index % 640:04d}",
                "order_date": f"2026-09-{1 + index % 28:02d}",
                "lines": [
                    {
                        "id": f"benchmark-line-{index:05d}",
                        "product_id": product_ids[index % len(product_ids)],
                        "ordered_pieces": 1 + index % 12,
                        "net_value_per_piece_cents": 1_000 + index % 500,
                        "linear_feet_per_piece": 50 + index % 60,
                    }
                ],
            }
        )
    doc["inventory"] = [
        {"product_id": product_id, "available_pieces": 20_000} for product_id in product_ids
    ]
    return ScenarioDocument.model_validate(doc)


def main():
    scenario = make_scenario()
    settings = RunSettings(k=8, solver_max_iterations=500, solver_time_limit_s=5)
    events: list[tuple[str, float]] = []
    started = time.monotonic()
    output = run_pipeline(
        scenario,
        settings,
        limits=Limits(run_wall_limit_s=600),
        progress=lambda name, detail: events.append((name, time.monotonic())),
    )
    ended = time.monotonic()
    stages: dict[str, float] = defaultdict(float)
    for (name, at), (_, next_at) in zip(events, events[1:] + [("end", ended)], strict=True):
        stages[name] += next_at - at
    report = {
        "orders": len(scenario.orders),
        "lines": sum(len(o.lines) for o in scenario.orders),
        "locations": len(scenario.locations),
        "elapsed_s": round(ended - started, 3),
        "stage_s": {k: round(v, 3) for k, v in stages.items()},
        "validity": output.summary.validity,
        "trucks": output.summary.totals.trucks,
        "clusters": len(output.summary.clusters),
    }
    print(json.dumps(report, indent=2))
    Path("benchmarks/m3_2000_result.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
