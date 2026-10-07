#!/usr/bin/env python3
"""Target-hardware and recovery evidence (spec §§14–16, docs/release-verification.md) for one host,
against one tested image. Everything runs in disposable containers and volumes; the operator's
deployment and its data are never touched.

1. Metadata: kernel, CPU, memory, Docker, image digest.
2. Benchmarks: the 2,000-order probe inside the image, 5 comparable and 3 default-budget runs,
   summarized (median/min/max); any invalid result or failed attempt fails the check.
3. Recovery, on a container started with `--restart unless-stopped`, LEASE_MS=15000 and 3 s heartbeats:
   persistence  an imported scenario run and a synthetic run survive a container restart unchanged
   worker loss  SIGKILL the worker supervisor mid-solve; the container restarts, the lease expires,
                attempt 2 reuses the checkpointed stages and succeeds with one valid result
   cancel       cancel a running and a queued run; both end cancelled and the worker takes new work
   backup       deploy/backup.sh, restore into a fresh volume, start a second container on the copy
                and compare scenarios, runs and exports
Raw outputs go to <out>; summary.json and summary.md are written last.

Usage: deploy/target_check.py <image> <out-dir> [--label NAME] [--skip-bench] [--skip-recovery]
Needs docker, python3 and sha256sum on the host. Run from the repository root (or a copy holding
deploy/ and services/optimizer/benchmarks/)."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUN_KEY, SCENARIO_KEY = "check", "check-scenario"
ap = argparse.ArgumentParser()
ap.add_argument("image")
ap.add_argument("out")
ap.add_argument("--label", default=platform.node())
ap.add_argument("--port", type=int, default=3990)
ap.add_argument("--comparable", type=int, default=5)
ap.add_argument("--default-budget", type=int, default=3)
ap.add_argument("--skip-bench", action="store_true")
ap.add_argument("--skip-recovery", action="store_true")
args = ap.parse_args()
out = Path(args.out).resolve()
out.mkdir(parents=True, exist_ok=True)
tag = f"fillrate-check-{os.getpid()}"
results: dict = {"label": args.label, "image": args.image, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
log_file = open(out / "check.log", "a")


def log(message: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {message}"
    print(line, flush=True)
    log_file.write(line + "\n")
    log_file.flush()


def sh(*cmd: str, check: bool = True, input: bytes | None = None, capture: bool = True) -> str:
    done = subprocess.run(cmd, input=input, capture_output=capture, check=False)
    if check and done.returncode:
        raise RuntimeError(f"{' '.join(cmd)} exited {done.returncode}: {(done.stderr or b'').decode()[-500:]}")
    return (done.stdout or b"").decode()


def save(name: str, data) -> None:
    (out / name).write_text(data if isinstance(data, str) else json.dumps(data, indent=2, sort_keys=True))


def cpu_model():
    info = Path("/proc/cpuinfo").read_text() if Path("/proc/cpuinfo").exists() else ""
    fields = dict(reversed([tuple(x.strip() for x in l.split(":", 1)) for l in info.splitlines() if ":" in l]))
    return fields.get("model name") or fields.get("Model")  # x86 / arm


# --- 1. metadata -------------------------------------------------------------------------------
def metadata() -> dict:
    meminfo = Path("/proc/meminfo").read_text() if Path("/proc/meminfo").exists() else ""
    mem_kb = next((int(l.split()[1]) for l in meminfo.splitlines() if l.startswith("MemTotal")), None)
    meta = {
        "uname": sh("uname", "-a").strip(),
        "machine": platform.machine(),
        "cpus": os.cpu_count(),
        "cpu_model": cpu_model(),
        "mem_total_mb": mem_kb // 1024 if mem_kb else None,
        "docker": sh("docker", "version", "--format", "{{.Server.Version}} ({{.Server.Os}}/{{.Server.Arch}})").strip(),
        "image_id": sh("docker", "image", "inspect", args.image, "--format", "{{.Id}}").strip(),
        "image_digests": json.loads(sh("docker", "image", "inspect", args.image, "--format", "{{json .RepoDigests}}")),
        "image_revision": sh("docker", "image", "inspect", args.image, "--format",
                             '{{index .Config.Labels "org.opencontainers.image.revision"}}').strip(),
    }
    save("metadata.json", meta)
    return meta


# --- 2. benchmarks -----------------------------------------------------------------------------
def benchmarks() -> dict:
    bench_dir = ROOT / "services/optimizer/benchmarks"
    raw = out / "bench"
    raw.mkdir(exist_ok=True)
    runs: dict[str, list] = {"comparable": [], "default_budget": []}
    failures = 0
    for mode, count, flag in (("comparable", args.comparable, ""), ("default_budget", args.default_budget, "--default-budget")):
        for attempt in range(1, count + 1):
            name = f"{mode}-{attempt}.json"
            log(f"benchmark {mode} {attempt}/{count}")
            cmd = ["docker", "run", "--rm", "--user", str(os.getuid()), "--entrypoint", "/opt/venv/bin/python",
                   "-v", f"{bench_dir}:/bench:ro", "-v", f"{raw}:/out", args.image, "/bench/m3_2000.py",
                   *([flag] if flag else []), "--out", f"/out/{name}"]
            done = subprocess.run(cmd, capture_output=True)
            (raw / f"{mode}-{attempt}.log").write_bytes(done.stdout + done.stderr)
            if done.returncode or not (raw / name).exists():
                failures += 1
                log(f"  failed (exit {done.returncode})")
                continue
            result = json.loads((raw / name).read_text())
            if result["validity"] != "valid" or result["clusters"] != 8 or result["elapsed_s"] > 600:
                failures += 1
                log(f"  rejected: validity={result['validity']} clusters={result['clusters']} elapsed={result['elapsed_s']}")
                continue
            runs[mode].append(result)
            log(f"  total {result['elapsed_s']} s, solve {result['stage_s']['solve']} s, {result['trucks']} trucks")

    def stats(values):
        return {"median": round(statistics.median(values), 3), "min": min(values), "max": max(values)} if values else None

    summary = {mode: {"runs": len(rs), "budget": rs[0]["budget"] if rs else None,
                      "total_s": stats([r["elapsed_s"] for r in rs]),
                      "solve_s": stats([r["stage_s"]["solve"] for r in rs]),
                      "trucks": sorted({r["trucks"] for r in rs})}
               for mode, rs in runs.items()}
    summary["failures"] = failures
    summary["ok"] = failures == 0 and len(runs["comparable"]) == args.comparable and len(runs["default_budget"]) == args.default_budget
    return summary


# --- 3. recovery -------------------------------------------------------------------------------
class Api:
    def __init__(self, port: int):
        self.base = f"http://127.0.0.1:{port}"

    def call(self, path, body=None, expect=(200, 201, 202), raw=False, timeout=60):
        headers = {"content-type": "application/json", "x-run-key": RUN_KEY, "x-scenario-key": SCENARIO_KEY}
        if body is not None:
            headers["idempotency-key"] = str(uuid.uuid4())
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method="POST" if data else "GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                status, payload = response.status, response.read()
        except urllib.error.HTTPError as error:
            status, payload = error.code, error.read()
        if status not in expect:
            raise RuntimeError(f"{path}: HTTP {status}: {payload[:300]!r}")
        return payload if raw else json.loads(payload)

    def healthy(self, seconds=240):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                health = self.call("/api/health", timeout=5)
                if health.get("worker", {}).get("connected"):
                    return health
            except Exception:
                pass
            time.sleep(2)
        raise RuntimeError("container never reported a connected worker")

    def run(self, run_id):
        return self.call(f"/api/v1/runs/{run_id}")

    def wait(self, run_id, states=("succeeded", "failed", "cancelled", "interrupted"), seconds=900):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                detail = self.run(run_id)
                if detail["status"] in states:
                    return detail
            except Exception:
                pass  # the container may be restarting
            time.sleep(1)
        raise RuntimeError(f"run {run_id} never reached {states}")

    def fingerprint(self, run_id):
        detail = self.run(run_id)
        export = self.call(f"/api/v1/runs/{run_id}/export?format=json", raw=True)
        loads = self.call(f"/api/v1/runs/{run_id}/export?format=csv&table=loads", raw=True)
        return {"status": detail["status"], "attempt": detail.get("attempt"),
                "summary_sha256": hashlib.sha256(json.dumps(detail.get("summary"), sort_keys=True).encode()).hexdigest(),
                "export_json_sha256": hashlib.sha256(export).hexdigest(),
                "loads_csv_sha256": hashlib.sha256(loads).hexdigest()}


def start(name: str, volume: str, port: int):
    sh("docker", "run", "-d", "--name", name, "--restart", "unless-stopped", "-p", f"127.0.0.1:{port}:3000",
       "-e", f"RUN_KEY={RUN_KEY}", "-e", f"SCENARIO_KEY={SCENARIO_KEY}", "-e", "LEASE_MS=15000", "-e", "WORKER_HEARTBEAT_SECONDS=3",
       "-v", f"{volume}:/app/data", args.image)
    return Api(port)


# Twelve stops around Memphis (as in smoke_import.py), small enough that oversize stops split.
ORDERS = ["order_id,customer_id,line_id,order_date,location_id,location_label,address,latitude,longitude,"
          "product,ordered_pieces,net_value_per_piece,linear_feet_per_piece"]
for i in range(12):
    lat, lon = 35.15 + (i % 4) * 0.35, -90.05 + (i // 4) * 0.45
    for j, sku in enumerate(("SKU-A", "SKU-B")):
        ORDERS.append(f"O-{i},C-{i},L-{i}-{j},2026-09-{10 + i},LOC-{i},Customer {i},,{lat:.4f},{lon:.4f},{sku},{4 + i % 3},{12 + j}.50,{4 + j}.25")
IMPORT = {"name": "Target check", "depot": {"id": "depot", "label": "Memphis DC", "lat": 35.1495, "lon": -90.049},
          "ordersCsv": "\n".join(ORDERS) + "\n", "inventoryCsv": "product,available_pieces\nSKU-A,200\nSKU-B,30\n"}
META = {"timezone": "America/Chicago", "planningDate": "2026-09-30", "browserId": "target-check"}


def scenario_run(api: Api, version_id: str, seconds: float) -> str:
    """An imported-scenario run whose solve takes about `seconds` per cluster (two clusters)."""
    settings = {"k": 2, "solver_time_limit_s": seconds}
    return api.call("/api/v1/scenarios/runs", {"versionId": version_id, "settings": settings})["id"]


ACTIVE = ("claimed", "running", "succeeded", "failed", "cancelled", "interrupted")


def started(api: Api, run_id: str) -> None:
    if api.wait(run_id, states=ACTIVE, seconds=120)["status"] not in ("claimed", "running"):
        raise RuntimeError(f"run {run_id} finished before it could be interrupted")


def worker_pids(name: str) -> list[str]:
    # The supervisor's command line is `/opt/venv/bin/python /opt/venv/bin/fillrate-optimizer`; skip this shell itself.
    script = 'for p in /proc/[0-9]*; do tr "\\0" " " < $p/cmdline 2>/dev/null | grep -q "^/opt/venv/bin/python[^ ]* /opt/venv/bin/fillrate-optimizer" && echo ${p#/proc/}; done; true'
    return sh("docker", "exec", name, "sh", "-c", script).split()


def recovery() -> dict:
    name, volume = tag, f"{tag}-data"
    restored_name, restored_volume = f"{tag}-restored", f"{tag}-restored-data"
    report: dict = {}
    try:
        api = start(name, volume, args.port)
        report["boot"] = api.healthy()
        log("recovery container healthy")

        # Persistence: a saved scenario with a validated run, plus a synthetic run, survive a restart.
        saved = api.call("/api/v1/imports/commit", {**IMPORT, "author": "target-check", "metadata": META})
        version_id = saved["versionId"]
        imported = scenario_run(api, version_id, 2)
        synthetic = api.call("/api/v1/runs", {"example": "m1"})["id"]
        for rid in (imported, synthetic):
            detail = api.wait(rid)
            assert detail["status"] == "succeeded" and detail["summary"]["validity"] == "valid", (rid, detail["status"])
        before = {"scenario": api.call(f"/api/v1/scenarios/{saved['scenarioId']}"),
                  "runs": {rid: api.fingerprint(rid) for rid in (imported, synthetic)}}
        t0 = time.monotonic()
        sh("docker", "restart", name)
        api.healthy()
        restart_s = round(time.monotonic() - t0, 1)
        after = {"scenario": api.call(f"/api/v1/scenarios/{saved['scenarioId']}"),
                 "runs": {rid: api.fingerprint(rid) for rid in (imported, synthetic)}}
        report["persistence"] = {"ok": before == after, "restart_to_worker_s": restart_s, "runs": after["runs"],
                                 "volume": volume, "data_dir": "/app/data"}
        log(f"persistence: {'ok' if before == after else 'MISMATCH'} (restart {restart_s} s)")

        # Worker loss: SIGKILL the supervisor while it solves. The entrypoint exits, the restart policy
        # brings the container back, the lease expires and attempt 2 runs to a valid result.
        victim = scenario_run(api, version_id, 20)
        started(api, victim)
        time.sleep(3)
        pids = worker_pids(name)
        killed_at = time.monotonic()
        sh("docker", "exec", name, "sh", "-c", f"kill -9 {' '.join(pids)}")
        log(f"worker loss: killed {pids} during run {victim}")
        detail = api.wait(victim, seconds=600)
        recovered_s = round(time.monotonic() - killed_at, 1)
        restarts = int(sh("docker", "inspect", name, "--format", "{{.RestartCount}}").strip())
        attempts = detail.get("attempts", [])
        # Checkpoints are kept per attempt; the result stages must exist once, and the retry reuses cached stages.
        stages = [st["stage"] for st in detail["stages"]]
        reused = sum(1 for st in detail["stages"] if st["reused_from"])
        save("worker-loss-run.json", detail)
        ok = (detail["status"] == "succeeded" and (detail["summary"] or {}).get("validity") == "valid" and len(attempts) >= 2
              and attempts[0]["reason"] == "lease_expired" and detail["attempt"] == len(attempts)
              and all(stages.count(st) == 1 for st in ("solve", "validation", "summary")) and reused > 0)
        report["worker_loss"] = {"ok": ok, "killed_pids": pids, "container_restarts": restarts,
                                 "status": detail["status"], "validity": (detail["summary"] or {}).get("validity"),
                                 "stages": stages, "reused_stages": reused,
                                 "attempts": attempts, "kill_to_result_s": recovered_s}
        log(f"worker loss: {'ok' if ok else 'FAILED'}: {detail['status']} after {len(attempts)} attempts in {recovered_s} s")

        # Cancellation: one running and one queued run, then new work still completes.
        running = scenario_run(api, version_id, 30)
        started(api, running)
        queued = scenario_run(api, version_id, 2)
        queued_state = api.run(queued)["status"]
        t0 = time.monotonic()
        api.call(f"/api/v1/runs/{queued}/cancel", {})
        api.call(f"/api/v1/runs/{running}/cancel", {})
        a = api.wait(queued, seconds=60)
        b = api.wait(running, seconds=120)
        cancel_s = round(time.monotonic() - t0, 1)
        follow = api.call("/api/v1/runs", {"example": "m1", "settings": {"solver_seed": 7}})["id"]
        c = api.wait(follow, seconds=300)
        ok = a["status"] == b["status"] == "cancelled" and c["status"] == "succeeded" and queued_state == "queued"
        report["cancellation"] = {"ok": ok, "queued_before_cancel": queued_state, "queued": a["status"], "running": b["status"],
                                  "running_cancel_s": cancel_s, "follow_up": c["status"]}
        log(f"cancellation: {'ok' if ok else 'FAILED'} (running run cancelled in {cancel_s} s)")

        # Backup/restore: online backup of the live container, restore into a fresh volume, compare.
        backups = out / "backups"
        backup_log = sh(str(ROOT / "deploy/backup.sh"), name, str(backups))
        save("backup.log", backup_log)
        file = sorted(backups.glob("fillrate-*.sqlite"))[-1]
        sh("docker", "volume", "create", restored_volume)
        sh("docker", "run", "--rm", "-i", "--entrypoint", "sh", "-v", f"{restored_volume}:/app/data", args.image,
           "-c", "cat > /app/data/fillrate.sqlite", input=file.read_bytes())
        restored = start(restored_name, restored_volume, args.port + 1)
        restored.healthy()
        ids = [imported, synthetic, victim]
        live = {rid: api.fingerprint(rid) for rid in ids}
        copy = {rid: restored.fingerprint(rid) for rid in ids}
        same_scenario = api.call(f"/api/v1/scenarios/{saved['scenarioId']}") == restored.call(f"/api/v1/scenarios/{saved['scenarioId']}")
        ok = live == copy and same_scenario
        report["backup_restore"] = {"ok": ok, "file": file.name, "bytes": file.stat().st_size,
                                    "sha256": hashlib.sha256(file.read_bytes()).hexdigest(), "log": backup_log.strip().splitlines(),
                                    "runs_compared": len(ids), "scenario_identical": same_scenario}
        log(f"backup/restore: {'ok' if ok else 'MISMATCH'} ({file.name})")
        save("container.log", sh("docker", "logs", name, check=False))
    except Exception as error:  # record the failure; the summary marks recovery not ok
        report["error"] = repr(error)
        log(f"recovery error: {error!r}")
        save("container.log", sh("docker", "logs", name, check=False))
    finally:
        for container in (name, restored_name):
            sh("docker", "rm", "-f", container, check=False)
        for vol in (volume, restored_volume):
            sh("docker", "volume", "rm", vol, check=False)
    report["ok"] = "error" not in report and all(report.get(k, {}).get("ok") for k in ("persistence", "worker_loss", "cancellation", "backup_restore"))
    return report


results["metadata"] = metadata()
log(f"{args.label}: {results['metadata']['machine']}, {results['metadata']['cpus']} CPUs, {results['metadata']['mem_total_mb']} MB; image {results['metadata']['image_id'][:19]}")
if not args.skip_bench:
    results["benchmarks"] = benchmarks()
if not args.skip_recovery:
    results["recovery"] = recovery()
results["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
save("summary.json", results)

md = [f"# Target check: {args.label}", "", f"- Image: `{args.image}` (revision `{results['metadata']['image_revision']}`)",
      f"- Host: {results['metadata']['uname']}", f"- CPUs {results['metadata']['cpus']} ({results['metadata']['cpu_model']}), memory {results['metadata']['mem_total_mb']} MB, Docker {results['metadata']['docker']}",
      f"- {results['started']} → {results['finished']}", ""]
if "benchmarks" in results:
    b = results["benchmarks"]
    md += ["| Probe | Runs | Total s (median / min / max) | Solve s (median / min / max) | Trucks |", "| --- | --- | --- | --- | --- |"]
    for mode in ("comparable", "default_budget"):
        s = b[mode]
        if s["total_s"]:
            md.append(f"| {mode} ({s['budget']}) | {s['runs']} | {s['total_s']['median']} / {s['total_s']['min']} / {s['total_s']['max']} | "
                      f"{s['solve_s']['median']} / {s['solve_s']['min']} / {s['solve_s']['max']} | {', '.join(map(str, s['trucks']))} |")
    md += ["", f"Benchmark failures: {b['failures']}", ""]
if "recovery" in results:
    r = results["recovery"]
    for key in ("persistence", "worker_loss", "cancellation", "backup_restore"):
        if key in r:
            detail = {k: v for k, v in r[key].items() if k not in ("runs", "attempts", "log")}
            md.append(f"- **{key}**: {'ok' if r[key]['ok'] else 'FAILED'} {json.dumps(detail)}")
    if "error" in r:
        md.append(f"- **error**: {r['error']}")
save("summary.md", "\n".join(md) + "\n")
print("\n".join(md))
ok = results.get("benchmarks", {}).get("ok", True) and results.get("recovery", {}).get("ok", True)
sys.exit(0 if ok else 1)
