"""Scenario-level time data for the time-window adapter (spec §5, M6)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .model import ScenarioDocument
from .timewin import VisitTime, elapsed_s
from .travel import haversine_m
from .travel_provider import ESTIMATED_SPEED_M_PER_S


@dataclass(frozen=True)
class TimeContext:
    timezone: str
    planning_date: str
    midnight_epoch_s: int
    depot_open_s: int
    horizon_end_s: int
    # Location defaults; every visit at a location inherits its window and service duration.
    locations: dict[str, VisitTime]


def time_context(scenario: ScenarioDocument) -> TimeContext | None:
    """None unless a time model exists and some location has a window or a service duration.
    Without it the solver model, the problem stage and the results stay exactly as before."""
    tm = scenario.time_model
    if tm is None:
        return None
    by_location: dict[str, VisitTime] = {}
    for loc in scenario.locations:
        if loc.window is None and loc.service_minutes is None:
            continue
        earliest = latest = None
        if loc.window:
            fold = loc.window.fold
            earliest = elapsed_s(tm.timezone, tm.planning_date, loc.window.earliest, fold)
            latest = elapsed_s(tm.timezone, tm.planning_date, loc.window.latest, fold)
        by_location[loc.id] = VisitTime((loc.service_minutes or 0) * 60, earliest, latest)
    if not by_location:
        return None
    return TimeContext(
        tm.timezone,
        tm.planning_date,
        tm.midnight_epoch_s,
        tm.depot_open_s,
        tm.horizon_end_s,
        by_location,
    )


def duration_leg_reader(raw_seconds, loc_ids, depot, stops, circuity):
    """`leg_s(a, b)` drive seconds by travel-node name ("depot" or a location ID), from the
    selected snapshot's duration matrix or, for estimated travel, the estimated provider's
    haversine x circuity / constant speed."""
    index = {"depot": 0, **{loc: i + 1 for i, loc in enumerate(loc_ids)}}
    if raw_seconds is not None:
        return lambda a, b: int(raw_seconds[index[a], index[b]])
    coords = {"depot": (depot.lat, depot.lon), **stops}

    def leg(a: str, b: str) -> int:
        if a == b:
            return 0
        meters = haversine_m(np.array([coords[a], coords[b]]))[0, 1] * circuity
        return round(meters / ESTIMATED_SPEED_M_PER_S)

    return leg


def estimated_seconds(lat_lon: np.ndarray, circuity: float) -> np.ndarray:
    return np.rint(haversine_m(lat_lon) * circuity / ESTIMATED_SPEED_M_PER_S).astype(np.int64)


def shortest_seconds_from_depot(meters: np.ndarray, seconds: np.ndarray, max_leg_m: int):
    """Dijkstra from node 0 over directed legs the run may use (0 <= meters <= limit, known
    duration). Returns seconds per node; inf where no chain of allowed legs reaches it."""
    n = meters.shape[0]
    allowed = (meters >= 0) & (meters <= max_leg_m) & (seconds >= 0)
    np.fill_diagonal(allowed, False)
    cost = np.where(allowed, seconds, np.inf).astype(float)
    best = np.full(n, np.inf)
    best[0] = 0.0
    done = np.zeros(n, dtype=bool)
    for _ in range(n):
        masked = np.where(done, np.inf, best)
        u = int(np.argmin(masked))
        if not np.isfinite(masked[u]):
            break
        done[u] = True
        best = np.minimum(best, best[u] + cost[u])
    return best
