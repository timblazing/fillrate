"""Claims in the manual versus optimized routes lesson (`app/learn/manual-routes`)."""

import json
from pathlib import Path

import pytest

from fillrate_optimizer import lesson_manual
from fillrate_optimizer.artifact_codec import decode_travel
from fillrate_optimizer.evaluate import cluster_request, evaluate
from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import run_pipeline

ROOT = Path(__file__).resolve().parents[3] / "examples"
PALLET = lesson_manual.PALLET_FEET


def miles(meters: int) -> int:
    return round(meters / 1609.344)


@pytest.fixture(scope="module")
def run():
    return run_pipeline(lesson_manual.build(), lesson_manual.SETTINGS)


def evaluated(run, plan_name: str):
    stages = {a.stage: a.payload for a in run.artifacts}
    stages["travel"] = decode_travel(stages["travel"])
    # Each stop is one visit, so a location ID names its visit, as the lesson page maps it.
    visit = {json.loads(v.split("#")[0])[0]: v for v in stages["problem"]["clusters"][0]["visits"]}
    routes = [[visit[loc] for loc in route] for route in lesson_manual.PLANS[plan_name]]
    request = cluster_request(lesson_manual.build(), lesson_manual.SETTINGS, stages, "C1", routes)
    return evaluate(request)


def test_example_file_matches_the_generator():
    document = json.loads((ROOT / "lesson-manual.json").read_text())
    assert ScenarioDocument.model_validate(document["scenario"]) == lesson_manual.build()
    assert RunSettings.model_validate(document["settings"]) == lesson_manual.SETTINGS
    assert document["plans"] == lesson_manual.PLANS
    assert document["settings"]["k"] == 1


def test_step1_three_trucks_at_the_lower_bound(run):
    s = run.summary
    assert s.validity == "valid" and s.coverage == "complete"
    pallets = sum(stop[4] for stop in lesson_manual.STOPS)
    assert pallets == 29 and lesson_manual.CAPACITY // PALLET == 13
    assert s.totals.capacity_lower_bound == 3 and s.totals.trucks == 3
    assert miles(s.totals.loaded_distance_m) == 273
    # Each truck works one part of the map.
    assert sorted(sorted(v.location_id for v in t.visits) for t in s.trucks) == [
        ["MR-01", "MR-05", "MR-07", "MR-09"],
        ["MR-02", "MR-04", "MR-06"],
        ["MR-03", "MR-08", "MR-10"],
    ]


def test_step1_routes_repeat_across_solver_seeds(run):
    for seed in range(1, 4):
        other = run_pipeline(
            lesson_manual.build(), lesson_manual.SETTINGS.model_copy(update={"solver_seed": seed})
        ).summary
        assert miles(other.totals.loaded_distance_m) == 273 and other.totals.trucks == 3


def test_step2_in_order_plan_is_valid_with_far_more_miles(run):
    assert lesson_manual.PLANS["in_order"] == [
        ["MR-01", "MR-02", "MR-03"],
        ["MR-04", "MR-05", "MR-06", "MR-07"],
        ["MR-08", "MR-09", "MR-10"],
    ]
    result = evaluated(run, "in_order")
    manual, optimized = result.manual, result.reference
    assert manual.valid and manual.violations == []
    assert manual.metrics.trucks == optimized.metrics.trucks == 3
    assert manual.metrics.planned_amount_cents == optimized.metrics.planned_amount_cents
    assert miles(manual.metrics.loaded_distance_m) == 714
    assert miles(optimized.metrics.loaded_distance_m) == 273
    assert manual.metrics.loaded_distance_m / optimized.metrics.loaded_distance_m > 2.6
    # Same truck count, so the objective differs by the extra meters alone.
    assert (
        manual.metrics.objective - optimized.metrics.objective
        == manual.metrics.loaded_distance_m - optimized.metrics.loaded_distance_m
    )
    # Fill is the same kind of number either way: the freight and truck count are unchanged.
    assert manual.metrics.avg_fill == optimized.metrics.avg_fill
    # The first truck crosses the DC: east, then west, then north.
    first = [v.location_id for v in manual.trucks[0].visits]
    assert first == ["MR-01", "MR-02", "MR-03"]
    assert miles(manual.trucks[0].visits[1].leg_m) == 90


def test_step3_east_west_plan_is_invalid_over_capacity(run):
    result = evaluated(run, "east_west")
    manual = result.manual
    assert not manual.valid
    assert [(v.code, v.truck, v.message) for v in manual.violations] == [
        ("over_capacity", 2, "truck 2 load 6400 > capacity 5300")
    ]
    pallets = {stop[0]: stop[4] for stop in lesson_manual.STOPS}
    east, west = lesson_manual.PLANS["east_west"]
    assert sum(pallets[x] for x in east) == 13 and sum(pallets[x] for x in west) == 16
    # Fewer trucks than the lower bound is only possible by overloading one.
    assert manual.metrics.trucks == 2 < run.summary.totals.capacity_lower_bound
    assert manual.trucks[1].fill == pytest.approx(64 / 53)
