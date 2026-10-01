#!/usr/bin/env python3
"""Geocoding and GeoJSON smoke (spec §6, M5): the bundled ZCTA lookup is installed, a GeoJSON
import with address-only stops is saved, and a geocoding job resolves it through the live Census
batch geocoder (with the ZIP fallback) into a new version. Usage: smoke_geocode.py <base-url> <key>"""

import json
import sys
import time
import urllib.error
import urllib.request
import uuid

base, key = sys.argv[1].rstrip("/"), sys.argv[2]
META = {"timezone": "America/Chicago", "planningDate": "2026-09-30", "browserId": "smoke"}


def call(path, body=None, expect=200, idempotent=False):
    headers = {"content-type": "application/json", "x-scenario-key": key}
    if idempotent:
        headers["idempotency-key"] = str(uuid.uuid4())
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, headers=headers,
                                     method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    if status != expect:
        sys.exit(f"{path}: expected {expect}, got {status}: {raw[:300]!r}")
    return json.loads(raw)


caps = call("/api/v1/geocode")
assert caps["zcta"] == {"dataset": "zcta-gazetteer-2024"}, caps
assert caps["census"]["benchmark"] == "Public_AR_Current", caps


def feature(i, point, address=None):
    props = {"order_id": f"G-{i}", "order_date": "2026-09-30", "product": "SKU-A",
             "ordered_pieces": 2, "net_value_per_piece": "10.00", "linear_feet_per_piece": "4.00"}
    if address:
        props["address"] = address
    geometry = {"type": "Point", "coordinates": point} if point else None
    return {"type": "Feature", "geometry": geometry, "properties": props}


GEOJSON = {"type": "FeatureCollection", "features": [
    feature(1, [-90.1, 35.3]),
    feature(2, None, "125 N Main St, Memphis, TN 38103"),  # Census matches this one
    feature(3, None, "99999 Qqqzx Zzyzx Ln, Memphis, TN 38103"),  # Census does not: ZIP fallback
]}
IMPORT = {"format": "geojson", "name": "Smoke GeoJSON", "ordersGeojson": json.dumps(GEOJSON),
          "inventoryCsv": "product,available_pieces\nSKU-A,10\n",
          "depot": {"id": "depot", "label": "Memphis DC", "lat": 35.1495, "lon": -90.049}}
preview = call("/api/v1/imports/preview", IMPORT)
assert preview["valid"] and preview["review"]["geocodable"] == 2, preview["errors"] or preview["review"]
saved = call("/api/v1/imports/commit", {**IMPORT, "author": "smoke", "metadata": META},
             idempotent=True, expect=201)

job = call("/api/v1/geocode/jobs", {"versionId": saved["versionId"], "options": {},
                                    "author": "smoke", "metadata": META},
           idempotent=True, expect=202)
for _ in range(90):
    job = call(f"/api/v1/geocode/jobs/{job['id']}")
    if job["status"] in ("succeeded", "failed"):
        break
    time.sleep(2)
if job["status"] != "succeeded":
    sys.exit(f"geocoding job {job['status']}: {job.get('error')}")
version = call(f"/api/v1/scenarios/{job['resultScenarioId']}?version={job['resultVersionId']}")
assert version["revision"] == 2 and version["parentVersionId"] == saved["versionId"], version
locations = {loc["id"]: loc for loc in version["document"]["locations"]}
census, fallback = locations["location-G-2"], locations["location-G-3"]
assert census["coordinate_source"] == "census" and census["geocode"]["response_ref"], census
assert abs(census["lat"] - 35.1486) < 0.01 and abs(census["lon"] + 90.0516) < 0.01, census
assert fallback["coordinate_source"] in ("zcta", "census"), fallback
if fallback["coordinate_source"] == "zcta":
    assert fallback["geocode"] == {**fallback["geocode"], "dataset": "zcta-gazetteer-2024",
                                   "zcta": "38103"}, fallback
print(f"geocode smoke ok: {job['report']}")
