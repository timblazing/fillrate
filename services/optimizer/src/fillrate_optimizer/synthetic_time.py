"""Bundled M6 time-window example (spec §5, §15): small, deterministic, synthetic.

One Memphis DC, six customers east and north of it, a 06:00 truck start and a 20:00 horizon in
America/Chicago on a day with no daylight-saving change. Windows and service minutes are set so
a plan has to wait at the first stop, order the stops by window, and use more than one truck.

Regenerate with `uv run python -m fillrate_optimizer.synthetic_time` (writes examples/).
"""

from __future__ import annotations

import json
from pathlib import Path

from .model import RunSettings, ScenarioDocument
from .synthetic import MEMPHIS, offset

# id, east mi, north mi, service minutes, window (earliest, latest) or None
STOPS = [
    ("TW-A", 15, 0, 30, ("09:00", "10:00")),  # reached at ~06:45, waits until 09:00
    ("TW-B", 30, 5, 45, ("10:30", "12:00")),
    ("TW-C", 45, 10, 30, ("13:00", "15:00")),
    ("TW-D", 20, 25, 60, None),  # service only
    ("TW-E", -30, 5, 20, ("07:00", "08:00")),  # opposite side: its own truck
    ("TW-F", -40, -10, 15, ("11:00", "17:00")),
]


def build() -> ScenarioDocument:
    locations, orders = [], []
    for n, (loc_id, east_mi, north_mi, service, window) in enumerate(STOPS, start=1):
        lat, lon = offset(MEMPHIS, east_mi, north_mi)
        locations.append(
            {
                "id": loc_id,
                "label": f"Time-window customer {loc_id[-1]}",
                "lat": lat,
                "lon": lon,
                "coordinate_source": "imported",
                "service_minutes": service,
                **({"window": {"earliest": window[0], "latest": window[1]}} if window else {}),
            }
        )
        orders.append(
            {
                "id": f"TW-O{n}",
                "location_id": loc_id,
                "order_date": "2026-10-05",
                "lines": [
                    {
                        "id": f"TW-O{n}-1",
                        "product_id": "P-PALLET",
                        "ordered_pieces": 2 + n % 3,
                        "net_value_per_piece_cents": 42_000,
                    }
                ],
            }
        )
    return ScenarioDocument.model_validate(
        {
            "name": "M6 time windows: Memphis DC",
            "depot": {"id": "DEPOT", "label": "Memphis DC", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
            "time_model": {
                "timezone": "America/Chicago",
                "planning_date": "2026-10-06",
                "depot_open": "06:00",
                "horizon_end": "20:00",
            },
            "products": [{"id": "P-PALLET", "label": "Full pallet", "linear_feet_per_piece": 400}],
            "locations": locations,
            "orders": orders,
            "inventory": [{"product_id": "P-PALLET", "available_pieces": 100}],
        }
    )


SETTINGS = RunSettings(cluster_strategy="none", solver_max_iterations=1_500, solver_time_limit_s=10)


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "examples"
    document = {
        "scenario": build().model_dump(mode="json"),
        "settings": SETTINGS.model_dump(mode="json"),
    }
    (root / "m6-time-windows.json").write_text(json.dumps(document, indent=1) + "\n")


if __name__ == "__main__":
    main()
