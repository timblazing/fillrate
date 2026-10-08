"""The time windows lesson's "what to look for" claims."""

import json
from pathlib import Path

import pytest

from fillrate_optimizer import lesson_windows
from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import run_pipeline
from fillrate_optimizer.timewin import elapsed_s

ROOT = Path(__file__).resolve().parents[3] / "examples"
CAPACITY = 5_300
SEEDS = range(4)


def miles(summary) -> int:
    return round(summary.totals.loaded_distance_m / 1609.344)


def clock(seconds: int) -> str:
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}"


@pytest.fixture(scope="module")
def runs():
    """Solver seeds 0–3 for the scenario with windows and the same stops without them."""
    return {
        (windows, seed): run_pipeline(
            lesson_windows.build(windows),
            lesson_windows.SETTINGS.model_copy(update={"solver_seed": seed}),
        ).summary
        for windows in (True, False)
        for seed in SEEDS
    }


@pytest.fixture(scope="module")
def windows(runs):
    return runs[True, 0]


@pytest.fixture(scope="module")
def open_plan(runs):
    return runs[False, 0]


def window_s(location_id: str) -> tuple[int, int] | None:
    stop = next(s for s in lesson_windows.STOPS if s[0] == location_id)
    if not stop[6]:
        return None
    tm = lesson_windows.build().time_model
    return tuple(elapsed_s(tm.timezone, tm.planning_date, t) for t in stop[6])


@pytest.mark.parametrize(
    ("name", "with_windows"), [("lesson-windows.json", True), ("lesson-windows-off.json", False)]
)
def test_example_files_match_the_generator(name, with_windows):
    document = json.loads((ROOT / name).read_text())
    assert document["scenario"] == lesson_windows.build(with_windows).model_dump(mode="json")
    assert document["settings"] == lesson_windows.SETTINGS.model_dump(mode="json")
    RunSettings.model_validate(document["settings"])


def test_the_two_examples_differ_only_in_the_windows():
    on, off = lesson_windows.build(True), lesson_windows.build(False)
    assert isinstance(off, ScenarioDocument)
    assert (len(on.locations), len(on.orders)) == (9, 9)
    assert sum(1 for loc in on.locations if loc.window) == 7
    assert not any(loc.window for loc in off.locations)
    assert [loc.service_minutes for loc in on.locations] == [
        loc.service_minutes for loc in off.locations
    ]
    assert on.time_model == off.time_model
    assert (on.time_model.depot_open, on.time_model.horizon_end) == ("06:00", "20:00")
    strip = {"name", "locations"}
    assert on.model_dump(exclude=strip) == off.model_dump(exclude=strip)
    assert [loc.model_dump(exclude={"window"}) for loc in on.locations] == [
        loc.model_dump() for loc in off.locations
    ]


def test_all_freight_fits_one_trailer(windows, open_plan):
    for summary in (windows, open_plan):
        assert summary.totals.load == 5_200 <= CAPACITY
        assert summary.totals.capacity_lower_bound == 1
        assert summary.preflight == []


def test_step_1_windows_need_two_trucks_and_every_start_is_inside_its_window(windows):
    assert (windows.validity, windows.coverage) == ("valid", "complete")
    assert windows.unplanned == []
    assert windows.totals.trucks == 2
    assert miles(windows) == 225
    assert windows.time.timezone == "America/Chicago"
    for truck in windows.trucks:
        assert truck.shift_start_s == elapsed_s("America/Chicago", "2026-10-06", "06:00")
        assert truck.end_s <= windows.time.horizon_end_s
        for visit in truck.visits:
            bounds = window_s(visit.location_id)
            if bounds:
                assert bounds[0] <= visit.start_s <= bounds[1], visit.location_id
                assert (visit.window_earliest_s, visit.window_latest_s) == bounds
            assert visit.start_s == visit.arrival_s + visit.wait_s
            assert visit.departure_s == visit.start_s + visit.service_s


def test_step_1_every_solver_seed_finds_the_same_plan(runs):
    for with_windows in (True, False):
        plans = {
            json.dumps(
                sorted([v.location_id for v in t.visits] for t in runs[with_windows, s].trucks)
            )
            for s in SEEDS
        }
        assert len(plans) == 1, with_windows


def test_step_2_one_truck_waits_at_the_bakery_and_the_other_never_waits(windows):
    by_stop = {v.location_id: (t.id, v) for t in windows.trucks for v in t.visits}
    truck, bakery = by_stop["TW-01"]
    assert (clock(bakery.arrival_s), clock(bakery.start_s)) == ("10:42", "13:00")
    assert bakery.wait_s // 60 == 137  # 2 h 17 min
    waits = {t.id: t.wait_s_total for t in windows.trucks}
    assert waits[truck] // 60 == 165  # 2 h 45 min in all, including the pharmacy and restaurant
    assert [w for t, w in waits.items() if t != truck] == [0]
    routes = {t.id: [v.location_id for v in t.visits] for t in windows.trucks}
    assert len(routes.pop(truck)) == 6
    assert [sorted(r) for r in routes.values()] == [["TW-02", "TW-03", "TW-08"]]


def test_step_2_service_minutes_come_from_the_location(windows, open_plan):
    service = {s[0]: s[5] * 60 for s in lesson_windows.STOPS}
    for summary in (windows, open_plan):
        for truck in summary.trucks:
            for visit in truck.visits:
                assert visit.service_s == service[visit.location_id]
        assert sum(t.service_s_total for t in summary.trucks) == 15_900  # 4 h 25 min


def test_step_3_without_windows_one_truck_drives_fewer_miles_but_misses_six_windows(open_plan):
    assert (open_plan.validity, open_plan.coverage) == ("valid", "complete")
    assert open_plan.totals.trucks == 1
    assert miles(open_plan) == 177
    (truck,) = open_plan.trucks
    assert truck.wait_s_total == 0
    assert clock(truck.end_s) == "17:30"
    early, late, inside = [], [], []
    for visit in truck.visits:
        bounds = window_s(visit.location_id)
        if not bounds:
            continue
        assert visit.window_earliest_s is None
        if visit.start_s < bounds[0]:
            early.append(visit.location_id)
        elif visit.start_s > bounds[1]:
            late.append(visit.location_id)
        else:
            inside.append(visit.location_id)
    assert (len(early), len(late), inside) == (2, 4, ["TW-01"])
