"""M5 allocation strategies (spec §8, §16 "Model correctness")."""

import itertools
import random

import pytest

from fillrate_optimizer.allocation import allocate
from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import run_pipeline

from .conftest import east
from .test_pipeline import FAST, scenario

STRATEGIES = ["order_date_then_value", "first_come", "priority", "proportional", "optimized"]


def line(lid, oid, product, ordered, value, date="2026-09-01", customer=None, priority=1):
    return {
        "line_id": lid,
        "order_id": oid,
        "customer_id": customer or oid,
        "product_id": product,
        "order_date": date,
        "priority": priority,
        "ordered": ordered,
        "value": value,
    }


def random_case(rng: random.Random):
    lines = []
    for o in range(rng.randint(1, 4)):
        date = f"2026-09-0{rng.randint(1, 3)}"
        for n in range(rng.randint(1, 2)):
            lines.append(
                line(
                    f"O{o}-{n}",
                    f"O{o}",
                    rng.choice("PQ"),
                    rng.randint(0, 3),
                    rng.randint(1, 9) * 100,
                    date,
                    customer=f"C{o % 2}",
                    priority=rng.randint(1, 3),
                )
            )
    return lines, {"P": rng.randint(0, 5), "Q": rng.randint(0, 5)}


def feasible(lines, stock, alloc, policy):
    used = {p: 0 for p in stock}
    for ln in lines:
        if not 0 <= alloc[ln["line_id"]] <= ln["ordered"]:
            return False
        used[ln["product_id"]] += alloc[ln["line_id"]]
    if any(used[p] > stock[p] for p in stock):
        return False
    if policy == "whole_order":  # every order is all full or all empty
        for ln in lines:
            group = [x for x in lines if x["order_id"] == ln["order_id"]]
            full = all(alloc[x["line_id"]] == x["ordered"] for x in group)
            empty = all(alloc[x["line_id"]] == 0 for x in group)
            if not (full or empty):
                return False
    return True


def respects_dates(lines, alloc):
    for a, b in itertools.permutations(lines, 2):
        if (
            a["product_id"] == b["product_id"]
            and a["order_date"] < b["order_date"]
            and alloc[a["line_id"]] < a["ordered"]
            and alloc[b["line_id"]] > 0
        ):
            return False
    return True


def oracle(lines, stock, policy, respect_order_date=False, priority=False):
    """Exhaustive best allocation for tiny cases."""
    if policy == "whole_order":
        orders = sorted({ln["order_id"] for ln in lines})
        choices = (
            {ln["line_id"]: ln["ordered"] * (ln["order_id"] in picked) for ln in lines}
            for r in range(len(orders) + 1)
            for picked in map(set, itertools.combinations(orders, r))
        )
    else:
        choices = (
            dict(zip([ln["line_id"] for ln in lines], qty, strict=True))
            for qty in itertools.product(*(range(ln["ordered"] + 1) for ln in lines))
        )
    best = None
    for alloc in choices:
        if not feasible(lines, stock, alloc, policy):
            continue
        if respect_order_date and not respects_dates(lines, alloc):
            continue
        revenue = sum(alloc[ln["line_id"]] * ln["value"] for ln in lines)
        weighted = sum(alloc[ln["line_id"]] * ln["priority"] for ln in lines)
        score = (weighted, revenue) if priority else (revenue,)
        best = score if best is None or score > best else best
    return best


@pytest.mark.parametrize("policy", ["piece", "whole_order"])
@pytest.mark.parametrize("respect", [False, True])
def test_cp_sat_matches_exhaustive_oracle(policy, respect):
    rng = random.Random(7)
    for _ in range(40):
        lines, stock = random_case(rng)
        out = allocate(lines, stock, "optimized", policy, respect_order_date=respect)
        assert out.kind == "cp_sat" and out.stages[-1].status == "optimal"
        assert feasible(lines, stock, out.allocated, policy)
        if respect:
            assert respects_dates(lines, out.allocated)
        revenue = sum(out.allocated[ln["line_id"]] * ln["value"] for ln in lines)
        assert (revenue,) == oracle(lines, stock, policy, respect)


def test_cp_sat_lexicographic_priority_matches_oracle():
    rng = random.Random(11)
    for _ in range(30):
        lines, stock = random_case(rng)
        out = allocate(lines, stock, "optimized", "piece", objective="priority_then_revenue")
        assert [s.objective for s in out.stages] == ["priority_weighted_pieces", "revenue_cents"]
        assert all(s.status == "optimal" for s in out.stages)
        weighted = sum(out.allocated[ln["line_id"]] * ln["priority"] for ln in lines)
        revenue = sum(out.allocated[ln["line_id"]] * ln["value"] for ln in lines)
        assert (weighted, revenue) == oracle(lines, stock, "piece", priority=True)


@pytest.mark.parametrize("strategy", STRATEGIES)
@pytest.mark.parametrize("policy", ["piece", "whole_order"])
def test_every_strategy_respects_stock_and_reconciles(strategy, policy):
    rng = random.Random(3)
    for _ in range(40):
        lines, stock = random_case(rng)
        out = allocate(lines, stock, strategy, policy)
        assert feasible(lines, stock, out.allocated, policy)
        for p in stock:
            used = sum(out.allocated[ln["line_id"]] for ln in lines if ln["product_id"] == p)
            assert out.residual[p] == stock[p] - used
        short = {ln["line_id"] for ln in lines if out.allocated[ln["line_id"]] < ln["ordered"]}
        assert set(out.shortages) == short
        assert allocate(lines, stock, strategy, policy).allocated == out.allocated


def test_first_come_and_priority_orders():
    lines = [
        line("A", "OA", "P", 2, 100, "2026-09-02", priority=5),
        line("B", "OB", "P", 2, 900, "2026-09-02"),
        line("C", "OC", "P", 2, 100, "2026-09-01"),
    ]
    stock = {"P": 3}
    # First-come ignores value: same-date tie goes to the lower stable ID.
    assert allocate(lines, stock, "first_come").allocated == {"C": 2, "A": 1, "B": 0}
    assert allocate(lines, stock).allocated == {"C": 2, "B": 1, "A": 0}
    assert allocate(lines, stock, "priority").allocated == {"A": 2, "C": 1, "B": 0}


def test_whole_order_greedy_skips_orders_that_do_not_fit():
    lines = [
        line("A1", "OA", "P", 3, 100, "2026-09-01"),
        line("A2", "OA", "Q", 1, 100, "2026-09-01"),
        line("B1", "OB", "P", 2, 100, "2026-09-02"),
    ]
    out = allocate(lines, {"P": 4, "Q": 0}, policy="whole_order")
    assert out.allocated == {"A1": 0, "A2": 0, "B1": 2}
    assert "1 Q (0 left)" in out.shortages["A1"]


def test_proportional_piece_shares_fairly():
    lines = [
        line("A", "OA", "P", 6, 100, "2026-09-01", customer="C1"),
        line("B", "OB", "P", 3, 100, "2026-09-02", customer="C2"),
        line("C", "OC", "P", 3, 100, "2026-09-03", customer="C3"),
    ]
    # r = 7/12: floors give 3 + 1 + 1, the two leftovers go to the customers furthest below
    # target (C2, C3 at 1 / 1.75), in date order.
    out = allocate(lines, {"P": 7}, "proportional")
    assert out.allocated == {"A": 3, "B": 2, "C": 2}
    assert out.residual == {"P": 0}
    assert "Fair-share heuristic" in out.shortages["A"]


def test_proportional_zero_demand_and_zero_stock():
    lines = [line("A", "OA", "P", 0, 100), line("B", "OB", "Q", 4, 100)]
    out = allocate(lines, {"P": 5, "Q": 0}, "proportional")
    assert out.allocated == {"A": 0, "B": 0} and out.residual == {"P": 5, "Q": 0}


def test_whole_order_pipeline_excludes_the_whole_order_and_reconciles():
    doc = scenario(
        [("A", east(50)), ("X", None)],
        [("O1", "A", "2026-09-01", "P", 2, 100), ("O2", "A", "2026-09-02", "P", 9, 100)],
        [("P", 5)],
    ).model_dump(mode="json")
    # O1 gets a second line; excluding it must take O1-1 out too, never fill O1 partly.
    doc["orders"][0]["lines"].append(
        {"id": "O1-2", "product_id": "P", "ordered_pieces": 1, "net_value_per_piece_cents": 100}
    )
    settings = FAST.model_copy(
        update={"fulfillment_policy": "whole_order", "excluded_line_ids": ["O1-2"]}
    )
    out = run_pipeline(ScenarioDocument.model_validate(doc), settings)
    reasons = {u.line_id: u.reason for u in out.summary.unplanned}
    assert reasons == {
        "O1-2": "excluded_by_user",
        "O1-1": "excluded_with_order",
        "O2-1": "stock_shortage",
    }
    assert out.summary.allocation.fulfillment_policy == "whole_order"
    assert out.summary.products[0].allocated == 0


def test_optimized_pipeline_records_cp_sat_provenance():
    doc = scenario(
        [("A", east(50)), ("B", east(80))],
        [("O1", "A", "2026-09-01", "P", 3, 100), ("O2", "B", "2026-09-02", "P", 3, 900)],
        [("P", 3)],
    )
    settings: RunSettings = FAST.model_copy(update={"allocation_strategy": "optimized"})
    summary = run_pipeline(doc, settings).summary
    assert summary.allocation.kind == "cp_sat"
    assert summary.allocation.stages[0].status == "optimal"
    assert summary.totals.allocated_cents == 2_700
    respect = settings.model_copy(update={"respect_order_date": True})
    assert run_pipeline(doc, respect).summary.totals.allocated_cents == 300
