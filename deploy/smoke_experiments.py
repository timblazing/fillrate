#!/usr/bin/env python3
"""Experiments smoke (spec §14, M4/M7): on the bundled lesson scenario, a k explorer job and its
replay bundle, a two-run sweep with a ranked Best option, and a Python replay bundle of a finished run; on the allocation
lesson scenario, a CP-SAT whole-order run and its replay bundle.
Usage: smoke_experiments.py <base-url> <run-key> <finished-run-id>"""

import io
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile

base, key, run_id = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]


def call(path, body=None, expect=200, raw=False):
    headers = {"content-type": "application/json", "x-run-key": key}
    if body is not None:
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


def wait(check, what, seconds=300):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        result = check()
        if result is not None:
            return result
        time.sleep(2)
    sys.exit(f"{what} did not finish in {seconds} s")


examples = {e["id"] for e in call("/api/v1/examples")["examples"]}
if examples != {"m1", "lesson", "allocation", "capacity", "seeds", "windows", "windows_off",
                "manual", "matrix_estimated", "matrix_recorded"}:
    sys.exit(f"unexpected examples: {examples}")
call("/api/v1/runs", {"example": "nope"}, expect=400)

# k explorer: k 8 and 9 × seeds 0–9 plus three H3 resolutions on the lesson scenario.
explorer = call("/api/v1/explorer", {"example": "lesson", "settings": {"ks": [8, 9], "selected_k": 8}}, expect=201)


def explorer_done():
    detail = call(f"/api/v1/runs/{explorer['id']}")
    if detail["status"] in ("failed", "cancelled", "interrupted"):
        sys.exit(f"explorer ended {detail['status']}: {detail.get('failure')}")
    return detail if detail["status"] == "succeeded" else None


detail = wait(explorer_done, "explorer")
per_k = {row["k"]: row for row in detail["explorer"]["per_k"]}
if sorted(per_k) != [8, 9] or detail["explorer"]["tasks"] != 23:
    sys.exit(f"explorer summary unexpected: ks={sorted(per_k)} tasks={detail['explorer']['tasks']}")
print(f"explorer ok: k=8 stability {per_k[8]['stability_raw']}, k=9 {per_k[9]['stability_raw']}")

# The explorer's replay bundle: the recorded explorer artifact as expected.json and the explorer replay module.
bundle = zipfile.ZipFile(io.BytesIO(call(f"/api/v1/runs/{explorer['id']}/export?format=python", raw=True)))
expected = json.loads(bundle.read("expected.json"))
if expected.get("kind") != "explorer" or expected.get("travel", {}).get("metric") != "spatial" \
        or expected["summary"]["per_k"] != detail["explorer"]["per_k"]:
    sys.exit(f"explorer replay expected.json unexpected: {sorted(expected)}")
if not {"replay.py", "scenario.json", "settings.json",
        "optimizer/src/fillrate_optimizer/explorer_replay.py"} <= set(bundle.namelist()):
    sys.exit("explorer replay bundle lacks its replay files")
print(f"explorer replay bundle ok: {len(bundle.namelist())} files")

# Sweep: preview enqueues nothing, then two runs (k 6 and 8) ranked within one cohort.
sweep = {"example": "lesson", "name": "Smoke sweep", "axes": {"k": [6, 8]}}
preview = call("/api/v1/experiments/preview", sweep)
if preview["count"] != 2:
    sys.exit(f"preview count {preview['count']} != 2")
experiment = call("/api/v1/experiments", sweep, expect=201)


def sweep_done():
    detail = call(f"/api/v1/experiments/{experiment['id']}")
    states = [r["status"] for r in detail["runs"]]
    if any(s in ("failed", "cancelled", "interrupted") for s in states):
        sys.exit(f"sweep run ended badly: {states}")
    return detail if all(s == "succeeded" for s in states) else None


detail = wait(sweep_done, "sweep", 600)
ranked = sorted((r for r in detail["runs"] if r["rank"]), key=lambda r: r["rank"])
if len(ranked) != 2 or ranked[0]["label"] is None or not all(r["eligible"] for r in detail["runs"]):
    sys.exit(f"sweep not ranked: {[(r['k'], r['rank'], r['label'], r['reason']) for r in detail['runs']]}")
csv = call(f"/api/v1/experiments/{experiment['id']}/export?format=csv", raw=True).decode()
if "ranking order" not in csv.splitlines()[0]:
    sys.exit("sweep CSV lacks the ranking-order note")
print("sweep ok: " + ", ".join(f"k={r['k']} rank {r['rank']} ({r['label']})" for r in ranked))

# Replay bundle of a finished run.
bundle = zipfile.ZipFile(io.BytesIO(call(f"/api/v1/runs/{run_id}/export?format=python", raw=True)))
names = set(bundle.namelist())
for required in ("replay.py", "scenario.json", "settings.json"):
    if not any(n.endswith(required) for n in names):
        sys.exit(f"replay bundle lacks {required}: {sorted(names)[:20]}")
print(f"replay bundle ok: {len(names)} files")

# Allocation lesson (M7): a CP-SAT whole-order run on the small scarce-stock scenario, then its bundle.
call("/api/v1/runs", {"example": "allocation", "settings": {"allocation_strategy": "nope"}}, expect=400)
lesson_run = call("/api/v1/runs", {"example": "allocation", "settings": {"allocation_strategy": "optimized", "fulfillment_policy": "whole_order"}}, expect=201)


def lesson_done():
    detail = call(f"/api/v1/runs/{lesson_run['id']}")
    if detail["status"] in ("failed", "cancelled", "interrupted"):
        sys.exit(f"allocation lesson run ended badly: {detail['status']}")
    return detail if detail["status"] == "succeeded" else None


detail = wait(lesson_done, "allocation lesson run", 300)
summary = detail["summary"]
if (summary["validity"], summary["coverage"]) != ("valid", "complete") or summary["allocation"]["kind"] != "cp_sat":
    sys.exit(f"allocation lesson run unexpected: {summary['validity']}, {summary['coverage']}, {summary['allocation']['kind']}")
bundle = zipfile.ZipFile(io.BytesIO(call(f"/api/v1/runs/{lesson_run['id']}/export?format=python", raw=True)))
expected = json.loads(bundle.read("expected.json"))
if expected["allocation"] != {"strategy": "optimized", "fulfillment_policy": "whole_order", "kind": "cp_sat"} or expected["travel"]["provider"] != "estimated":
    sys.exit(f"replay expected.json lacks allocation/travel provenance: {expected}")
if "optimizer/src/fillrate_optimizer/replay.py" not in bundle.namelist():
    sys.exit("replay bundle lacks the replay module")
print(f"allocation lesson ok: {summary['totals']['trucks']} shipments, ${summary['totals']['planned_cents'] / 100:,.0f} planned, replay bundle ok")
