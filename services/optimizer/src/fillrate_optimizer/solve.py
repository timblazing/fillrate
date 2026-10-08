"""Direct solves: one request, one child process, one JSON result.

CPU work runs in a spawned child so it never blocks the event loop and can be killed. The
service runs one solve at a time; others wait on a lock. `cancel` kills the child, and the
wall-clock limit does the same.
"""

from __future__ import annotations

import asyncio
import json
import multiprocessing as mp
import os
import threading
import time
from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from .canonical import content_hash

# Stages whose payloads a replay bundle needs; they are returned with the summary.
REPLAY_STAGES = ("preflight", "allocation", "aggregation", "clustering")

router = APIRouter()
_ctx = mp.get_context("spawn")
_lock = asyncio.Lock()
_pending: set[str] = set()
_running: dict[str, mp.process.BaseProcess] = {}
_cancelled: set[str] = set()


class SolveRequest(BaseModel):
    kind: Literal["pipeline", "explorer"]
    solve_id: str
    scenario: dict[str, Any]
    settings: dict[str, Any]


def solve(kind: str, scenario: dict, settings: dict) -> dict[str, Any]:
    """The result a finished run persists. Raises PipelineError / ExplorerError on bad input."""
    from .model import ExplorerSettings, RunSettings, ScenarioDocument

    document = ScenarioDocument.model_validate(scenario)
    if kind == "explorer":
        from .explorer import run_explorer

        summary = run_explorer(
            document,
            ExplorerSettings.model_validate(settings),
            max_tasks=int(os.environ.get("MAX_SWEEP_RUNS", 25)),
        )
        payload = summary.model_dump(mode="json")
        return {"explorer": payload, "output_hash": content_hash(payload)}

    from .pipeline import Limits, run_pipeline

    output = run_pipeline(document, RunSettings.model_validate(settings), limits=Limits.from_env())
    return {
        "summary": output.summary.model_dump(mode="json"),
        "stages": [
            {
                "stage": a.stage,
                "output_hash": content_hash(a.payload),
                "payload": a.payload,
            }
            for a in output.artifacts
            if a.stage in REPLAY_STAGES
        ],
    }


def child_main(conn, parent: int, kind: str, scenario: dict, settings: dict) -> None:
    """Runs in the spawned process; sends ("result", json bytes) or ("error", {code, message})."""
    from .explorer import ExplorerError
    from .pipeline import PipelineError

    def watch() -> None:  # exit if the service dies, so a solve never outlives it
        while os.getppid() == parent:
            time.sleep(1)
        os._exit(1)

    threading.Thread(target=watch, daemon=True).start()
    try:
        message = ("result", json.dumps(solve(kind, scenario, settings), allow_nan=False).encode())
    except (PipelineError, ExplorerError) as error:
        message = ("error", {"code": error.code, "message": str(error)})
    except Exception as error:  # pydantic validation and anything unexpected
        message = ("error", {"code": type(error).__name__, "message": str(error)[:2000]})
    conn.send(message)
    conn.close()


def supervise(solve_id: str, request: SolveRequest, limit_s: float) -> tuple[str, Any]:
    """Blocking: runs the child and waits for its message, a cancel, a crash or the time limit."""
    parent_conn, child_conn = _ctx.Pipe(duplex=False)
    child = _ctx.Process(
        target=child_main,
        args=(child_conn, os.getpid(), request.kind, request.scenario, request.settings),
        daemon=True,
    )
    child.start()
    child_conn.close()
    _running[solve_id] = child
    deadline = time.monotonic() + limit_s
    try:
        while True:
            if parent_conn.poll(0.25):
                try:
                    return parent_conn.recv()
                except EOFError:
                    pass
            if solve_id in _cancelled:
                return "error", {"code": "cancelled", "message": "Cancelled."}
            if not child.is_alive():
                if parent_conn.poll(0):
                    continue
                return "error", {
                    "code": "solver_crashed",
                    "message": f"The solver process exited ({child.exitcode}) without a result.",
                }
            if time.monotonic() > deadline:
                return "error", {
                    "code": "run_wall_limit",
                    "message": "Run exceeded RUN_WALL_LIMIT_SECONDS.",
                }
    finally:
        _running.pop(solve_id, None)
        if child.is_alive():
            child.kill()
        child.join(timeout=5)
        parent_conn.close()


@router.post("/solve")
async def post_solve(request: SolveRequest) -> Response:
    solve_id = request.solve_id
    _pending.add(solve_id)
    try:
        async with _lock:
            if solve_id in _cancelled:
                return error_response("cancelled", "Cancelled.")
            limit = float(os.environ.get("RUN_WALL_LIMIT_SECONDS", 600)) + 30
            kind, payload = await asyncio.to_thread(supervise, solve_id, request, limit)
    finally:
        _pending.discard(solve_id)
        _cancelled.discard(solve_id)
    if kind == "result":
        return Response(content=payload, media_type="application/json")
    return error_response(payload["code"], payload["message"])


def error_response(code: str, message: str) -> JSONResponse:
    status = {"cancelled": 409, "run_wall_limit": 504, "solver_crashed": 500}.get(code, 422)
    return JSONResponse({"code": code, "message": message}, status_code=status)


@router.post("/cancel/{solve_id}")
def post_cancel(solve_id: str) -> dict[str, bool]:
    """Kills the solve's child, or marks a queued solve so it never starts."""
    if solve_id in _running:
        _cancelled.add(solve_id)
        _running[solve_id].kill()
        return {"cancelled": True}
    if solve_id in _pending:
        _cancelled.add(solve_id)
        return {"cancelled": True}
    return {"cancelled": False}
