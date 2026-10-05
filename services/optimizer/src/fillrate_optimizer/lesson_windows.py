"""Lesson scenario "Time windows and waiting" (spec §13, M6/M7): synthetic data only.

One Memphis DC and nine customers on a single planning day in America/Chicago (no daylight-saving
change). All freight fits one 53 ft trailer, so capacity never sets the truck count: the windows
do. Trucks leave at 06:00 and must finish by 20:00. Every customer has a service duration; seven
also accept deliveries only inside a service-start window. Some windows open after a truck could
arrive (it waits), and an early west-side window conflicts with early east-side ones, so one truck
cannot meet them all.

`build(windows=False)` is the same scenario with every window removed (service durations and the
shift are kept), so the two bundled examples differ only in the windows. Routing uses the
pipeline's estimated travel (straight-line distance × 1.2 at a constant 25 mph); this lesson does
not use road matrices.

Regenerate with `uv run python -m fillrate_optimizer.lesson_windows` (writes examples/).
"""

from __future__ import annotations

import json
from pathlib import Path

from .model import RunSettings, ScenarioDocument
from .synthetic import MEMPHIS, offset

# id, label, east mi, north mi, full pallets, service minutes, window (earliest, latest) or None
STOPS = [
    ("TW-01", "Bakery supply", 18, -1, 2, 30, ("13:00", "15:00")),
    ("TW-02", "Grocery warehouse", 32, 6, 2, 45, ("08:00", "09:30")),
    ("TW-03", "Hardware store", 42, 21, 1, 20, ("09:30", "11:30")),
    ("TW-04", "Farm co-op", 10, 24, 2, 40, None),
    ("TW-05", "Restaurant depot", -8, 3, 1, 15, ("06:30", "07:30")),
    ("TW-06", "Clinic", -13, 10, 1, 15, ("16:00", "18:00")),
    ("TW-07", "School district", 1, -18, 1, 30, ("07:30", "09:00")),
    ("TW-08", "Builder yard", 13, -14, 2, 60, None),
    ("TW-09", "Pharmacy", 10, 7, 1, 10, ("10:00", "10:30")),
]
PALLET_CENTS = 42_000


def build(windows: bool = True) -> ScenarioDocument:
    locations, orders = [], []
    for n, (loc_id, label, east_mi, north_mi, pallets, service, window) in enumerate(STOPS, 1):
        lat, lon = offset(MEMPHIS, east_mi, north_mi)
        locations.append(
            {
                "id": loc_id,
                "label": label,
                "lat": lat,
                "lon": lon,
                "coordinate_source": "imported",
                "service_minutes": service,
                **(
                    {"window": {"earliest": window[0], "latest": window[1]}}
                    if windows and window
                    else {}
                ),
            }
        )
        orders.append(
            {
                "id": f"TW-ORD-{n:02d}",
                "customer_id": loc_id,
                "location_id": loc_id,
                "order_date": "2026-10-01",
                "priority": 3,
                "lines": [
                    {
                        "id": f"TW-ORD-{n:02d}-1",
                        "product_id": "SKU-PALLET",
                        "ordered_pieces": pallets,
                        "net_value_per_piece_cents": PALLET_CENTS,
                    }
                ],
            }
        )
    total = sum(s[4] for s in STOPS)
    return ScenarioDocument.model_validate(
        {
            "name": "Time windows lesson — 9 synthetic stops"
            + ("" if windows else ", windows removed"),
            "depot": {"id": "DC-MEM", "label": "Memphis DC", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
            "time_model": {
                "timezone": "America/Chicago",
                "planning_date": "2026-10-06",
                "depot_open": "06:00",
                "horizon_end": "20:00",
            },
            "products": [
                {"id": "SKU-PALLET", "label": "Full pallet", "linear_feet_per_piece": 400}
            ],
            "locations": locations,
            "orders": orders,
            "inventory": [{"product_id": "SKU-PALLET", "available_pieces": total}],
        }
    )


# One cluster and an iteration budget: results repeat across machines and run in about a second.
SETTINGS = RunSettings(k=1, solver_max_iterations=1_000, solver_time_limit_s=10)


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "examples"
    for name, windows in (("lesson-windows.json", True), ("lesson-windows-off.json", False)):
        document = {
            "scenario": build(windows).model_dump(mode="json"),
            "settings": SETTINGS.model_dump(mode="json"),
        }
        (root / name).write_text(json.dumps(document, indent=1) + "\n")


if __name__ == "__main__":
    main()
