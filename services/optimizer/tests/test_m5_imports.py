"""M5 imports and geocoding: ZCTA lookup build, the approximate-coordinates policy, and
source-independent reproduction (how a coordinate was obtained never changes the plan)."""

import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest

from fillrate_optimizer import zcta
from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import run_pipeline
from fillrate_optimizer.preflight import preflight_checks

EXAMPLE = Path(__file__).resolve().parents[3] / "examples/m1-synthetic.json"


def archive(rows: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        z.writestr("2024_Gaz_zcta_national.txt", rows)
    return buffer.getvalue()


def test_zcta_lookup_is_pinned_and_uses_internal_points(monkeypatch):
    header = "GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG   \n"
    body = "".join(f"{n:05d}\t1\t0\t1\t0\t35.{n:06d}\t-90.5   \n" for n in range(30_000))
    data = archive(header + body)
    with pytest.raises(ValueError, match="does not match the pinned"):
        zcta.convert(data)
    monkeypatch.setattr(zcta, "SHA256", hashlib.sha256(data).hexdigest())
    lines = zcta.convert(data).splitlines()
    assert lines[0].startswith(f"# {zcta.DATASET} sha256=")
    assert lines[1] == "zcta\tlat\tlon"
    assert lines[2] == "00000\t35.000000\t-90.500000"
    assert len(lines) == 30_002
    short = archive(header + body[: body.index("00010")])
    monkeypatch.setattr(zcta, "SHA256", hashlib.sha256(short).hexdigest())
    with pytest.raises(ValueError, match="expected the national file"):
        zcta.convert(short)


def approximate_scenario():
    return ScenarioDocument.model_validate(
        {
            "name": "Approximate",
            "depot": {"id": "D", "label": "Depot", "lat": 35, "lon": -90},
            "products": [{"id": "P", "label": "P", "linear_feet_per_piece": 100}],
            "locations": [
                {
                    "id": "zip",
                    "label": "ZIP only",
                    "lat": 35.15,
                    "lon": -90.05,
                    "coordinate_source": "zcta",
                    "address": "1 Nowhere Rd, Memphis, TN 38103",
                    "geocode": {
                        "provider": "zcta",
                        "dataset": "zcta-gazetteer-2024",
                        "zcta": "38103",
                        "resolved_at": "2026-10-01T00:00:00.000Z",
                    },
                }
            ],
            "orders": [
                {
                    "id": "O",
                    "location_id": "zip",
                    "order_date": "2026-09-30",
                    "lines": [
                        {
                            "id": "L",
                            "product_id": "P",
                            "ordered_pieces": 1,
                            "net_value_per_piece_cents": 100,
                        }
                    ],
                }
            ],
            "inventory": [{"product_id": "P", "available_pieces": 1}],
        }
    )


def test_approximate_coordinates_warn_by_default_and_can_block():
    doc = approximate_scenario()
    (finding,) = preflight_checks(doc, RunSettings())
    assert (finding.check, finding.action, finding.line_ids) == (
        "approximate_coordinates",
        "warn",
        ["L"],
    )
    blocking = RunSettings(preflight={"approximate_coordinates": "block"})
    assert preflight_checks(doc, blocking)[0].action == "block"
    excluded = blocking.model_copy(update={"excluded_line_ids": ["L"]})
    assert preflight_checks(doc, excluded) == []


def test_coordinate_provenance_does_not_change_the_plan():
    """The same coordinates reached through Census, a correction or the file give one plan."""
    document = json.loads(EXAMPLE.read_text())
    settings = RunSettings.model_validate(document["settings"])
    original = ScenarioDocument.model_validate(document["scenario"])
    relabeled = original.model_dump(mode="json")
    for i, loc in enumerate(relabeled["locations"]):
        if loc["coordinate_source"] != "imported":
            continue
        loc["address"] = f"{i} Main St, Memphis, TN 38103"
        if i % 2:
            loc["coordinate_source"] = "census"
            loc["geocode"] = {
                "provider": "census",
                "dataset": "Public_AR_Current",
                "match_type": "exact",
                "matched_address": f"{i} MAIN ST, MEMPHIS, TN, 38103",
                "response_ref": "a" * 64,
                "resolved_at": "2026-10-01T00:00:00.000Z",
            }
        else:
            loc["coordinate_source"] = "manual"
            loc["original"] = {"lat": 0.5, "lon": 0.5, "coordinate_source": "imported"}
    relabeled = ScenarioDocument.model_validate(relabeled)
    a = run_pipeline(original, settings).summary
    b = run_pipeline(relabeled, settings).summary
    assert a.totals == b.totals
    assert [t.model_dump() for t in a.trucks] == [t.model_dump() for t in b.trucks]
    assert a.unplanned == b.unplanned and a.products == b.products
    assert [c.location_ids for c in a.clusters] == [c.location_ids for c in b.clusters]
    assert {loc.coordinate_source for loc in b.locations} >= {"census", "manual"}
