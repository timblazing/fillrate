"""M4 fixtures: clustering strategies, inventory sweeps, explorer jobs."""

import h3
import numpy as np
import pytest

from fillrate_optimizer.clustering import Clusterer
from fillrate_optimizer.explorer import ExplorerError, h3_rows, run_explorer
from fillrate_optimizer.model import ExplorerSettings, RunSettings
from fillrate_optimizer.pipeline import PipelineError, allocated_locations, run_pipeline

from .conftest import east, north
from .test_pipeline import FAST, run, scenario

FAR = [("A", east(20)), ("B", east(30)), ("C", east(-900)), ("D", north(700))]


def spread():
    return scenario(
        FAR,
        [(f"O{i}", loc, "2026-09-01", "P", 2, 100) for i, (loc, _) in enumerate(FAR)],
        [("P", 100)],
    )


def test_h3_cells_are_deterministic_and_match_the_library():
    ids = [loc for loc, _ in FAR]
    lat_lon = np.array([at for _, at in FAR])
    clusterer = Clusterer(
        ids,
        lat_lon,
        dict.fromkeys(ids, 1),
        circuity=1.2,
        max_diameter_m=None,
        max_stops=50,
        seed=0,
        n_init=1,
    )
    first = clusterer.run_h3(2).partitions
    assert first == clusterer.run_h3(2).partitions
    cells = {}
    for id_, (lat, lon) in zip(ids, lat_lon, strict=True):
        cells.setdefault(h3.latlng_to_cell(lat, lon, 2), []).append(id_)
    assert sorted(map(sorted, cells.values())) == sorted(first)


def test_h3_repair_uses_the_same_bounded_repair():
    # Resolution 0 puts A and B (10 mi apart) in one cell with nothing else nearby; a 5 mi
    # diameter limit must split them with the recorded repair seed.
    ids, lat_lon = ["A", "B"], np.array([east(20), east(30)])
    clusterer = Clusterer(
        ids,
        lat_lon,
        {"A": 1, "B": 1},
        circuity=1.0,
        max_diameter_m=8_000,
        max_stops=50,
        seed=0,
        n_init=1,
    )
    result = clusterer.run_h3(0)
    assert result.raw == [["A", "B"]]
    assert result.partitions == [["A"], ["B"]]
    assert [s.reason for s in result.repairs] == ["diameter"]


def test_pipeline_records_h3_strategy_and_resolution():
    out = run(spread(), cluster_strategy="h3", h3_resolution=1)
    assert out.summary.clustering.strategy == "h3"
    assert out.summary.clustering.h3_resolution == 1
    assert out.summary.clustering.requested_k is None
    assert out.summary.validity == "valid"


def test_no_clustering_baseline_is_one_partition_with_both_bounds():
    out = run(spread(), cluster_strategy="none")
    assert out.summary.clustering.strategy == "none"
    assert len(out.summary.clusters) == 1
    totals = out.summary.totals
    assert totals.capacity_lower_bound == totals.sum_cluster_lower_bounds


def test_no_clustering_baseline_is_ineligible_over_max_stops():
    with pytest.raises(PipelineError) as error:
        run(spread(), cluster_strategy="none", max_stops=3)
    assert error.value.code == "baseline_ineligible"


def test_no_clustering_baseline_respects_an_enabled_diameter_limit():
    with pytest.raises(PipelineError) as error:
        run(spread(), cluster_strategy="none", max_cluster_diameter_m=100_000)
    assert error.value.code == "baseline_ineligible"


def test_inventory_percent_scales_stock_and_reconciles():
    doc = scenario(
        [("A", east(20))],
        [("O1", "A", "2026-09-01", "P", 10, 100)],
        [("P", 10)],
    )
    out = run(doc, inventory_percent=55)
    product = out.summary.products[0]
    assert product.starting_inventory == 5  # floor(10 × 0.55)
    assert product.allocated == 5 and product.unselected == 5


def test_explorer_population_matches_the_pipeline_cluster_stage():
    doc = scenario(
        [("A", east(20)), ("B", east(30)), ("U", None)],
        [
            ("O1", "A", "2026-09-01", "P", 2, 100),
            ("O2", "B", "2026-09-02", "P", 2, 100),
            ("O3", "U", "2026-09-01", "P", 2, 100),
        ],
        [("P", 2)],  # only O1 gets stock
    )
    assert allocated_locations(doc, FAST) == ["A"]
    out = run(doc)
    assert out.summary.totals.locations == 1


def test_explorer_job_reports_k_rows_h3_rows_and_agreement():
    doc = spread()
    summary = run_explorer(
        doc,
        ExplorerSettings(base=RunSettings(), ks=[1, 2], seeds=[0, 1, 2], h3_resolutions=[1, 2]),
        max_tasks=25,
    )
    assert summary.ks == [1, 2] and summary.tasks == 2 * 3 + 2
    assert [row.k for row in summary.per_k] == [1, 2]
    assert summary.per_k[0].stability_raw == pytest.approx(1.0)
    assert [row.resolution for row in summary.h3] == [1, 2]
    assert all(row.stability == "deterministic" for row in summary.h3)
    assert {loc.id for loc in summary.locations} == {"A", "B", "C", "D"}
    # k = 1 puts every location with peers: agreement 1 everywhere.
    assert all(loc.agreement_raw == pytest.approx(1.0) for loc in summary.locations)


def test_explorer_counts_h3_tasks_toward_the_cap():
    with pytest.raises(ExplorerError) as error:
        run_explorer(
            spread(),
            ExplorerSettings(ks=[1, 2], seeds=list(range(10)), h3_resolutions=[1, 2, 3]),
            max_tasks=20,
        )
    assert error.value.code == "too_many_tasks"
    assert "23 clustering tasks" in str(error.value)


def test_h3_rows_have_a_consistent_inertia():
    ids = [loc for loc, _ in FAR]
    rows = h3_rows(
        ids, np.array([at for _, at in FAR]), [0, 3], circuity=1.2, max_diameter_m=None, seed=0
    )
    assert rows[0]["inertia"] >= rows[1]["inertia"] - 1e-12


def test_lesson_scenario_is_current_and_ships_every_allocated_piece():
    import json
    from pathlib import Path

    from fillrate_optimizer import lesson
    from fillrate_optimizer.model import ScenarioDocument

    path = Path(__file__).resolve().parents[3] / "examples/lesson-fulfillment.json"
    document = json.loads(path.read_text())
    assert document["scenario"] == lesson.build().model_dump(mode="json")
    assert document["settings"] == lesson.SETTINGS.model_dump(mode="json")
    out = run_pipeline(ScenarioDocument.model_validate(document["scenario"]), lesson.SETTINGS)
    assert len(document["scenario"]["orders"]) == 2_000
    assert out.summary.validity == "valid" and out.summary.coverage == "complete"
    # Scarce stock is the lesson's first observation: some revenue is short before routing.
    assert out.summary.totals.allocated_cents < out.summary.totals.ordered_cents
    assert out.summary.totals.planned_cents == out.summary.totals.allocated_cents
