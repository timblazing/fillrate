#!/usr/bin/env python3
"""Live Valhalla smoke (spec §7, M6; docs/valhalla.md): a durable snapshot job against the configured
Valhalla, then a pipeline run on that immutable snapshot, an out-of-coverage stop left unreachable, and
queued-job cancellation. Needs a deployment covering Tennessee, Mississippi and Arkansas (Birmingham, AL
must be outside it). Usage: smoke_valhalla.py <base-url> <scenario-key>

Not part of deploy/smoke.sh: the image smoke runs without a road service. Run it against a Compose stack
started with `--profile valhalla` (or a dev server whose worker has the VALHALLA_* settings)."""

import io
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile

base, key = sys.argv[1].rstrip("/"), sys.argv[2]

DEPOT = {"id": "depot", "label": "Memphis DC", "lat": 35.1495, "lon": -90.049}
STOPS = {
    "NASH": ("Nashville, TN", 36.1627, -86.7816),
    "JKTN": ("Jackson, TN", 35.6145, -88.8139),
    "TUPE": ("Tupelo, MS", 34.2576, -88.7034),
    "JKMS": ("Jackson, MS", 32.2988, -90.1848),
    "LIRO": ("Little Rock, AR", 34.7465, -92.2896),
    "JONE": ("Jonesboro, AR", 35.8423, -90.7043),
    "BHAM": ("Birmingham, AL (outside coverage)", 33.5186, -86.8104),
}
ORDERS = ["order_id,line_id,order_date,location_id,location_label,address,latitude,longitude,"
          "product,ordered_pieces,net_value_per_piece,linear_feet_per_piece"]
for i, (sid, (label, lat, lon)) in enumerate(STOPS.items()):
    ORDERS.append(f"O-{sid},L-{sid},2026-09-{10 + i},{sid},\"{label}\",,{lat},{lon},SKU-A,4,12.50,1.25")
IMPORT = {"name": "Smoke Valhalla", "depot": DEPOT, "ordersCsv": "\n".join(ORDERS) + "\n",
          "inventoryCsv": "product,available_pieces\nSKU-A,100\n"}
META = {"timezone": "America/Chicago", "planningDate": "2026-09-30", "browserId": "smoke"}


def call(path, body=None, idempotent=False, expect=200, raw=False):
    headers = {"content-type": "application/json", "x-scenario-key": key}
    if idempotent:
        headers["idempotency-key"] = str(uuid.uuid4())
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, headers=headers,
                                     method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            status, payload = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, payload = error.code, error.read()
    if status != expect:
        sys.exit(f"{path}: expected {expect}, got {status}: {payload[:400]!r}")
    return payload if raw else json.loads(payload)


def finished(run_id, want="succeeded", timeout_s=600):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        result = call(f"/api/v1/runs/{run_id}")
        if result["status"] == want:
            return result
        if result["status"] in ("succeeded", "failed", "cancelled", "interrupted"):
            sys.exit(f"run {run_id} ended {result['status']}: {result.get('failure')}")
        time.sleep(1)
    sys.exit(f"run {run_id} did not finish")


assert call("/api/v1/travel-snapshots/jobs")["valhalla"]["configured"] is True, "Valhalla is not configured"
scenario = call("/api/v1/imports/commit", {**IMPORT, "author": "smoke", "metadata": META},
                idempotent=True, expect=201)
version = scenario["versionId"]

# Queued cancellation: a job cancelled before a worker claims it ends cancelled and stores nothing.
# (A worker may claim it first; then cancellation interrupts the build, which also stores nothing.)
doomed = call("/api/v1/travel-snapshots/jobs", {"versionId": version, "idempotencyKey": str(uuid.uuid4())},
              expect=201)
call(f"/api/v1/runs/{doomed['id']}/cancel", {}, expect=202)
cancelled = call(f"/api/v1/runs/{doomed['id']}")
for _ in range(60):
    if cancelled["status"] in ("cancelled", "succeeded"):
        break
    time.sleep(1)
    cancelled = call(f"/api/v1/runs/{doomed['id']}")
assert cancelled["status"] == "cancelled", cancelled["status"]
assert not cancelled.get("travel_snapshot"), cancelled.get("travel_snapshot")

started = time.time()
job = call("/api/v1/travel-snapshots/jobs", {"versionId": version, "idempotencyKey": str(uuid.uuid4())},
           expect=201)
built = finished(job["id"])
build_s = time.time() - started
result = built["travel_snapshot"]
snapshot_id = result["snapshot_id"]
assert built["kind"] == "travel_snapshot" and result["node_count"] == 8, result
meta = call(f"/api/v1/travel-snapshots/{snapshot_id}")
assert meta["provider"] == "valhalla" and meta["profile"] == "truck", meta
assert snapshot_id in {s["id"] for s in call("/api/v1/travel-snapshots")["snapshots"]}
inspect = call(f"/api/v1/travel-snapshots/{snapshot_id}?inspect=1")
document = call(f"/api/v1/travel-snapshots/{snapshot_id}?format=json")
warnings = [w for w in document["warnings"] if w.get("code") == "outside_coverage"]
assert warnings and warnings[0]["nodes"] == ["BHAM"], document["warnings"]
ids = [node["id"] for node in document["nodes"]]
bham = ids.index("BHAM")
assert all(row[bham] is None for i, row in enumerate(document["distances"]) if i != bham)
assert all(d is None for j, d in enumerate(document["distances"][bham]) if j != bham)
covered = [i for i in range(len(ids)) if i != bham]
assert all(document["distances"][i][j] is not None for i in covered for j in covered), "covered pair missing"

SETTINGS = {"k": 1, "solver_max_iterations": 500, "solver_time_limit_s": 10, "travel_snapshot_id": snapshot_id}
# By default a stop no allowed road path reaches blocks the run (preflight reads the same matrix).
findings = call("/api/v1/scenarios/preflight", {"versionId": version, "settings": SETTINGS})["findings"]
assert [(f["check"], f["action"], f["location_ids"]) for f in findings] == [
    ("far_from_depot", "block", ["BHAM"])], findings
call("/api/v1/scenarios/runs", {"versionId": version, "settings": SETTINGS}, idempotent=True, expect=422)
# Downgraded to a warning, the run plans every covered stop and reports BHAM as unreachable.
SETTINGS["preflight"] = {"far_from_depot": "warn"}
run = finished(call("/api/v1/scenarios/runs", {"versionId": version, "settings": SETTINGS},
                    idempotent=True, expect=201)["id"])
summary = run["summary"]
assert summary["travel"]["mode"] == "snapshot" and summary["travel"]["snapshot_id"] == snapshot_id
assert summary["validity"] == "valid", summary["diagnostics"]
assert [(u["location_id"], u["reason"]) for u in summary["unplanned"]] == [("BHAM", "unreachable")], summary["unplanned"]
planned = {v["location_id"] for truck in summary["trucks"] for v in truck["visits"]}
assert planned == set(STOPS) - {"BHAM"}, planned
# Every planned leg is the recorded directed matrix value (meters, rounded once).
index = {node_id: i for i, node_id in enumerate(ids)}
for truck in summary["trucks"]:
    previous = "depot"
    for visit in truck["visits"]:
        recorded = document["distances"][index[previous]][index[visit["location_id"]]]
        factor = 1000 if document["distance_units"] == "kilometers" else 1
        assert abs(visit["leg_m"] - round(recorded * factor)) <= 1, (previous, visit)
        previous = visit["location_id"]

# The replay bundle ships the exact Valhalla snapshot, so the run reproduces offline without Valhalla.
bundle = zipfile.ZipFile(io.BytesIO(call(f"/api/v1/runs/{run['id']}/export?format=python", raw=True)))
assert json.loads(bundle.read("travel-snapshot.json"))["provider"] == "valhalla"
assert json.loads(bundle.read("expected.json"))["travel"]["snapshot_id"] == snapshot_id

print(f"valhalla smoke ok: snapshot {snapshot_id[:8]} ({meta.get('providerVersion') or meta.get('provider_version')}) "
      f"built in {build_s:.1f} s, BHAM outside coverage and unreachable, run {run['id'][:8]} "
      f"{summary['totals']['trucks']} truck(s), {summary['totals']['loaded_distance_m'] / 1609.344:.0f} road mi; "
      f"queued job cancelled")
