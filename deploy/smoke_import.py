#!/usr/bin/env python3
"""Imported-scenario smoke (spec §14, M3): operator-key access, CSV preview → immutable save →
real worker run → validated result → branch → export. Usage: smoke_import.py <base-url> <key>"""

import json
import sys
import time
import urllib.error
import urllib.request
import uuid

base, key = sys.argv[1].rstrip("/"), sys.argv[2]

# Twelve stops around Memphis, two products, one product short of stock.
ORDERS = ["order_id,customer_id,line_id,order_date,location_id,location_label,address,"
          "latitude,longitude,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece"]
for i in range(12):
    lat, lon = 35.15 + (i % 4) * 0.35, -90.05 + (i // 4) * 0.45
    for j, sku in enumerate(("SKU-A", "SKU-B")):
        ORDERS.append(f"O-{i},C-{i},L-{i}-{j},2026-09-{10 + i},LOC-{i},Customer {i},,"
                      f"{lat:.4f},{lon:.4f},{sku},{4 + i % 3},{12 + j}.50,{4 + j}.25")
INVENTORY = "product,available_pieces\nSKU-A,200\nSKU-B,30\n"
IMPORT = {
    "name": "Smoke import",
    "depot": {"id": "depot", "label": "Memphis DC", "lat": 35.1495, "lon": -90.049},
    "ordersCsv": "\n".join(ORDERS) + "\n",
    "inventoryCsv": INVENTORY,
}
META = {"timezone": "America/Chicago", "planningDate": "2026-09-30", "browserId": "smoke"}
SETTINGS = {"k": 2, "solver_max_iterations": 300, "solver_time_limit_s": 5}


def call(path, body=None, auth=True, idempotent=False, expect=200):
    headers = {"content-type": "application/json"}
    if auth:
        headers["x-scenario-key"] = key
    if idempotent:
        headers["idempotency-key"] = str(uuid.uuid4())
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, headers=headers,
                                     method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    if status != expect:
        sys.exit(f"{path}: expected {expect}, got {status}: {raw[:300]!r}")
    return json.loads(raw) if raw.startswith((b"{", b"[")) else raw.decode()


# Without the operator key every imported-data route refuses.
call("/api/v1/scenarios", auth=False, expect=403)
call("/api/v1/imports/preview", IMPORT, auth=False, expect=403)

preview = call("/api/v1/imports/preview", IMPORT)
if not preview["valid"]:
    sys.exit(f"import preview invalid: {preview['errors'][:5]}")
saved = call("/api/v1/imports/commit", {**IMPORT, "author": "smoke", "metadata": META},
             idempotent=True, expect=201)
version = call(f"/api/v1/scenarios/{saved['scenarioId']}")
assert version["revision"] == 1 and version["source"]["originals"]["inventoryCsv"] == INVENTORY

# Stops with i % 3 == 2 order more than one trailer (57 ft): the default preflight blocks submission.
blocked = call("/api/v1/scenarios/runs", {"versionId": saved["versionId"], "settings": SETTINGS},
               idempotent=True, expect=422)
assert blocked["error"]["code"] == "preflight_blocked", blocked
excluded = blocked["error"]["fields"]
assert excluded and all(int(line.split("-")[1]) % 3 == 2 for line in excluded), excluded
SETTINGS["excluded_line_ids"] = excluded
run = call("/api/v1/scenarios/runs", {"versionId": saved["versionId"], "settings": SETTINGS},
           idempotent=True, expect=201)
run_id = run["id"]
for _ in range(150):
    detail = call(f"/api/v1/runs/{run_id}")
    if detail["status"] == "succeeded":
        break
    if detail["status"] in ("failed", "cancelled", "interrupted"):
        sys.exit(f"imported run ended {detail['status']}: {detail.get('error')}")
    time.sleep(2)
else:
    sys.exit("imported run did not finish")
summary = detail["summary"]
if summary["validity"] != "valid":
    sys.exit(f"imported run not validated: {summary['diagnostics']}")
short = [p for p in summary["products"] if p["product_id"] == "SKU-B"][0]
assert short["allocated"] == 30 and short["unselected"] > 0, short

# Imported results stay behind the key, including the public run list.
call(f"/api/v1/runs/{run_id}", auth=False, expect=403)
call(f"/api/v1/runs/{run_id}/export?format=csv&table=loads", auth=False, expect=403)
listed = call("/api/v1/runs", auth=False)
assert all(r["id"] != run_id for r in listed["runs"]), "imported run leaked into public list"

loads = call(f"/api/v1/runs/{run_id}/export?format=csv&table=loads")
assert len(loads.strip().splitlines()) > 2, loads[:200]

# Branch from the saved version with one edit; the original version and run are unchanged.
document = version["document"]
document["inventory"][1]["available_pieces"] = 60
branch = call(f"/api/v1/scenarios/{saved['scenarioId']}",
              {"document": document, "author": "smoke", "metadata": META,
               "source": version["source"], "expectedVersionId": saved["versionId"],
               "branch": True}, idempotent=True, expect=201)
assert branch["scenarioId"] != saved["scenarioId"]
branched = call(f"/api/v1/scenarios/{branch['scenarioId']}")
assert branched["parentVersionId"] == saved["versionId"]
original = call(f"/api/v1/scenarios/{saved['scenarioId']}?version={saved['versionId']}")
assert original["document"]["inventory"][1]["available_pieces"] == 30
# A stale save against the original version must conflict, never overwrite.
call(f"/api/v1/scenarios/{saved['scenarioId']}",
     {"document": document, "author": "smoke", "metadata": META, "source": version["source"],
      "expectedVersionId": saved["versionId"]}, idempotent=True, expect=201)
call(f"/api/v1/scenarios/{saved['scenarioId']}",
     {"document": document, "author": "smoke", "metadata": META, "source": version["source"],
      "expectedVersionId": saved["versionId"]}, idempotent=True, expect=409)

totals = summary["totals"]
print(f"import smoke ok: run {run_id} valid, {totals['trucks']} shipments, "
      f"{totals['planned_cents'] / 100:.2f} planned, branch {branch['versionId'][:8]}")
