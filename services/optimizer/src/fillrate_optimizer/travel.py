"""Haversine × circuity travel matrices (spec §7).

Distances are integer meters, the unit every solver input uses. Legs longer
than the maximum leg distance are marked prohibited; the load builder omits
them from the PyVRP model (spec §3, "Maximum leg distance").
"""

from __future__ import annotations

import numpy as np

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_MILE = 1_609.344

DEFAULT_CIRCUITY = 1.2
ESTIMATED_SPEED_M_PER_S = 11.176
DEFAULT_MAX_LEG_M = round(500 * METERS_PER_MILE)


def miles_to_m(miles: float) -> int:
    return round(miles * METERS_PER_MILE)


def haversine_m(lat_lon: np.ndarray) -> np.ndarray:
    """Great-circle distances in meters for an (n, 2) array of [lat, lon] degrees."""
    rad = np.radians(np.asarray(lat_lon, dtype=float))
    lat = rad[:, 0][:, None]
    lon = rad[:, 1][:, None]
    dlat = lat.T - lat
    dlon = lon.T - lon
    a = np.sin(dlat / 2) ** 2 + np.cos(lat) * np.cos(lat.T) * np.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def distance_matrix_m(lat_lon: np.ndarray, circuity: float = DEFAULT_CIRCUITY) -> np.ndarray:
    """Haversine × circuity factor, rounded to integer meters."""
    if circuity < 1.0:
        raise ValueError("circuity factor must be at least 1.0")
    return np.rint(haversine_m(lat_lon) * circuity).astype(np.int64)


def prohibited_legs(distance: np.ndarray, max_leg_m: int) -> np.ndarray:
    """Boolean mask of legs longer than the limit. The diagonal is never prohibited."""
    mask = (distance < 0) | (distance > max_leg_m)
    np.fill_diagonal(mask, False)
    return mask


def reachable(matrix: np.ndarray, max_leg_m: int) -> set[int]:
    """Nodes reachable from node 0 over allowed directed legs (≥ 0 and ≤ the limit).

    Edges are directed: matrix[i][j] is the leg from i to j, and -1 is a missing edge.
    """
    allowed = (matrix >= 0) & (matrix <= max_leg_m)
    np.fill_diagonal(allowed, False)
    seen, frontier = {0}, [0]
    while frontier:
        node = frontier.pop()
        for nxt in np.nonzero(allowed[node])[0]:
            if int(nxt) not in seen:
                seen.add(int(nxt))
                frontier.append(int(nxt))
    return seen
