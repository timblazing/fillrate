"""Raw travel matrices for a lab instance. Node 0 is the depot, then clients in input order.

Planar: rounded euclidean distance in abstract units, and the same number of abstract time units.
Geographic: haversine × circuity in integer meters (the pipeline's estimated travel) and seconds at
a constant speed. Both matrices are what the builder gives PyVRP and what the validator re-reads.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..canonical import content_hash
from ..travel import distance_matrix_m
from .schema import LabInstance


@dataclass(frozen=True)
class LabMatrices:
    distance: np.ndarray  # int64, (n + 1) × (n + 1)
    duration: np.ndarray
    distance_unit: str
    duration_unit: str

    def identity(self) -> str:
        return content_hash(
            {
                "distance": self.distance.tolist(),
                "duration": self.duration.tolist(),
                "distance_unit": self.distance_unit,
                "duration_unit": self.duration_unit,
            }
        )


def node_points(instance: LabInstance) -> np.ndarray:
    """(n + 1) × 2 coordinates: [x, y] for planar, [lat, lon] for geographic."""
    places = [instance.depot, *instance.clients]
    if instance.coordinates == "planar":
        return np.array([[p.x, p.y] for p in places], dtype=float)
    return np.array([[p.lat, p.lon] for p in places], dtype=float)


def lab_matrices(instance: LabInstance) -> LabMatrices:
    points = node_points(instance)
    if instance.coordinates == "planar":
        delta = points[:, None, :] - points[None, :, :]
        distance = np.rint(np.hypot(delta[..., 0], delta[..., 1])).astype(np.int64)
        return LabMatrices(distance, distance.copy(), "planar units", "planar time units")
    distance = distance_matrix_m(points, instance.travel.circuity)
    duration = np.rint(distance / instance.travel.speed_m_per_s).astype(np.int64)
    return LabMatrices(distance, duration, "meters", "seconds")
