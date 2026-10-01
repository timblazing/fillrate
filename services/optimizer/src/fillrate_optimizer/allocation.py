"""Inventory allocation strategies (spec §8).

Every strategy takes the eligible order lines and the starting stock and returns whole pieces per
line, the residual stock, a shortage explanation per short line and provenance. One depot (the
scenario model has one), so no depot dimension and no cross-depot sourcing.

Greedy strategies are heuristics. `optimized` is OR-Tools CP-SAT with one worker and a fixed seed
so equal inputs reproduce; each objective stage reports its own status.
"""

from __future__ import annotations

import heapq
import time
from collections import defaultdict
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any, Literal

from ortools.sat.python import cp_model

Strategy = Literal["order_date_then_value", "first_come", "priority", "proportional", "optimized"]
Policy = Literal["piece", "whole_order"]
Objective = Literal["revenue", "priority_then_revenue"]

GREEDY_LABELS = {
    "order_date_then_value": "earlier-dated or higher-value",
    "first_come": "earlier-dated",
    "priority": "higher-priority or earlier-dated",
}


@dataclass
class AllocationStage:
    objective: str
    status: str
    value: int
    bound: int | None
    runtime_s: float


@dataclass
class AllocationResult:
    allocated: dict[str, int]
    residual: dict[str, int]
    shortages: dict[str, str]
    sequence: list[str]
    kind: Literal["heuristic", "cp_sat"]
    stages: list[AllocationStage] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def line_key(line: dict[str, Any], strategy: Strategy) -> tuple:
    """Piece-level processing order (§8). Stable line ID breaks every remaining tie."""
    if strategy == "first_come":
        return (line["order_date"], line["line_id"])
    if strategy == "priority":
        return (-line["priority"], line["order_date"], line["line_id"])
    return (line["order_date"], -line["value"], line["line_id"])


def group_orders(lines: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    orders: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for line in lines:
        orders[line["order_id"]].append(line)
    return orders


def order_key(order_lines: list[dict[str, Any]], strategy: Strategy) -> tuple:
    """Whole-order processing order: order date, then total net amount descending, then ID."""
    head = order_lines[0]
    total = sum(ln["ordered"] * ln["value"] for ln in order_lines)
    if strategy == "first_come":
        return (head["order_date"], head["order_id"])
    if strategy == "priority":
        return (-head["priority"], head["order_date"], head["order_id"])
    return (head["order_date"], -total, head["order_id"])


def needs(order_lines: list[dict[str, Any]]) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for ln in order_lines:
        out[ln["product_id"]] += ln["ordered"]
    return out


def allocate(
    lines: list[dict[str, Any]],
    stock: dict[str, int],
    strategy: Strategy = "order_date_then_value",
    policy: Policy = "piece",
    *,
    objective: Objective = "revenue",
    respect_order_date: bool = False,
    time_limit_s: float = 10,
) -> AllocationResult:
    """`lines` need line_id, order_id, customer_id, product_id, order_date, ordered, value and
    priority. Lines are assumed eligible; whole-order callers drop incomplete orders first."""
    stock = {p: n for p, n in stock.items()}
    if strategy == "optimized":
        result = optimized(lines, stock, policy, objective, respect_order_date, time_limit_s)
    elif strategy == "proportional":
        result = (proportional_whole if policy == "whole_order" else proportional_piece)(
            lines, stock
        )
    elif policy == "whole_order":
        result = greedy_whole(lines, stock, strategy)
    else:
        result = greedy_piece(lines, stock, strategy)
    for line in lines:
        result.allocated.setdefault(line["line_id"], 0)
    return result


def greedy_piece(lines, stock, strategy: Strategy) -> AllocationResult:
    start = dict(stock)
    allocated: dict[str, int] = {}
    shortages: dict[str, str] = {}
    order = sorted(lines, key=lambda ln: line_key(ln, strategy))
    for line in order:
        take = min(line["ordered"], stock.get(line["product_id"], 0))
        allocated[line["line_id"]] = take
        stock[line["product_id"]] = stock.get(line["product_id"], 0) - take
        if take < line["ordered"]:
            shortages[line["line_id"]] = (
                f"{start.get(line['product_id'], 0)} pieces of {line['product_id']} in stock "
                f"were already given to {GREEDY_LABELS[strategy]} lines."
            )
    return AllocationResult(
        allocated, stock, shortages, [ln["line_id"] for ln in order], "heuristic"
    )


def greedy_whole(lines, stock, strategy: Strategy) -> AllocationResult:
    allocated: dict[str, int] = {}
    shortages: dict[str, str] = {}
    sequence: list[str] = []
    orders = group_orders(lines)
    for order_id in sorted(orders, key=lambda o: order_key(orders[o], strategy)):
        order_lines = orders[order_id]
        need = needs(order_lines)
        short = sorted(p for p, n in need.items() if n > stock.get(p, 0))
        sequence.extend(ln["line_id"] for ln in order_lines)
        if short:
            evidence = whole_order_evidence(order_id, need, stock, short)
            for ln in order_lines:
                allocated[ln["line_id"]] = 0
                if ln["ordered"]:
                    shortages[ln["line_id"]] = evidence
            continue
        for ln in order_lines:
            allocated[ln["line_id"]] = ln["ordered"]
        for p, n in need.items():
            stock[p] = stock.get(p, 0) - n
    return AllocationResult(allocated, stock, shortages, sequence, "heuristic")


def whole_order_evidence(order_id, need, stock, short) -> str:
    parts = ", ".join(f"{need[p]} {p} ({stock.get(p, 0)} left)" for p in short)
    return f"Whole-order policy: order {order_id} needs {parts}, so none of it ships."


def fill_ratios(lines, stock) -> dict[str, Fraction]:
    demand: dict[str, int] = defaultdict(int)
    for ln in lines:
        demand[ln["product_id"]] += ln["ordered"]
    return {
        p: min(Fraction(1), Fraction(stock.get(p, 0), d)) if d else Fraction(0)
        for p, d in demand.items()
    }


def proportional_piece(lines, stock) -> AllocationResult:
    """Fair share per product: floor(r × ordered) per line, then the leftover pieces one at a
    time to the customer furthest below target (customer = customer_id, else the order ID)."""
    ratio = fill_ratios(lines, stock)
    allocated = {ln["line_id"]: int(ratio[ln["product_id"]] * ln["ordered"]) for ln in lines}
    by_product: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ln in lines:
        by_product[ln["product_id"]].append(ln)
    for p, plines in sorted(by_product.items()):
        used = sum(allocated[ln["line_id"]] for ln in plines)
        left = stock.get(p, 0) - used
        target: dict[str, Fraction] = defaultdict(Fraction)
        got: dict[str, int] = defaultdict(int)
        open_lines: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for ln in sorted(plines, key=lambda x: line_key(x, "order_date_then_value")):
            target[ln["customer_id"]] += ratio[p] * ln["ordered"]
            got[ln["customer_id"]] += allocated[ln["line_id"]]
            if allocated[ln["line_id"]] < ln["ordered"]:
                open_lines[ln["customer_id"]].append(ln)

        def entry(c, got=got, target=target, open_lines=open_lines):
            return (
                Fraction(got[c]) / target[c],
                line_key(open_lines[c][0], "order_date_then_value"),
                c,
            )

        heap = [entry(c) for c in open_lines if target[c] > 0]
        heapq.heapify(heap)
        while left > 0 and heap:
            _, _, c = heapq.heappop(heap)
            ln = open_lines[c][0]
            allocated[ln["line_id"]] += 1
            got[c] += 1
            left -= 1
            if allocated[ln["line_id"]] == ln["ordered"]:
                open_lines[c].pop(0)
            if open_lines[c]:
                heapq.heappush(heap, entry(c))
        stock[p] = left
    shortages = {
        ln["line_id"]: (
            f"Fair-share heuristic: {ln['product_id']} filled to "
            f"{float(ratio[ln['product_id']]):.0%} of demand for every customer."
        )
        for ln in lines
        if allocated[ln["line_id"]] < ln["ordered"]
    }
    for p in by_product:
        stock.setdefault(p, 0)
    sequence = [
        ln["line_id"] for ln in sorted(lines, key=lambda x: line_key(x, "order_date_then_value"))
    ]
    return AllocationResult(allocated, stock, shortages, sequence, "heuristic")


def proportional_whole(lines, stock) -> AllocationResult:
    """Repeatedly accept, among orders that still fit, the order whose customer is furthest below
    target (allocated pieces ÷ target pieces summed over products), tiebroken like whole-order
    greedy. Stock only falls, so an order that stops fitting is dropped for good."""
    ratio = fill_ratios(lines, stock)
    orders = group_orders(lines)
    target: dict[str, Fraction] = defaultdict(Fraction)
    for ln in lines:
        target[ln["customer_id"]] += ratio[ln["product_id"]] * ln["ordered"]
    pending: dict[str, list[str]] = defaultdict(list)
    for oid in sorted(orders, key=lambda o: order_key(orders[o], "order_date_then_value")):
        pending[orders[oid][0]["customer_id"]].append(oid)
    got: dict[str, int] = defaultdict(int)
    allocated: dict[str, int] = {ln["line_id"]: 0 for ln in lines}
    shortages: dict[str, str] = {}
    sequence: list[str] = []

    def fits(oid):
        return all(n <= stock.get(p, 0) for p, n in needs(orders[oid]).items())

    while True:
        best = None
        for c, oids in pending.items():
            if target[c] <= 0:
                continue
            while oids and not fits(oids[0]):
                oid = oids.pop(0)
                need = needs(orders[oid])
                short = sorted(p for p, n in need.items() if n > stock.get(p, 0))
                evidence = whole_order_evidence(oid, need, stock, short)
                for ln in orders[oid]:
                    if ln["ordered"]:
                        shortages[ln["line_id"]] = evidence
            if not oids:
                continue
            key = (
                Fraction(got[c]) / target[c],
                order_key(orders[oids[0]], "order_date_then_value"),
            )
            if best is None or key < best[0]:
                best = (key, c)
        if best is None:
            break
        oid = pending[best[1]].pop(0)
        for ln in orders[oid]:
            allocated[ln["line_id"]] = ln["ordered"]
            got[best[1]] += ln["ordered"]
            sequence.append(ln["line_id"])
        for p, n in needs(orders[oid]).items():
            stock[p] = stock.get(p, 0) - n
    for c, oids in pending.items():  # zero-target customers never receive stock
        for oid in oids:
            for ln in orders[oid]:
                if ln["ordered"]:
                    shortages.setdefault(
                        ln["line_id"], f"Fair-share heuristic: customer {c} has no stock target."
                    )
    return AllocationResult(allocated, stock, shortages, sequence, "heuristic")


CP_STATUS = {
    cp_model.OPTIMAL: "optimal",
    cp_model.FEASIBLE: "feasible",
    cp_model.INFEASIBLE: "infeasible",
    cp_model.MODEL_INVALID: "model_invalid",
    cp_model.UNKNOWN: "unknown",
}


def optimized(
    lines, stock, policy, objective, respect_order_date, time_limit_s
) -> AllocationResult:
    model = cp_model.CpModel()
    a: dict[str, Any] = {}
    if policy == "whole_order":
        for oid, order_lines in sorted(group_orders(lines).items()):
            x = model.new_bool_var(f"x[{oid}]")
            for ln in order_lines:
                a[ln["line_id"]] = x * ln["ordered"]
    else:
        for ln in lines:
            a[ln["line_id"]] = model.new_int_var(0, ln["ordered"], f"a[{ln['line_id']}]")
    by_product: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for ln in lines:
        by_product[ln["product_id"]].append(ln)
    for p, plines in by_product.items():
        model.add(sum(a[ln["line_id"]] for ln in plines) <= stock.get(p, 0))
    if respect_order_date:
        # s[p, d] = "some line of p dated on or before d is short"; monotone in d. A short line
        # forces s at its date, and s at an earlier date forces newer lines to zero.
        for p, plines in by_product.items():
            dates = sorted({ln["order_date"] for ln in plines})
            s = {d: model.new_bool_var(f"s[{p},{d}]") for d in dates}
            for prev, nxt in zip(dates, dates[1:], strict=False):
                model.add_implication(s[prev], s[nxt])
            for ln in plines:
                d = ln["order_date"]
                model.add(a[ln["line_id"]] == ln["ordered"]).only_enforce_if(s[d].Not())
                i = dates.index(d)
                if i:
                    model.add(a[ln["line_id"]] == 0).only_enforce_if(s[dates[i - 1]])
    revenue = sum(a[ln["line_id"]] * ln["value"] for ln in lines)
    goals: list[tuple[str, Any]] = [("revenue_cents", revenue)]
    if objective == "priority_then_revenue":
        weighted = sum(a[ln["line_id"]] * ln["priority"] for ln in lines)
        goals.insert(0, ("priority_weighted_pieces", weighted))
    # Greedy hint (CP-SAT Primer): the default rule is always feasible without the date rule.
    hint = greedy_piece(lines, dict(stock), "order_date_then_value").allocated
    if policy == "piece" and not respect_order_date:
        for ln in lines:
            model.add_hint(a[ln["line_id"]], hint[ln["line_id"]])

    stages: list[AllocationStage] = []
    notes: list[str] = []
    solver = cp_model.CpSolver()
    solver.parameters.num_workers = 1
    solver.parameters.random_seed = 0
    solver.parameters.max_time_in_seconds = time_limit_s
    values: dict[str, int] | None = None
    for i, (name, expr) in enumerate(goals):
        model.maximize(expr)
        began = time.perf_counter()
        status = solver.solve(model)
        label = CP_STATUS.get(status, "unknown")
        found = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        stages.append(
            AllocationStage(
                name,
                label,
                int(solver.objective_value) if found else 0,
                int(solver.best_objective_bound) if found else None,
                round(time.perf_counter() - began, 4),
            )
        )
        if not found:
            break
        values = {ln["line_id"]: int(solver.value(a[ln["line_id"]])) for ln in lines}
        if i + 1 < len(goals):
            best = int(solver.objective_value)
            model.add(expr >= best)
            if status != cp_model.OPTIMAL:
                notes.append(
                    f"{name} was not proven optimal; the next stage keeps it at least {best}."
                )
            model.clear_hints()
            for ln in lines:
                if isinstance(a[ln["line_id"]], cp_model.IntVar):
                    model.add_hint(a[ln["line_id"]], values[ln["line_id"]])
    if values is None:  # no solution in budget (an all-zero allocation is always feasible)
        values = {ln["line_id"]: 0 for ln in lines}
        notes.append("CP-SAT found no allocation within the time limit; nothing was allocated.")
    for ln in lines:
        stock[ln["product_id"]] = stock.get(ln["product_id"], 0) - values[ln["line_id"]]
    final = stages[-1].status
    shortages = {
        ln["line_id"]: (
            f"Optimized allocation (CP-SAT, {final}) gave {ln['product_id']} to other lines "
            "to maximize the objective."
        )
        for ln in lines
        if values[ln["line_id"]] < ln["ordered"]
    }
    sequence = [
        ln["line_id"] for ln in sorted(lines, key=lambda x: line_key(x, "order_date_then_value"))
    ]
    return AllocationResult(values, stock, shortages, sequence, "cp_sat", stages, notes)
