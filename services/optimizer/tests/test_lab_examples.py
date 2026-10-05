"""The bundled Solver Lab examples' stated observations (`app/labs`), asserted on real solves."""

import json
import math
from pathlib import Path

import pytest

from fillrate_optimizer.lab import CandidateRoute, LabInstance, run_lab, validate_plan
from fillrate_optimizer.lab import examples as lab_examples
from fillrate_optimizer.lab.travel import lab_matrices

ROOT = Path(__file__).resolve().parents[3] / "examples"
SEEDS = range(4)


def with_seed(instance: LabInstance, seed: int) -> LabInstance:
    return instance.model_copy(update={"solver": instance.solver.model_copy(update={"seed": seed})})


@pytest.fixture(scope="module")
def runs():
    builds = {
        "dimensions": lab_examples.dimensions(True),
        "volume": lab_examples.dimensions(False),
        "fleet": lab_examples.fleet(True),
        "trucks": lab_examples.fleet(False),
    }
    return {
        (name, seed): run_lab(with_seed(b, seed)) for name, b in builds.items() for seed in SEEDS
    }


@pytest.mark.parametrize("name", list(lab_examples.EXAMPLES))
def test_example_files_match_the_generator(name):
    stored = json.loads((ROOT / name).read_text())
    assert stored == lab_examples.EXAMPLES[name]().model_dump(mode="json", exclude_none=True)
    # The stored file parses back to the same instance (no default fills a dropped null).
    assert LabInstance.model_validate(stored) == lab_examples.EXAMPLES[name]()


def test_dimensions_example_is_planar_abstract_units():
    instance = lab_examples.dimensions()
    assert instance.coordinates == "planar"
    assert lab_matrices(instance).distance_unit == "planar units"
    # Coordinates are abstract: nothing is a latitude/longitude pair.
    assert all(c.lat is None and c.lon is None for c in instance.clients)


def test_weight_sets_the_truck_count(runs):
    instance = lab_examples.dimensions()
    weight = sum(c.delivery["weight"] for c in instance.clients)
    volume = sum(c.delivery["volume"] for c in instance.clients)
    assert (weight, volume) == (2_860, 4_970)
    for seed in SEEDS:
        result = runs["dimensions", seed]
        assert result.validated_feasible and result.solver_feasible
        # 3 trucks = ceil(2,860 kg / 1,200 kg); volume alone would need ceil(4,970 / 4,000) = 2.
        assert result.totals.routes == math.ceil(weight / 1_200) == 3
        assert max(r.utilization["weight"] for r in result.routes) >= 0.85
        assert max(r.utilization["volume"] for r in result.routes) < 0.6
        assert result.objective.total == runs["dimensions", 0].objective.total


def test_without_weight_two_trucks_suffice_but_overload_weight(runs):
    two_dims = lab_examples.dimensions()
    for seed in SEEDS:
        result = runs["volume", seed]
        assert result.validated_feasible and result.totals.routes == 2
        assert result.objective.total < runs["dimensions", seed].objective.total
        assert result.problem_fingerprint != runs["dimensions", seed].problem_fingerprint
        # The same routes, checked against the two-dimension instance: every truck is too heavy.
        plan = validate_plan(
            two_dims,
            lab_matrices(two_dims),
            [
                CandidateRoute(r.vehicle_type, [v.client_id for v in r.visits])
                for r in result.routes
            ],
        )
        overloads = [v for v in plan.violations if v.code == "over_capacity"]
        assert {v.dimension for v in plan.violations} == {"weight"}
        assert len(overloads) == 2
        assert all(r.load["weight"] > 1_200 for r in plan.routes)


def test_mixed_fleet_uses_every_van_and_one_truck(runs):
    for seed in SEEDS:
        result = runs["fleet", seed]
        assert result.validated_feasible
        assert result.units.distance == "meters"
        used = {f.vehicle_type: (f.used, f.available) for f in result.fleet}
        assert used == {"van": (3, 3), "box-truck": (1, 3)}
        assert all(r.load["pallets"] <= 6 for r in result.routes if r.vehicle_type == "van")
        assert result.objective.fixed_cost == 3 * 15_000 + 40_000
        assert result.objective.total == runs["fleet", 0].objective.total


def test_trucks_only_costs_more_for_the_same_deliveries(runs):
    for seed in SEEDS:
        mixed, trucks = runs["fleet", seed], runs["trucks", seed]
        assert trucks.validated_feasible
        assert {f.vehicle_type: f.used for f in trucks.fleet} == {"box-truck": 3}
        assert trucks.totals.load == mixed.totals.load == {"pallets": 30}
        assert trucks.objective.total > mixed.objective.total
        assert trucks.objective.fixed_cost > mixed.objective.fixed_cost
