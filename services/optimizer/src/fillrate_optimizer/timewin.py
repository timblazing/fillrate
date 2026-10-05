"""Time model, window normalization and the independent time validator (spec §5, M6).

Local clock strings ("HH:MM", up to 48:00) are normalized to integer seconds elapsed from the
instant of local midnight on the planning date, using the IANA timezone's real UTC offsets.
Nonexistent local times (spring-forward gap) are rejected; ambiguous ones (fall-back overlap)
need an explicit ``fold`` (0 = first occurrence, 1 = second).

``recompute_route`` is the validator: it knows nothing about PyVRP and recomputes every arrival,
wait, start and departure from the raw provider durations.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

MAX_CLOCK_MINUTES = 48 * 60
CLOCK = re.compile(r"^(\d{2}):([0-5]\d)$")


def parse_clock(text: str) -> int:
    """Minutes after local midnight of the planning date; may exceed 24:00, at most 48:00."""
    match = CLOCK.match(text)
    if not match:
        raise ValueError(f"clock time {text!r} is not HH:MM")
    minutes = int(match[1]) * 60 + int(match[2])
    if minutes > MAX_CLOCK_MINUTES:
        raise ValueError(f"clock time {text} is past the 48:00 limit")
    return minutes


def format_clock(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def load_zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError) as error:
        raise ValueError(f"unknown IANA timezone {name!r}") from error


def _instant(zone: ZoneInfo, day: date, minutes: int, fold: int | None, label: str) -> datetime:
    naive = datetime(day.year, day.month, day.day) + timedelta(minutes=minutes)
    first = naive.replace(tzinfo=zone, fold=0)
    second = naive.replace(tzinfo=zone, fold=1)
    if first.astimezone(UTC).astimezone(zone).replace(tzinfo=None) != naive:
        raise ValueError(
            f"{label} {naive:%Y-%m-%d %H:%M} does not exist in {zone.key} (daylight-saving gap)"
        )
    if first.utcoffset() != second.utcoffset():
        if fold is None:
            raise ValueError(
                f"{label} {naive:%Y-%m-%d %H:%M} is ambiguous in {zone.key}; "
                "choose fold 0 (first) or 1 (second)"
            )
        return (second if fold else first).astimezone(UTC)
    return first.astimezone(UTC)


def midnight_epoch_s(timezone: str, planning_date: str) -> int:
    """UTC epoch seconds of local midnight on the planning date."""
    zone, day = load_zone(timezone), date.fromisoformat(planning_date)
    return int(_instant(zone, day, 0, 0, "midnight").timestamp())


def elapsed_s(
    timezone: str, planning_date: str, clock: str, fold: int | None = None, label: str = "time"
) -> int:
    zone, day = load_zone(timezone), date.fromisoformat(planning_date)
    midnight = _instant(zone, day, 0, 0, "midnight")
    instant = _instant(zone, day, parse_clock(clock), fold, label)
    return int((instant - midnight).total_seconds())


class Finding(str):
    """One validator violation: its message text, plus a machine code and where it occurred.

    A ``str`` subclass, so the validation artifact and ``ClusterSummary.violations`` keep the plain
    messages byte for byte while the manual evaluator (spec §10) reads ``code``, ``truck`` (1-based
    position in the plan) and ``visit_id``.
    """

    code: str
    truck: int | None
    visit_id: str | None

    def __new__(
        cls, code: str, message: str, truck: int | None = None, visit_id: str | None = None
    ):
        finding = super().__new__(cls, message)
        finding.code, finding.truck, finding.visit_id = code, truck, visit_id
        return finding

    def at(self, truck: int) -> Finding:
        return Finding(self.code, str(self), truck, self.visit_id)


@dataclass(frozen=True)
class VisitTime:
    """Normalized time attributes of one visit; None bounds are open (limited by the horizon)."""

    service_s: int = 0
    earliest_s: int | None = None
    latest_s: int | None = None


@dataclass(frozen=True)
class StopTiming:
    arrival_s: int
    wait_s: int
    service_s: int
    start_s: int
    departure_s: int
    earliest_s: int | None
    latest_s: int | None


def recompute_route(
    legs_s: list[int],
    visits: list[VisitTime],
    labels: list[str],
    depot_open_s: int,
    horizon_end_s: int,
    visit_ids: list[str] | None = None,
) -> tuple[list[StopTiming], list[Finding]]:
    """Recompute one open route from raw leg durations (the synthetic return costs nothing).

    arrival = previous departure + leg; start = max(arrival, earliest); wait = start - arrival;
    violation if start > latest; departure = start + service; violation if the last departure
    is after the horizon end. The truck leaves the depot at ``depot_open_s``.
    """
    timings: list[StopTiming] = []
    violations: list[Finding] = []
    clock = depot_open_s
    ids = visit_ids or [None] * len(visits)
    for leg, visit, label, vid in zip(legs_s, visits, labels, ids, strict=True):
        arrival = clock + leg
        start = max(arrival, visit.earliest_s if visit.earliest_s is not None else arrival)
        if visit.latest_s is not None and start > visit.latest_s:
            violations.append(
                Finding(
                    "window_late",
                    f"{label}: service would start at {start} s, after its window end "
                    f"{visit.latest_s} s",
                    visit_id=vid,
                )
            )
        clock = start + visit.service_s
        timings.append(
            StopTiming(
                arrival, start - arrival, visit.service_s, start, clock,
                visit.earliest_s, visit.latest_s,
            )
        )  # fmt: skip
    if clock > horizon_end_s:
        violations.append(
            Finding(
                "horizon_exceeded",
                f"route ends at {clock} s, after the horizon end {horizon_end_s} s",
            )
        )
    return timings, violations
