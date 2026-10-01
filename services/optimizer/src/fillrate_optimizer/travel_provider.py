"""Static directed travel snapshots for M6 (spec §7).

Raw provider values stay in their declared units. Conversion to integer meters
and seconds happens once, on request, with -1 representing a missing edge.
Snapshots contain no provider endpoint or credentials and can be replayed offline.
The web/worker selection and durable matrix cache are a subsequent M6 increment.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, Literal, Protocol

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .canonical import content_hash
from .travel import METERS_PER_MILE, haversine_m

MAX_MATRIX_NODES = 1001
MAX_TRAVEL_VALUE = 2**40
Value = Annotated[float, Field(strict=True, ge=0, le=MAX_TRAVEL_VALUE, allow_inf_nan=False)]
Text = Annotated[str, Field(min_length=1, max_length=200)]


class SnapshotBindingError(ValueError):
    """A snapshot does not describe the requested nodes: absent, or at different coordinates.

    `missing` and `moved` list node IDs; a moved node means its coordinates were edited after
    the snapshot was taken, so the recorded legs no longer describe it (spec §7).
    """

    def __init__(self, missing: list[str], moved: list[str], detail: str | None = None):
        self.missing, self.moved = missing, moved
        if detail:
            super().__init__(detail)
            return
        parts = []
        if missing:
            parts.append("not in the snapshot: " + ", ".join(missing[:5]))
        if moved:
            parts.append("coordinates changed since the snapshot: " + ", ".join(moved[:5]))
        super().__init__("matrix has no matching coordinates for node(s) " + "; ".join(parts))


class TravelNode(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: Text
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    lon: Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]


class TravelSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    nodes: Annotated[list[TravelNode], Field(min_length=1, max_length=MAX_MATRIX_NODES)]
    provider: Literal["haversine", "imported", "valhalla"]
    provider_version: Text
    dataset_revision: Text
    profile: Text
    # For roads, include all effective costing defaults and the graph/config identity here.
    options: dict[str, Any]
    distance_units: Literal["meters", "kilometers", "miles"]
    duration_units: Literal["seconds", "minutes"]
    distances: list[list[Value | None]]
    durations: list[list[Value | None]]
    # Provider warnings are evidence, not a request to change costing or use a fallback.
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    conversion: Literal["nearest-integer-ties-to-even/v1"] = "nearest-integer-ties-to-even/v1"

    @model_validator(mode="after")
    def validate_matrix(self) -> TravelSnapshot:
        n = len(self.nodes)
        if len({node.id for node in self.nodes}) != n:
            raise ValueError("matrix node IDs must be unique")
        for matrix in (self.distances, self.durations):
            if len(matrix) != n or any(len(row) != n for row in matrix):
                raise ValueError("matrix dimensions must match ordered nodes")
        for i in range(n):
            for j in range(n):
                d, t = self.distances[i][j], self.durations[i][j]
                if (d is None) != (t is None):
                    raise ValueError("distance and duration reachability must agree")
                if i == j and (d != 0 or t != 0):
                    raise ValueError("matrix diagonal must be reachable with zero distance/time")
        # Validate JSON metadata too: NaN, non-JSON objects and unsafe integers cannot be hashed.
        content_hash(self.options)
        content_hash(self.warnings)
        return self

    @property
    def identity(self) -> str:
        return content_hash(self.model_dump(mode="json"))

    def effective(self, nodes: list[TravelNode] | None = None) -> tuple[np.ndarray, np.ndarray]:
        """Reorder/subset by IDs, rejecting coordinates changed since the snapshot."""
        requested = self.nodes if nodes is None else nodes
        if len({node.id for node in requested}) != len(requested):
            raise ValueError("requested node IDs must be unique")
        positions = {node.id: i for i, node in enumerate(self.nodes)}
        missing = sorted(node.id for node in requested if node.id not in positions)
        moved = sorted(
            node.id
            for node in requested
            if node.id in positions and self.nodes[positions[node.id]] != node
        )
        if missing or moved:
            raise SnapshotBindingError(missing, moved)
        indices = [positions[node.id] for node in requested]
        scale = {"meters": 1, "kilometers": 1000, "miles": METERS_PER_MILE}[self.distance_units]
        time_scale = 1 if self.duration_units == "seconds" else 60

        def convert(matrix, factor):
            values = [
                [-1 if matrix[i][j] is None else round(matrix[i][j] * factor) for j in indices]
                for i in indices
            ]
            return np.array(values, dtype=np.int64).reshape((len(indices), len(indices)))

        return convert(self.distances, scale), convert(self.durations, time_scale)


Progress = Callable[[int, int], None]
CheckCancelled = Callable[[], None]


class TravelProvider(Protocol):
    def matrix(
        self,
        nodes: list[TravelNode],
        *,
        progress: Progress | None = None,
        check_cancelled: CheckCancelled | None = None,
    ) -> TravelSnapshot: ...


def stop_nodes(
    depot_id: str, depot: tuple[float, float], stops: dict[str, tuple[float, float]]
) -> list[TravelNode]:
    """Matrix nodes for a run: the depot first, then stops sorted by ID.

    Depot and stop IDs share one node namespace, so a collision cannot be bound to a snapshot.
    """
    if depot_id in stops:
        raise SnapshotBindingError([], [], f"depot ID {depot_id!r} is also a location ID")
    return [TravelNode(id=depot_id, lat=depot[0], lon=depot[1])] + [
        TravelNode(id=stop_id, lat=lat, lon=lon) for stop_id, (lat, lon) in sorted(stops.items())
    ]


def validate_nodes(nodes: list[TravelNode]) -> None:
    if not 1 <= len(nodes) <= MAX_MATRIX_NODES:
        raise ValueError(f"matrix requires 1–{MAX_MATRIX_NODES} nodes")
    if len({node.id for node in nodes}) != len(nodes):
        raise ValueError("matrix node IDs must be unique")


class EstimatedTravel:
    def __init__(self, circuity: float = 1.2, speed_m_per_s: float = 11.176):
        if not np.isfinite(circuity) or not 1 <= circuity <= 5:
            raise ValueError("circuity must be finite and between 1 and 5")
        if not np.isfinite(speed_m_per_s) or speed_m_per_s <= 0:
            raise ValueError("estimated speed must be finite and positive")
        self.circuity = circuity
        self.speed = speed_m_per_s

    def matrix(self, nodes, *, progress=None, check_cancelled=None) -> TravelSnapshot:
        validate_nodes(nodes)
        if check_cancelled:
            check_cancelled()
        distance = haversine_m(np.array([(node.lat, node.lon) for node in nodes])) * self.circuity
        snapshot = TravelSnapshot(
            nodes=nodes,
            provider="haversine",
            provider_version="haversine/1",
            dataset_revision="earth-radius-6371008.8m",
            profile="estimated",
            options={"circuity": self.circuity, "speed_m_per_s": self.speed},
            distance_units="meters",
            duration_units="seconds",
            distances=distance.tolist(),
            durations=(distance / self.speed).tolist(),
        )
        if check_cancelled:
            check_cancelled()
        if progress:
            progress(1, 1)
        return snapshot


class ImportedTravel:
    def __init__(self, document: dict[str, Any]):
        self.snapshot = TravelSnapshot.model_validate(document)

    def matrix(self, nodes, *, progress=None, check_cancelled=None) -> TravelSnapshot:
        validate_nodes(nodes)
        if check_cancelled:
            check_cancelled()
        self.snapshot.effective(
            nodes
        )  # Validate IDs and coordinate binding before returning raw data.
        positions = {node.id: i for i, node in enumerate(self.snapshot.nodes)}
        indices = [positions[node.id] for node in nodes]
        document = self.snapshot.model_dump(mode="json")
        document["nodes"] = [node.model_dump(mode="json") for node in nodes]
        for field in ("distances", "durations"):
            document[field] = [[document[field][i][j] for j in indices] for i in indices]
        result = TravelSnapshot.model_validate(document)
        if progress:
            progress(1, 1)
        return result
