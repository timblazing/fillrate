"""The allocation lesson's "what to look for" claims (`app/learn/allocation-policies`)."""

import json
from collections import defaultdict
from pathlib import Path

import pytest

from fillrate_optimizer import lesson_allocation
from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import run_pipeline

STRATEGIES = ["order_date_then_value", "first_come", "priority", "proportional", "optimized"]
POLICIES = ["piece", "whole_order"]


@pytest.fixture(scope="module")
def scenario() -> ScenarioDocument:
    return lesson_allocation.build()


@pytest.fixture(scope="module")
def grid(scenario):
    """One real pipeline run per strategy × policy, as the lesson's sweep makes."""
    return {
        (strategy, policy): run_pipeline(
            scenario,
            lesson_allocation.SETTINGS.model_copy(
                update={"allocation_strategy": strategy, "fulfillment_policy": policy}
            ),
        ).summary
        for strategy in STRATEGIES
        for policy in POLICIES
    }


def shortages(summary) -> dict[str, int]:
    short: dict[str, int] = defaultdict(int)
    for u in summary.unplanned:
        if u.reason == "stock_shortage":
            short[u.order_id] += u.pieces
    return short


def order_state(scenario, summary) -> dict[str, int]:
    """Orders by fill: 'full', 'partial' (some pieces short, some shipped) or 'none'."""
    ordered = {o.id: sum(line.ordered_pieces for line in o.lines) for o in scenario.orders}
    short = shortages(summary)
    states = {"full": 0, "partial": 0, "none": 0}
    for order_id, pieces in ordered.items():
        s = short.get(order_id, 0)
        states["full" if s == 0 else "none" if s == pieces else "partial"] += 1
    return states


def test_example_file_matches_the_generator():
    path = Path(__file__).resolve().parents[3] / "examples/lesson-allocation.json"
    document = json.loads(path.read_text())
    assert document["scenario"] == lesson_allocation.build().model_dump(mode="json")
    assert document["settings"] == lesson_allocation.SETTINGS.model_dump(mode="json")
    RunSettings.model_validate(document["settings"])


def test_only_carpet_rolls_are_scarce(scenario):
    ordered = {p.id: 0 for p in scenario.products}
    for o in scenario.orders:
        for line in o.lines:
            ordered[line.product_id] += line.ordered_pieces
    stock = {i.product_id: i.available_pieces for i in scenario.inventory}
    assert (len(scenario.orders), len(scenario.locations)) == (90, 45)
    assert (ordered["SKU-ROLL"], stock["SKU-ROLL"]) == (438, 219)
    assert stock["SKU-PALLET"] == ordered["SKU-PALLET"]
    assert stock["SKU-BOX"] == ordered["SKU-BOX"]


def test_every_cell_is_a_valid_complete_plan_that_ships_what_it_allocates(grid):
    for key, summary in grid.items():
        assert (summary.validity, summary.coverage) == ("valid", "complete"), key
        assert summary.totals.planned_cents == summary.totals.allocated_cents, key
        assert {u.reason for u in summary.unplanned} == {"stock_shortage"}, key
        if key[1] == "piece":  # only the scarce product is short when lines can ship partly
            assert {u.product_id for u in summary.unplanned} == {"SKU-ROLL"}, key


def test_step_1_default_strategy_fills_partial_lines_and_empties_the_shelf(scenario, grid):
    summary = grid["order_date_then_value", "piece"]
    assert order_state(scenario, summary) == {"full": 44, "partial": 33, "none": 13}
    roll = next(p for p in summary.products if p.product_id == "SKU-ROLL")
    assert roll.residual == 0


def test_step_1_whole_order_never_ships_a_partly_filled_order(scenario, grid):
    for strategy in STRATEGIES:
        assert order_state(scenario, grid[strategy, "whole_order"])["partial"] == 0, strategy
    summary = grid["order_date_then_value", "whole_order"]
    assert order_state(scenario, summary)["none"] == 46
    assert (
        summary.totals.trucks == 11 and grid["order_date_then_value", "piece"].totals.trucks == 14
    )
    assert summary.totals.ordered_cents == 9_227_500
    assert round(summary.totals.allocated_cents, -4) == 4_270_000  # about $42,700
    assert round(grid["order_date_then_value", "piece"].totals.allocated_cents, -4) == 6_530_000


def test_step_1_priority_protects_the_highest_priority_orders(scenario, grid):
    priority = {o.id: o.priority for o in scenario.orders}

    def short_at_5(key):
        return sum(p for order_id, p in shortages(grid[key]).items() if priority[order_id] == 5)

    assert short_at_5(("priority", "piece")) == 0
    assert short_at_5(("order_date_then_value", "piece")) == 53


def test_step_1_fair_share_leaves_no_order_filled_in_full(scenario, grid):
    assert order_state(scenario, grid["proportional", "piece"]) == {
        "full": 0,
        "partial": 90,
        "none": 0,
    }


def test_step_2_unshipped_lines_by_product(grid):
    def short_lines(summary):
        counts: dict[str, int] = defaultdict(int)
        for u in summary.unplanned:
            counts[u.product_id] += 1
        return dict(counts)

    assert short_lines(grid["order_date_then_value", "piece"]) == {"SKU-ROLL": 46}
    whole = grid["order_date_then_value", "whole_order"]
    assert short_lines(whole) == {"SKU-ROLL": 46, "SKU-PALLET": 19, "SKU-BOX": 12}
    # Dropped orders' pallets and cartons were never short: the evidence names the missing rolls.
    blocked = next(u for u in whole.unplanned if u.product_id == "SKU-PALLET")
    assert "SKU-ROLL" in blocked.evidence and "none of it ships" in blocked.evidence


def test_step_2_whole_orders_strand_stock_on_the_shelf(grid):
    whole = {p.product_id: p for p in grid["order_date_then_value", "whole_order"].products}
    assert {k: v.residual for k, v in whole.items()} == {
        "SKU-PALLET": 51,
        "SKU-ROLL": 1,
        "SKU-BOX": 32,
    }
    for product in whole.values():
        assert product.starting_inventory == product.allocated + product.residual


def test_step_3_the_solver_is_proven_optimal_and_best_under_either_policy(grid):
    for policy in POLICIES:
        solver = grid["optimized", policy]
        assert solver.allocation.kind == "cp_sat"
        assert [s.status for s in solver.allocation.stages] == ["optimal"]
        best = max(grid[s, policy].totals.allocated_cents for s in STRATEGIES)
        assert solver.totals.allocated_cents == best
    # Whole-order demand is a subset of piece-level plans, so proven optima are ordered.
    assert (
        grid["optimized", "whole_order"].totals.allocated_cents
        <= grid["optimized", "piece"].totals.allocated_cents
    )
    assert round(grid["optimized", "piece"].totals.allocated_cents, -4) == 6_580_000
    assert round(grid["optimized", "whole_order"].totals.allocated_cents, -4) == 6_470_000


def test_step_3_policy_matters_more_than_strategy_for_greedy_rules(grid):
    optimum = grid["optimized", "piece"].totals.allocated_cents
    for strategy in STRATEGIES:
        assert grid[strategy, "piece"].totals.allocated_cents >= 0.99 * optimum, strategy
    greedy_whole = [
        grid[s, "whole_order"].totals.allocated_cents for s in STRATEGIES if s != "optimized"
    ]
    assert max(greedy_whole) < 0.75 * optimum
