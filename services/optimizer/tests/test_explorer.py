"""k explorer statistics (spec §8a "Cluster stability", §9 task bounds)."""

import numpy as np
import pytest

from fillrate_optimizer.explorer import ExplorerError, agreement, default_ks, explore, stability


def blobs(centers, per, spread=0.05, seed=0):
    rng = np.random.default_rng(seed)
    points = [np.array(c) + rng.normal(0, spread, (per, 2)) for c in centers]
    lat_lon = np.vstack(points)
    return [f"L{i:03d}" for i in range(len(lat_lon))], lat_lon


THREE = [(35.0, -90.0), (40.0, -80.0), (30.0, -97.0)]


def test_well_separated_blobs_are_stable_and_agree():
    ids, lat_lon = blobs(THREE, 8)
    out = explore(ids, lat_lon, circuity=1.2, max_diameter_m=None, ks=[2, 3], selected_k=3)
    assert out.tasks == 20
    by_k = {s.k: s for s in out.per_k}
    assert by_k[3].stability_raw == pytest.approx(1.0)
    assert by_k[3].raw_cluster_count == 3
    assert min(by_k[3].inertia_by_seed) < min(by_k[2].inertia_by_seed)
    assert all(loc.agreement_raw == pytest.approx(1.0) for loc in out.locations)
    # Repaired statistics equal raw ones when the diameter policy is off.
    assert by_k[3].stability_repaired == by_k[3].stability_raw
    assert by_k[3].diameter_repairs_by_seed == [0] * 10


def test_task_cap_is_enforced_not_truncated():
    ids, lat_lon = blobs(THREE, 8)
    with pytest.raises(ExplorerError) as error:
        explore(ids, lat_lon, circuity=1.2, max_diameter_m=None, ks=list(range(3, 13)))
    assert error.value.code == "too_many_tasks"
    assert "100 clustering tasks" in str(error.value)


def test_k_above_distinct_locations_is_rejected():
    ids, lat_lon = blobs([(35.0, -90.0)], 3, spread=0.0)
    with pytest.raises(ExplorerError) as error:
        explore(ids, lat_lon, circuity=1.2, max_diameter_m=None, ks=[2], seeds=[0])
    assert error.value.code == "bad_k"


def test_singleton_reference_cluster_has_no_agreement():
    reference = np.array([0, 0, 1])
    assert agreement(reference, [reference, np.array([5, 5, 7])]) == [1.0, 1.0, None]


def test_agreement_ignores_label_numbering():
    reference = np.array([0, 0, 1, 1])
    other = np.array([1, 1, 0, 0])
    assert agreement(reference, [reference, other]) == [1.0, 1.0, 1.0, 1.0]
    partial = np.array([0, 1, 1, 1])
    assert agreement(reference, [reference, partial]) == [0.5, 0.5, 1.0, 1.0]


def test_ari_is_not_clipped_and_needs_two_seeds():
    assert stability([np.array([0, 1])]) is None
    score = stability([np.array([0, 0, 1, 1]), np.array([0, 1, 0, 1])])
    assert score is not None and score < 0


def test_diameter_repair_is_counted_and_reported_separately():
    ids, lat_lon = blobs(THREE, 6)
    out = explore(
        ids, lat_lon, circuity=1.2, max_diameter_m=200_000, ks=[1], seeds=[0, 1], selected_k=1
    )
    stats = out.per_k[0]
    assert stats.raw_cluster_count == 1
    assert stats.effective_cluster_count >= 3
    assert all(n >= 2 for n in stats.diameter_repairs_by_seed)


def test_default_ks_near_selected():
    assert default_ks(None, 10) == [1, 2]
    assert default_ks(4, 10) == [4, 5]
    assert default_ks(10, 10) == [9, 10]
