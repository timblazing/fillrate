"""Cross-language fixture for directed travel snapshots (spec §7, M6).

pytest and Vitest both load `packages/contracts/fixtures/travel-parity.json` and must agree on the
snapshot's identity (canonical JSON + sha256), its integer-meter conversion (nearest, ties to even),
and the submission preflight findings. Regenerate with `uv run python -m tests.travel_parity`.
"""

import json
from pathlib import Path

from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.preflight import preflight_checks
from fillrate_optimizer.travel_provider import TravelNode, TravelSnapshot

PATH = Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/travel-parity.json"
STOPS = {"A": 1, "B": 2, "C": 3, "E": 4, "F": 5}  # longitudes east of the depot at (0, 0)
EXTRA = ("X", 9)  # in the snapshot, in no order
# Directed edges in meters. D→B is a half-meter tie that rounds to the 500-mile limit (804,672 m)
# with ties-to-even and to 804,673 m with round-half-up, so a rounding mismatch changes a finding.
EDGES = {
    ("D", "A"): 100_000,
    ("D", "B"): 804_672.5,
    ("A", "B"): 100_000,
    ("A", "C"): 200_000,
    ("C", "E"): 300_000,
    ("C", "A"): 50_000,
    ("E", "D"): 100_000,
    ("F", "D"): 100_000,
    ("X", "D"): 1,
}


def scenario_document(moved: dict[str, tuple[float, float]] | None = None) -> dict:
    moved = moved or {}
    locations = [
        {
            "id": name,
            "label": name,
            "lat": moved.get(name, (0, lon))[0],
            "lon": moved.get(name, (0, lon))[1],
            "coordinate_source": "imported",
        }
        for name, lon in STOPS.items()
    ] + [{"id": "M", "label": "M", "lat": None, "lon": None, "coordinate_source": "unresolved"}]
    return {
        "name": "travel parity",
        "depot": {"id": "D", "label": "Depot", "lat": 0, "lon": 0},
        "products": [{"id": "P", "label": "Pallet", "linear_feet_per_piece": 400}],
        "locations": locations,
        "orders": [
            {
                "id": f"O-{loc['id']}",
                "location_id": loc["id"],
                "order_date": "2026-09-30",
                "lines": [
                    {
                        "id": f"L-{loc['id']}",
                        "product_id": "P",
                        "ordered_pieces": 1,
                        "net_value_per_piece_cents": 100,
                    }
                ],
            }
            for loc in locations
        ],
        "inventory": [{"product_id": "P", "available_pieces": 10}],
    }


def snapshot_document() -> dict:
    ids = ["D", *STOPS, EXTRA[0]]
    lon = {"D": 0, **STOPS, EXTRA[0]: EXTRA[1]}
    n = len(ids)
    distances = [[0 if a == b else EDGES.get((a, b)) for b in ids] for a in ids]
    assert len(distances) == n
    return {
        "nodes": [{"id": i, "lat": 0, "lon": lon[i]} for i in ids],
        "provider": "imported",
        "provider_version": "parity-fixture/1",
        "dataset_revision": "fixture-2026-10-01",
        "profile": "truck",
        "options": {"length": 21.64, "hazmat": False},
        "distance_units": "meters",
        "duration_units": "seconds",
        "distances": distances,
        "durations": [[None if d is None else d / 10 for d in row] for row in distances],
    }


def findings(snapshot: TravelSnapshot, **settings) -> list[dict]:
    scenario = ScenarioDocument.model_validate(scenario_document())
    run = RunSettings(travel_snapshot_id=snapshot.identity, **settings)
    return [f.model_dump(mode="json") for f in preflight_checks(scenario, run, snapshot)]


def build() -> dict:
    snapshot = TravelSnapshot.model_validate(snapshot_document())
    subset = [TravelNode(id=i, lat=0, lon=lon) for i, lon in (("D", 0), ("B", 2), ("A", 1))]
    return {
        "scenario": scenario_document(),
        "snapshot": snapshot.model_dump(mode="json"),
        "identity": snapshot.identity,
        "effective_meters": {
            "nodes": [node.id for node in subset],
            "matrix": snapshot.effective(subset)[0].tolist(),
        },
        "findings": findings(snapshot),
        "findings_excluding_F": findings(snapshot, excluded_line_ids=["L-F"]),
    }


if __name__ == "__main__":
    PATH.write_text(json.dumps(build(), indent=1, sort_keys=True) + "\n")
