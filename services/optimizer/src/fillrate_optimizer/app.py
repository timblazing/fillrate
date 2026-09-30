"""Internal FastAPI service, bound to localhost. Browsers reach it only through Next.js (§2)."""

from __future__ import annotations

from fastapi import FastAPI

from .capabilities import Capabilities, capabilities

app = FastAPI(title="Fillrate optimizer", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/capabilities")
def get_capabilities() -> Capabilities:
    return capabilities()


def main() -> None:
    import os

    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=int(os.environ.get("OPTIMIZER_PORT", "8000")),
    )
