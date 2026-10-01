"""Worker supervisor (spec §2, §9): claims durable jobs from the Next.js loopback
transport and runs each pipeline in an isolated child process.

The supervisor never opens SQLite. It heartbeats while the child works; when a
heartbeat reports a cancellation request, it kills the child (stopping solver
CPU work) and then acknowledges with a `cancelled` event. If the lease is lost
(stale), it kills the child and abandons the job. If the child crashes, the
supervisor stops heartbeating so the lease expires and the job is retried.
"""

from __future__ import annotations

import json
import logging
import multiprocessing as mp
import os
import queue
import signal
import socket
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("fillrate.worker")


@dataclass
class Config:
    base_url: str
    token: str
    worker_id: str
    poll_s: float = 2.0
    heartbeat_s: float = 10.0
    run_wall_limit_s: float = 600.0

    @classmethod
    def from_env(cls) -> Config:
        env = os.environ
        return cls(
            base_url=env.get("FILLRATE_INTERNAL_URL", "http://127.0.0.1:3100"),
            token=read_token(),
            worker_id=env.get("WORKER_ID", f"{socket.gethostname()}-{os.getpid()}"),
            poll_s=float(env.get("WORKER_POLL_SECONDS", 2)),
            heartbeat_s=float(env.get("WORKER_HEARTBEAT_SECONDS", 10)),
            run_wall_limit_s=float(env.get("RUN_WALL_LIMIT_SECONDS", 600)),
        )


def read_token(wait_s: float = 60) -> str:
    if token := os.environ.get("WORKER_TOKEN"):
        return token
    data_dir = os.environ.get("DATA_DIR")
    path = (
        Path(data_dir) / "worker.token"
        if data_dir
        else Path(__file__).resolve().parents[4] / "data/worker.token"
    )
    deadline = time.monotonic() + wait_s
    while not path.exists():  # the web process creates it on first start
        if time.monotonic() > deadline:
            raise RuntimeError(f"no WORKER_TOKEN and no token file at {path}")
        time.sleep(0.5)
    return path.read_text().strip()


class Stale(Exception):
    """The lease is no longer ours (HTTP 409)."""


class Transport:
    def __init__(self, config: Config):
        self.config = config

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            self.config.base_url + path,
            data=json.dumps(body, allow_nan=False).encode(),
            headers={
                "authorization": f"Bearer {self.config.token}",
                "content-type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:500]
            if error.code == 409:
                raise Stale(detail) from error
            raise RuntimeError(f"{path} → HTTP {error.code}: {detail}") from error


def watch_parent(parent: int) -> None:
    """Exit if the supervisor dies (e.g. SIGKILL), so orphaned solves don't keep burning CPU."""

    def watch() -> None:
        while os.getppid() == parent:
            time.sleep(1)
        os._exit(1)

    threading.Thread(target=watch, daemon=True).start()


def child_main(
    scenario: dict,
    settings: dict,
    execution_id: str,
    out: mp.Queue,
    config: Config | None = None,
    lease: dict | None = None,
) -> None:
    """Runs in a separate process; reports progress, result, or a permanent error."""
    from .model import RunSettings, ScenarioDocument
    from .pipeline import Limits, PipelineError, run_pipeline

    watch_parent(os.getppid())

    transport = Transport(config) if config else None

    def rpc(path, **body):
        return transport.post("/internal/worker/" + path, {"lease": lease, **body})

    try:
        output = run_pipeline(
            ScenarioDocument.model_validate(scenario),
            RunSettings.model_validate(settings),
            limits=Limits.from_env(),
            progress=lambda stage, detail: out.put(("progress", {"stage": stage, **detail})),
            execution_id=execution_id,
            cache=(lambda identity: rpc("cache", input_hash=identity)["artifact"])
            if transport
            else None,
            checkpoint=(
                lambda a: rpc("checkpoint", artifact={"manifest": a.manifest, "payload": a.payload})
            )
            if transport
            else None,
            cluster_task=(
                lambda action, cid, identity, result: rpc(
                    "cluster", action=action, cluster_id=cid, input_hash=identity, result=result
                )
            )
            if transport
            else None,
        )
        artifacts = (
            []
            if transport
            else [{"manifest": a.manifest, "payload": a.payload} for a in output.artifacts]
        )
        out.put(
            (
                "result",
                {
                    "artifacts": artifacts,
                    "summary": {
                        "validity": output.summary.validity,
                        "coverage": output.summary.coverage,
                        "trucks": output.summary.totals.trucks,
                    },
                },
            )
        )
    except PipelineError as error:
        out.put(("error", {"code": error.code, "message": str(error)}))
    except Exception as error:  # pydantic validation and anything unexpected
        out.put(("error", {"code": type(error).__name__, "message": str(error)[:2000]}))


class Supervisor:
    def __init__(self, config: Config, transport: Transport | None = None):
        self.config = config
        self.transport = transport or Transport(config)
        self.stopping = threading.Event()
        self.ctx = mp.get_context("spawn")

    def run_forever(self) -> None:
        log.info("worker %s polling %s", self.config.worker_id, self.config.base_url)
        while not self.stopping.is_set():
            try:
                if not self.run_once():
                    self.stopping.wait(self.config.poll_s)
            except urllib.error.URLError as error:
                log.warning("web transport unavailable (%s); retrying", error.reason)
                self.stopping.wait(self.config.poll_s)
            except Exception:
                log.exception("worker loop error")
                self.stopping.wait(self.config.poll_s)

    def run_once(self) -> bool:
        claim = self.transport.post("/internal/worker/claim", {"worker_id": self.config.worker_id})
        job = claim.get("job")
        if not job:
            return False
        self.execute(job)
        return True

    def execute(self, job: dict[str, Any]) -> str:
        lease = job["lease"]
        log.info("run %s attempt %s claimed", job["run_id"], lease["attempt"])
        sequence = 0

        def send(kind: str, payload: dict, artifacts: list | None = None) -> None:
            # The sequence advances only when the server recorded the event.
            nonlocal sequence
            body: dict[str, Any] = {
                "event": {
                    "lease": lease,
                    "sequence": sequence + 1,
                    "kind": kind,
                    "payload": payload,
                }
            }
            if artifacts:
                body["artifacts"] = artifacts
            self.transport.post("/internal/worker/events", body)
            sequence += 1

        out: mp.Queue = self.ctx.Queue()
        child = self.ctx.Process(
            target=child_main,
            args=(
                job["scenario"]["document"],
                job["settings"]["document"],
                lease["lease_token"],  # execution ID: unique per attempt
                out,
                self.config,
                lease,
            ),
            daemon=True,
        )
        started = time.monotonic()
        next_beat = 0.0
        try:
            self.transport.post("/internal/worker/heartbeat", {"lease": lease})
            child.start()
            while True:
                now = time.monotonic()
                if now >= next_beat:
                    beat = self.transport.post("/internal/worker/heartbeat", {"lease": lease})
                    if beat.get("cancel_requested"):
                        kill(child)
                        send("cancelled", {"reason": "cancel_requested"})
                        log.info("run %s cancelled; solver process killed", job["run_id"])
                        return "cancelled"
                    next_beat = now + self.config.heartbeat_s
                if now - started > self.config.run_wall_limit_s + 30:
                    kill(child)
                    send(
                        "failed",
                        {
                            "code": "run_wall_limit",
                            "message": "Run exceeded RUN_WALL_LIMIT_SECONDS.",
                        },
                    )
                    return "failed"
                try:
                    kind, payload = out.get(timeout=0.25)
                except queue.Empty:
                    if not child.is_alive():
                        # Crashed without reporting: stop heartbeating so the lease expires and
                        # the job is retried with a fresh attempt (spec §9 bounded retry).
                        log.error(
                            "run %s child exited %s without a result", job["run_id"], child.exitcode
                        )
                        return "abandoned"
                    continue
                if kind == "progress":
                    send("progress", payload)
                elif kind == "result":
                    child.join(timeout=10)
                    try:
                        send("succeeded", payload["summary"], payload["artifacts"])
                    except Stale as error:
                        if "cancel_requested" not in str(error):
                            raise
                        send("cancelled", {"reason": "cancel_requested"})
                        return "cancelled"
                    log.info("run %s succeeded", job["run_id"])
                    return "succeeded"
                elif kind == "error":
                    send("failed", payload)  # invalid input: permanent, not retried
                    log.info("run %s failed: %s", job["run_id"], payload.get("code"))
                    return "failed"
        except Stale:
            kill(child)
            log.warning("run %s lease lost; abandoned", job["run_id"])
            return "stale"
        finally:
            kill(child)
            out.close()


def kill(child: mp.process.BaseProcess) -> None:
    if child.is_alive():
        child.kill()
    if child.pid is not None:
        child.join(timeout=5)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    supervisor = Supervisor(Config.from_env())
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: supervisor.stopping.set())
    supervisor.run_forever()


if __name__ == "__main__":
    main()
