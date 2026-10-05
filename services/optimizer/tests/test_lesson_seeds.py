"""The seeds lesson's "what to look for" claims (`app/learn/seed-sensitivity`)."""

import json
from pathlib import Path

import pytest

from fillrate_optimizer import lesson_seeds
from fillrate_optimizer.explorer import run_explorer
from fillrate_optimizer.model import ExplorerSettings, RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import run_pipeline

SEEDS = [0, 1, 2, 3, 4, 5]


@pytest.fixture(scope="module")
def scenario() -> ScenarioDocument:
    return lesson_seeds.build()


@pytest.fixture(scope="module")
def runs(scenario):
    """One real pipeline run per k-means seed, as the lesson's sweep makes."""
    return {
        seed: run_pipeline(
            scenario, lesson_seeds.SETTINGS.model_copy(update={"kmeans_seed": seed})
        ).summary
        for seed in SEEDS
    }


def partition(summary) -> tuple:
    return tuple(sorted(tuple(sorted(c.location_ids)) for c in summary.clusters))


def miles(summary) -> int:
    return round(summary.totals.loaded_distance_m / 1609.344)


def test_example_file_matches_the_generator():
    path = Path(__file__).resolve().parents[3] / "examples/lesson-seeds.json"
    document = json.loads(path.read_text())
    assert document["scenario"] == lesson_seeds.build().model_dump(mode="json")
    assert document["settings"] == lesson_seeds.SETTINGS.model_dump(mode="json")
    RunSettings.model_validate(document["settings"])


def test_the_starting_values_are_one_kmeans_start_and_an_iteration_budget(scenario):
    s = lesson_seeds.SETTINGS
    assert (s.k, s.kmeans_n_init, s.solver_max_iterations) == (5, 1, 300)
    assert (len(scenario.locations), len(scenario.orders)) == (60, 60)


def test_step_1_every_seed_gives_a_valid_complete_plan_at_or_above_the_lower_bound(runs):
    for seed, summary in runs.items():
        assert (summary.validity, summary.coverage) == ("valid", "complete"), seed
        assert summary.unplanned == [], seed
        assert summary.totals.capacity_lower_bound == 17, seed
        assert summary.totals.trucks >= summary.totals.capacity_lower_bound, seed
        # Splitting freight into clusters can only cost trailers.
        assert summary.totals.sum_cluster_lower_bounds >= summary.totals.capacity_lower_bound


def test_step_1_different_seeds_cut_the_stops_into_different_clusters(runs):
    assert len({partition(runs[seed]) for seed in SEEDS}) == len(SEEDS)
    sizes = {seed: sorted(len(c.location_ids) for c in runs[seed].clusters) for seed in SEEDS}
    assert sizes[0] == [8, 11, 13, 13, 15]
    assert sizes[2] == [7, 7, 13, 15, 18]


def test_step_2_seed_choice_changes_trucks_and_miles(runs):
    assert {seed: runs[seed].totals.trucks for seed in SEEDS} == {
        0: 19, 1: 20, 2: 19, 3: 19, 4: 19, 5: 19
    }  # fmt: skip
    assert {seed: miles(runs[seed]) for seed in SEEDS} == {
        0: 3581, 1: 3654, 2: 3574, 3: 3869, 4: 3545, 5: 3634
    }  # fmt: skip
    best = min(SEEDS, key=lambda s: (runs[s].totals.trucks, runs[s].totals.loaded_distance_m))
    worst = max(SEEDS, key=lambda s: (runs[s].totals.trucks, runs[s].totals.loaded_distance_m))
    assert (best, worst) == (4, 1)
    assert miles(runs[3]) > 1.09 * miles(runs[4])  # about 9% more loaded miles from the seed alone


def test_step_2_iteration_budget_runs_repeat_exactly(scenario, runs):
    again = run_pipeline(scenario, lesson_seeds.SETTINGS.model_copy(update={"kmeans_seed": 3}))
    first = runs[3]
    assert partition(again.summary) == partition(first)
    assert again.summary.totals == first.totals
    assert [(t.cluster_id, t.load, t.distance_m, [v.location_id for v in t.visits])
            for t in again.summary.trucks] == [
        (t.cluster_id, t.load, t.distance_m, [v.location_id for v in t.visits])
        for t in first.trucks
    ]  # fmt: skip
    # The iteration budget is a count, not a clock: every cluster runs exactly 300 iterations.
    assert {c.iterations for c in first.clusters} == {300}


def test_step_2_solver_seed_does_not_change_this_plan(scenario, runs):
    for solver_seed in (1, 2):
        out = run_pipeline(
            scenario, lesson_seeds.SETTINGS.model_copy(update={"solver_seed": solver_seed})
        ).summary
        assert out.totals == runs[0].totals


def test_step_3_explorer_shows_the_seeds_disagree(scenario):
    summary = run_explorer(
        scenario,
        ExplorerSettings(
            base=lesson_seeds.SETTINGS, ks=[5, 6], seeds=list(range(10)), selected_k=5
        ),
        max_tasks=25,
    )
    stability = {row.k: round(row.stability_raw, 2) for row in summary.per_k}
    assert stability == {5: 0.56, 6: 0.62}  # 1.00 would mean every seed agrees
    agreement = [loc.agreement_raw for loc in summary.locations]
    assert max(agreement) < 0.85 and min(agreement) < 0.45  # no stop is placed alike by every seed
