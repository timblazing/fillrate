#!/usr/bin/env python3
"""Directed travel snapshot smoke (spec §7, M6): upload an immutable snapshot, route a real worker run
over its directed legs, refuse a run after a stop's coordinates change, and check the replay bundle
carries the snapshot. Usage: smoke_travel.py <base-url> <scenario-key>"""

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
STOPS = {"A": (35.2, -90.1), "B": (35.3, -90.2), "C": (35.4, -90.3)}
ORDERS = ["order_id,line_id,order_date,location_id,location_label,address,latitude,longitude,"
          "product,ordered_pieces,net_value_per_piece,linear_feet_per_piece"]
for i, (name, (lat, lon)) in enumerate(STOPS.items()):
    ORDERS.append(f"O-{name},L-{name},2026-09-{10 + i},{name},Stop {name},,{lat},{lon},SKU-A,4,12.50,1.25")
IMPORT = {"name": "Smoke travel", "depot": DEPOT, "ordersCsv": "\n".join(ORDERS) + "\n",
          "inventoryCsv": "product,available_pieces\nSKU-A,100\n"}
META = {"timezone": "America/Chicago", "planningDate": "2026-09-30", "browserId": "smoke"}

# Directed legs in meters: depot → A → B → C is the only way forward. B and C have no direct leg from the
# depot (so straight lines would not predict this route), and every stop can return to the depot.
IDS = ["depot", "A", "B", "C"]
LEGS = {("depot", "A"): 20_000, ("A", "B"): 30_000, ("B", "C"): 40_000,
        ("A", "depot"): 25_000, ("B", "depot"): 35_000, ("C", "depot"): 45_000}
COORDS = {"depot": (DEPOT["lat"], DEPOT["lon"]), **STOPS}
DISTANCES = [[0 if a == b else LEGS.get((a, b)) for b in IDS] for a in IDS]
SNAPSHOT = {
    "nodes": [{"id": i, "lat": COORDS[i][0], "lon": COORDS[i][1]} for i in IDS],
    "provider": "imported", "provider_version": "smoke/1", "dataset_revision": "smoke-2026-10-01",
    "profile": "truck", "options": {"length": 21.64}, "distance_units": "meters",
    "duration_units": "seconds", "distances": DISTANCES,
    "durations": [[None if d is None else d / 10 for d in row] for row in DISTANCES],
}


def call(path, body=None, auth=True, idempotent=False, expect=200, raw=False):
    headers = {"content-type": "application/json"}
    if auth:
        headers["x-scenario-key"] = key
    if idempotent:
        headers["idempotency-key"] = str(uuid.uuid4())
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, headers=headers,
                                     method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, payload = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, payload = error.code, error.read()
    if status != expect:
        sys.exit(f"{path}: expected {expect}, got {status}: {payload[:300]!r}")
    return payload if raw else json.loads(payload)


# Uploading is operator-only, repeatable, and verified: invalid documents are refused with a reason.
call("/api/v1/travel-snapshots", SNAPSHOT, auth=False, expect=403)
bad = call("/api/v1/travel-snapshots", {**SNAPSHOT, "distances": SNAPSHOT["distances"][:-1]}, expect=422)
assert bad["error"]["code"] == "invalid_travel_snapshot", bad
saved = call("/api/v1/travel-snapshots", SNAPSHOT, expect=201)
snapshot_id = saved["id"]
assert len(snapshot_id) == 64 and saved["created"] and saved["nodeCount"] == 4, saved
assert call("/api/v1/travel-snapshots", SNAPSHOT)["created"] is False
assert call(f"/api/v1/travel-snapshots/{snapshot_id}")["profile"] == "truck"
call(f"/api/v1/travel-snapshots/{'0' * 64}", expect=404)

scenario = call("/api/v1/imports/commit", {**IMPORT, "author": "smoke", "metadata": META},
                idempotent=True, expect=201)
SETTINGS = {"k": 1, "solver_max_iterations": 300, "solver_time_limit_s": 5}

# Submission preflight reads the same matrix the worker will: B and C are reachable only through stops.
findings = call("/api/v1/scenarios/preflight", {"versionId": scenario["versionId"], "settings": {
    **SETTINGS, "travel_snapshot_id": snapshot_id}})["findings"]
assert [(f["check"], f["action"], f["location_ids"]) for f in findings] == [
    ("far_via_stop", "warn", ["B", "C"])], findings
call("/api/v1/scenarios/preflight", {"versionId": scenario["versionId"], "settings": {
    **SETTINGS, "travel_snapshot_id": "0" * 64}}, expect=404)

run = call("/api/v1/scenarios/runs", {"versionId": scenario["versionId"], "settings": {
    **SETTINGS, "travel_snapshot_id": snapshot_id}}, idempotent=True, expect=201)
for _ in range(150):
    detail = call(f"/api/v1/runs/{run['id']}")
    if detail["status"] == "succeeded":
        break
    if detail["status"] in ("failed", "cancelled", "interrupted"):
        sys.exit(f"snapshot run ended {detail['status']}: {detail.get('failure')}")
    time.sleep(2)
else:
    sys.exit("snapshot run did not finish")
summary = detail["summary"]
assert summary["validity"] == "valid" and summary["coverage"] == "complete", summary["diagnostics"]
# One truck over exactly the recorded directed legs; the 45 km return from C is never paid.
assert summary["totals"]["trucks"] == 1 and summary["totals"]["loaded_distance_m"] == 90_000, summary["totals"]
assert [v["location_id"] for v in summary["trucks"][0]["visits"]] == ["A", "B", "C"]
assert summary["travel"]["mode"] == "snapshot" and summary["travel"]["snapshot_id"] == snapshot_id

# A stop edited after the snapshot was taken cannot reuse it: refused before anything is queued.
version = call(f"/api/v1/scenarios/{scenario['scenarioId']}")
document = version["document"]
for location in document["locations"]:
    if location["id"] == "B":
        location["lat"] = round(location["lat"] + 0.01, 4)
edited = call(f"/api/v1/scenarios/{scenario['scenarioId']}",
              {"document": document, "author": "smoke", "metadata": META, "source": version["source"],
               "expectedVersionId": scenario["versionId"]}, idempotent=True, expect=201)
stale = call("/api/v1/scenarios/runs", {"versionId": edited["versionId"], "settings": {
    **SETTINGS, "travel_snapshot_id": snapshot_id}}, idempotent=True, expect=422)
assert stale["error"]["code"] == "travel_snapshot_stale" and "location:B" in stale["error"]["fields"], stale

# The replay bundle ships the exact snapshot, so the run reproduces offline.
bundle = zipfile.ZipFile(io.BytesIO(call(f"/api/v1/runs/{run['id']}/export?format=python", raw=True)))
shipped = json.loads(bundle.read("travel-snapshot.json"))
assert shipped["distances"] == DISTANCES and "replay.py" in bundle.namelist()

print(f"travel smoke ok: run {run['id']} routed depot → A → B → C over {snapshot_id[:8]} "
      f"({summary['totals']['loaded_distance_m']} m), stale edit refused, snapshot in the bundle")
