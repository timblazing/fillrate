"""Private FastAPI service, bound to localhost. Browsers reach it only through Next.js."""

from __future__ import annotations

import os

from fastapi import FastAPI

from .capabilities import Capabilities, capabilities
from .solve import router

app = FastAPI(title="Fillrate optimizer", version="0.1.0")
app.include_router(router)


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
