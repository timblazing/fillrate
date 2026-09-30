"""Internal FastAPI service, bound to localhost. Browsers reach it only through Next.js (§2)."""

from __future__ import annotations

import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .capabilities import Capabilities, capabilities


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


def main() -> None:
    import logging

    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("OPTIMIZER_PORT", "8000")),
    )
