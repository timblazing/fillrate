"""Durable Valhalla travel-snapshot job (M6): one directed matrix for a scenario version.

The nodes are the depot plus every stop with demand, in the exact IDs and order the pipeline
binds, so the stored snapshot attaches to that version with no missing or moved nodes. Costing and
every option come from deployment configuration only. A failed or cancelled build stores nothing and
never falls back to estimated travel.
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable
from typing import Any

from .model import ScenarioDocument
from .travel_provider import SnapshotBindingError, TravelNode, stop_nodes
from .valhalla import (
    ProviderCancelled,
    ProviderError,
    TransientProviderError,
    ValhallaConfig,
    ValhallaTravel,
)

PROGRESS_INTERVAL_S = 1.0


class TravelJobError(Exception):
    """A permanent job failure with a stable code (never retried)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def demand_nodes(scenario: ScenarioDocument) -> list[TravelNode]:
    """Depot first, then every located stop with positive ordered pieces, sorted by ID."""
    locations = {location.id: location for location in scenario.locations}
    stops: dict[str, tuple[float, float]] = {}
    for order in scenario.orders:
        location = locations.get(order.location_id)
        if (
            location is None
            or location.lat is None
            or location.lon is None
            or location.coordinate_source == "unresolved"
        ):
            continue
        if any(line.ordered_pieces > 0 for line in order.lines):
            stops[location.id] = (location.lat, location.lon)
    depot = scenario.depot
    try:
        return stop_nodes(depot.id, (depot.lat, depot.lon), stops)
    except SnapshotBindingError as error:
        raise TravelJobError("travel_snapshot_nodes", str(error)) from error


def build_snapshot(
    scenario: dict[str, Any],
    *,
    store: Callable[[dict, str], Any],
    progress: Callable[[dict], None],
    check_cancelled: Callable[[], None] | None = None,
    transport: Callable | None = None,
    config: ValhallaConfig | None = None,
) -> dict:
    """Builds the matrix, hands it to `store(document, snapshot_id)` and returns the run summary."""
    if config is None:
        if not os.environ.get("VALHALLA_URL"):
            raise TravelJobError(
                "valhalla_not_configured", "Valhalla is not configured on this server."
            )
        try:
            config = ValhallaConfig.from_env()
        except ProviderError as error:
            raise TravelJobError("valhalla_config_invalid", str(error)) from error
    nodes = demand_nodes(ScenarioDocument.model_validate(scenario))
    last = {"at": 0.0, "total": 0}

    def on_progress(done: int, total: int) -> None:
        last["total"] = total
        now = time.monotonic()
        if done in (0, total) or now - last["at"] >= PROGRESS_INTERVAL_S:
            last["at"] = now
            progress({"stage": "travel_snapshot", "blocks_done": done, "blocks_total": total})

    travel = ValhallaTravel(config, **({"transport": transport} if transport else {}))
    try:
        snapshot = travel.matrix(nodes, progress=on_progress, check_cancelled=check_cancelled)
    except ProviderCancelled:
        raise
    except TransientProviderError as error:
        raise TravelJobError(
            "valhalla_unavailable", f"{error} after retries; try again later."
        ) from error
    except ProviderError as error:
        raise TravelJobError("valhalla_request_rejected", str(error)) from error
    except ValueError as error:
        raise TravelJobError("travel_snapshot_nodes", str(error)) from error
    identity = snapshot.identity
    store(snapshot.model_dump(mode="json"), identity)
    return {
        "kind": "travel_snapshot",
        "snapshot_id": identity,
        "node_count": len(nodes),
        "blocks": last["total"],
    }
