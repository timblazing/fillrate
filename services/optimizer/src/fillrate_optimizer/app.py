"""Internal FastAPI service, bound to localhost. Browsers reach it only through Next.js (§2)."""

from __future__ import annotations

import hmac
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Header, HTTPException

from .capabilities import Capabilities, capabilities
from .evaluate import EvaluateRequest, EvaluateResponse, EvaluationError, evaluate


@asynccontextmanager
async def lifespan(_: FastAPI):
    """With FILLRATE_WORKER=1 the worker supervisor runs alongside the service (spec §2)."""
    supervisor = None
    if os.environ.get("FILLRATE_WORKER") == "1":
        from .worker import Config, Supervisor

        supervisor = Supervisor(Config.from_env())
        threading.Thread(target=supervisor.run_forever, name="supervisor", daemon=True).start()
    yield
    if supervisor:
        supervisor.stopping.set()


app = FastAPI(title="Fillrate optimizer", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/capabilities")
def get_capabilities() -> Capabilities:
    return capabilities()


def internal_token() -> str | None:
    """The worker bearer token Next.js also holds: WORKER_TOKEN, else the token file the web
    process writes next to the database (the worker's own lookup, without waiting)."""
    if token := os.environ.get("WORKER_TOKEN"):
        return token
    data_dir = os.environ.get("DATA_DIR")
    path = (
        Path(data_dir) / "worker.token"
        if data_dir
        else Path(__file__).resolve().parents[4] / "data/worker.token"
    )
    return path.read_text().strip() if path.exists() else None


@app.post("/evaluate", responses={401: {}, 422: {}})
def post_evaluate(
    request: EvaluateRequest, authorization: Annotated[str | None, Header()] = None
) -> EvaluateResponse:
    """Manual plan evaluation (spec §10): bounded, synchronous CPU work in FastAPI's thread
    pool, never on the event loop. Only Next.js calls it, with the worker bearer token."""
    expected = internal_token()
    if not expected or not hmac.compare_digest(
        (authorization or "").encode(), f"Bearer {expected}".encode()
    ):
        raise HTTPException(401, {"code": "unauthorized", "message": "Worker token required."})
    try:
        return evaluate(request)
    except EvaluationError as error:
        raise HTTPException(422, {"code": error.code, "message": str(error)}) from error


def main() -> None:
    import logging

    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("OPTIMIZER_PORT", "8000")),
    )
