"""Monetary ordering must match exact cents, including degenerate rates."""

from fractions import Fraction

import numpy as np
import pytest
from pydantic import ValidationError
from pyvrp.constants import MAX_VALUE

from fillrate_optimizer.loads import (
    PartitionProblem,
    PartitionVisit,
    check_objective_range,
    monetary_objective,
    solve_partition,
)
from fillrate_optimizer.model import RunSettings


@pytest.mark.parametrize("truck,mile", [(25000, 175), (1, 1), (0, 125), (100, 0), (0, 0)])
def test_exact_cost_and_ordering(truck, mile):
    objective = monetary_objective(truck, mile)
    for trucks, meters in [(1, 1), (2, 201168), (17, 1234567)]:
        score = trucks * objective.truck_penalty + meters * objective.distance_cost
        assert Fraction(score * objective.cents_numerator, objective.cents_denominator) == (
            trucks * truck + Fraction(meters * mile * 125, 201168)
        )


def test_cost_requires_both_rates_and_exact_integers():
    for fields in [
        {},
        {"cost_per_truck_cents": 1},
        {"cost_per_mile_cents": 2},
        {"cost_per_truck_cents": 1.5, "cost_per_mile_cents": 2},
    ]:
        with pytest.raises(ValidationError):
            RunSettings(objective="cost", **fields)
    assert (
        RunSettings(objective="cost", cost_per_truck_cents=0, cost_per_mile_cents=0).objective
        == "cost"
    )


def test_scaled_cost_range_is_checked():
    with pytest.raises(ValueError, match="safe bound"):
        check_objective_range(2, 1, 100, MAX_VALUE // 100)


@pytest.mark.parametrize("truck_cents,expected_routes", [(0, 2), (100, 1)])
def test_cost_rates_change_selected_plan(truck_cents, expected_routes):
    # Combining customers travels 101m; separate departures travel 2m.
    # At 100 cents/mile, a 100-cent truck cost makes combining cheaper.
    objective = monetary_objective(truck_cents, 100)
    result = solve_partition(
        PartitionProblem(
            distance=np.array([[0, 1, 1], [1, 0, 100], [1, 100, 0]], dtype=np.int64),
            visits=[PartitionVisit("a", 1, 1), PartitionVisit("b", 2, 1)],
            capacity=2,
            max_leg_m=100,
            truck_penalty=objective.truck_penalty,
            distance_cost=objective.distance_cost,
            max_iterations=200,
            max_runtime_s=2,
        )
    )
    assert result.solver_feasible
    assert len(result.routes) == expected_routes
