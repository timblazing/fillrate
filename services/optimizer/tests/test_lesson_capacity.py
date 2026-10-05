"""The truck capacity lesson's "what to look for" claims (`app/learn/truck-capacity`)."""

import json
import math
from pathlib import Path

import pytest

from fillrate_optimizer import lesson_capacity
from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import run_pipeline

CAPACITY = 5_300  # 53 ft in hundredths of a foot (RunSettings.trailer_capacity default)
INVENTORY = [100, 70, 50, 25]


@pytest.fixture(scope="module")
def scenario() -> ScenarioDocument:
    return lesson_capacity.build()


@pytest.fixture(scope="module")
def runs(scenario):
    """One real pipeline run per inventory percent, as the lesson's steps and sweep make."""
    return {
        pct: run_pipeline(
            scenario, lesson_capacity.SETTINGS.model_copy(update={"inventory_percent": pct})
        ).summary
        for pct in INVENTORY
    }


def test_example_file_matches_the_generator():
    path = Path(__file__).resolve().parents[3] / "examples/lesson-capacity.json"
    document = json.loads(path.read_text())
    assert document["scenario"] == lesson_capacity.build().model_dump(mode="json")
    assert document["settings"] == lesson_capacity.SETTINGS.model_dump(mode="json")
    RunSettings.model_validate(document["settings"])


def test_stock_is_plentiful_and_one_stop_is_larger_than_a_trailer(scenario):
    lf = {p.id: p.linear_feet_per_piece for p in scenario.products}
    ordered = dict.fromkeys(lf, 0)
    by_location: dict[str, int] = {}
    for o in scenario.orders:
        for line in o.lines:
            ordered[line.product_id] += line.ordered_pieces
            by_location[o.location_id] = (
                by_location.get(o.location_id, 0) + line.ordered_pieces * lf[line.product_id]
            )
    assert {i.product_id: i.available_pieces for i in scenario.inventory} == ordered
    assert (len(scenario.orders), len(scenario.locations)) == (31, 31)
    assert sum(by_location.values()) == 66_750
    assert [loc for loc, load in by_location.items() if load > CAPACITY] == ["LOC-BIG"]
    assert by_location["LOC-BIG"] == 12_000


def test_step_1_trucks_equal_the_capacity_lower_bound_and_no_truck_is_overloaded(runs):
    summary = runs[100]
    assert (summary.validity, summary.coverage) == ("valid", "complete")
    assert summary.unplanned == []
    totals = summary.totals
    assert totals.load == 66_750
    assert totals.capacity_lower_bound == math.ceil(66_750 / CAPACITY) == 13
    assert totals.trucks == 13
    assert all(t.load <= CAPACITY for t in summary.trucks)
    assert all(t.load == sum(v.load for v in t.visits) for t in summary.trucks)
    assert sum(t.load for t in summary.trucks) == totals.load


def test_step_1_fill_percentages(runs):
    summary = runs[100]
    assert all(t.fill == pytest.approx(t.load / CAPACITY) for t in summary.trucks)
    assert round(summary.totals.avg_fill, 3) == 0.969
    assert round(summary.totals.min_fill, 3) == 0.906
    assert round(max(t.fill for t in summary.trucks), 3) == 1.0
    assert all(t.fill >= 0.9 for t in summary.trucks)
    assert round(summary.totals.utilization, 3) == 0.969


def test_step_1_the_oversize_stop_is_split_across_three_shipments(runs):
    summary = runs[100]
    finding = next(f for f in summary.preflight if f.check == "oversize_stop")
    assert (finding.action, finding.location_ids) == ("warn", ["LOC-BIG"])
    big = [(t.id, v.load) for t in summary.trucks for v in t.visits if v.location_id == "LOC-BIG"]
    assert len({truck for truck, _ in big}) == 3
    assert sorted(load for _, load in big) == [1_600, 5_200, 5_200]  # 13 + 13 + 4 pallets
    assert sum(load for _, load in big) == 12_000
    assert all(load <= CAPACITY for _, load in big)


def test_step_2_less_inventory_needs_fewer_trucks_and_stays_at_the_lower_bound(runs):
    assert [runs[p].totals.trucks for p in INVENTORY] == [13, 9, 7, 4]
    for pct in INVENTORY:
        summary = runs[pct]
        assert (summary.validity, summary.coverage) == ("valid", "complete"), pct
        assert summary.totals.trucks == summary.totals.capacity_lower_bound, pct
        assert all(t.load <= CAPACITY for t in summary.trucks), pct
        assert {u.reason for u in summary.unplanned} <= {"stock_shortage"}, pct
    assert [runs[p].totals.load for p in INVENTORY] == [66_750, 46_300, 33_000, 16_400]


def test_step_2_fill_drops_when_there_is_too_little_freight_to_fill_the_last_trailers(runs):
    avg = [round(runs[p].totals.avg_fill, 3) for p in INVENTORY]
    assert avg == [0.969, 0.971, 0.889, 0.774]
    assert round(runs[50].totals.min_fill, 3) == 0.802
    assert round(runs[25].totals.min_fill, 3) == 0.623
    # A short run of stock is not a capacity problem: shortage lines are unshipped, not overloaded.
    assert len(runs[70].unplanned) == 19 and len(runs[25].unplanned) == 37
