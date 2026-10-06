"""Opt-in checks against a live Valhalla (docs/valhalla.md). Skipped unless VALHALLA_URL is set.

Run with the lines from `deploy/valhalla/prepare.sh env` exported (the endpoint must be reachable
from the host, for example a loopback port). The coordinates assume a deployment covering
Tennessee, Mississippi and Arkansas; Birmingham, AL and Denver, CO must be outside it.
"""

from __future__ import annotations

import os
from dataclasses import replace

import numpy as np
import pytest

from fillrate_optimizer.travel import haversine_m
from fillrate_optimizer.travel_provider import TravelNode
from fillrate_optimizer.valhalla import (
    ProviderCancelled,
    ProviderError,
    ValhallaConfig,
    ValhallaTravel,
    post_json,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("VALHALLA_URL"), reason="set VALHALLA_URL (and VALHALLA_*) for live checks"
)

CITIES = {
    "memphis": (35.1495, -90.0490),
    "nashville": (36.1627, -86.7816),
    "jackson_tn": (35.6145, -88.8139),
    "tupelo": (34.2576, -88.7034),
    "jackson_ms": (32.2988, -90.1848),
    "little_rock": (34.7465, -92.2896),
    "jonesboro": (35.8423, -90.7043),
}
OUTSIDE = {"birmingham_al": (33.5186, -86.8104), "denver_co": (39.7392, -104.9903)}


def nodes(names, table=CITIES):
    return [TravelNode(id=name, lat=table[name][0], lon=table[name][1]) for name in names]


@pytest.fixture(scope="module")
def config():
    return ValhallaConfig.from_env()


@pytest.fixture(scope="module")
def matrix(config):
    return ValhallaTravel(config).matrix(nodes(CITIES))


def test_truck_matrix_is_complete_directed_and_road_scaled(matrix, config):
    distances = np.array(matrix.distances, dtype=float)
    durations = np.array(matrix.durations, dtype=float)
    n = len(CITIES)
    assert matrix.provider == "valhalla" and matrix.profile == "truck"
    assert matrix.options["costing_options"] == config.costing_options
    assert matrix.options["coverage_check"] == "locate"
    # Every pair inside coverage has a road path (a null here would be a false "unreachable").
    assert not np.isnan(distances).any() and not np.isnan(durations).any()
    assert np.all(np.diag(distances) == 0)
    spatial = haversine_m(np.array([CITIES[name] for name in CITIES])) / 1000
    off = ~np.eye(n, dtype=bool)
    ratio = distances[off] / spatial[off]
    assert ratio.min() >= 1.0 and ratio.max() < 1.8, ratio
    speed = distances[off] / (durations[off] / 3600)
    assert speed.min() > 40 and speed.max() < 110, speed  # km/h for a truck
    # Directed: at least one pair differs by direction.
    assert np.abs(distances - distances.T).max() > 0.01
    memphis, nashville = list(CITIES).index("memphis"), list(CITIES).index("nashville")
    assert 300 < distances[memphis, nashville] < 380


def test_block_partitioning_reassembles_the_same_matrix(matrix, config):
    small = ValhallaTravel(replace(config, block_size=3)).matrix(nodes(CITIES))
    full = np.array(matrix.distances, dtype=float)
    blocked = np.array(small.distances, dtype=float)
    # CostMatrix searches each request's sources and targets jointly, so a pair's chosen path can
    # change with the block it is in: observed on 2026-10-05, Jackson MS -> Tupelo was 347.2 km in
    # one 7x7 block and 366.0 km in 3x3 blocks (5.4%). Snapshots record the block size for this.
    assert np.allclose(blocked, full, rtol=0.08, atol=0.5)
    assert small.options["block_size"] == 3 and matrix.options["block_size"] == config.block_size


def test_progress_counts_completed_blocks(config):
    seen = []
    ValhallaTravel(replace(config, block_size=2)).matrix(
        nodes(["memphis", "nashville", "tupelo"]),
        progress=lambda done, total: seen.append((done, total)),
    )
    assert seen[0] == (0, 4) and seen[-1] == (4, 4)


def test_stops_outside_coverage_are_unreachable_not_errors(config):
    names = ["memphis", "nashville", "birmingham_al"]
    snapshot = ValhallaTravel(config).matrix(nodes(names, {**CITIES, **OUTSIDE}))
    assert snapshot.distances[2] == [None, None, 0]
    assert [row[2] for row in snapshot.distances] == [None, None, 0]
    assert snapshot.distances[0][1] is not None
    assert snapshot.warnings[0]["code"] == "outside_coverage"
    assert snapshot.warnings[0]["nodes"] == ["birmingham_al"]


def test_far_outside_coverage_does_not_trip_the_extent_limit(config):
    snapshot = ValhallaTravel(config).matrix(
        nodes(["memphis", "little_rock", "denver_co"], {**CITIES, **OUTSIDE})
    )
    assert snapshot.distances[0][2] is None and snapshot.distances[0][1] is not None


def locate_only(url, body, timeout):
    if url.endswith("/locate"):
        return post_json(url, body, timeout)
    pytest.fail("no matrix request may be sent")


def test_server_rejections_are_provider_errors_not_unreachable_edges(config):
    # Client limit above the server's 1,000 km truck max_matrix_distance: the server refuses.
    bristol_texarkana = [
        TravelNode(id="bristol", lat=36.5951, lon=-82.1887),
        TravelNode(id="texarkana", lat=33.4418, lon=-94.0377),
    ]
    loose = replace(config, max_matrix_distance_m=5_000_000)
    with pytest.raises(ProviderError, match="HTTP 400"):
        ValhallaTravel(loose).matrix(bristol_texarkana)
    # The configured client limit refuses the same extent before any request.
    with pytest.raises(ProviderError, match="max_matrix_distance"):
        ValhallaTravel(config, transport=locate_only).matrix(bristol_texarkana)
    # A block above the server's pair limit (2,500) is rejected by the server.
    many = [
        TravelNode(id=f"n{i}", lat=35.0 + (i // 8) * 0.05, lon=-90.0 + (i % 8) * 0.05)
        for i in range(60)
    ]
    oversized = replace(config, block_size=60, max_pairs=3600, max_locations=120)
    with pytest.raises(ProviderError):
        ValhallaTravel(oversized).matrix(many)


def test_cancellation_between_blocks_returns_nothing(config):
    calls = []

    def check():
        calls.append(1)
        if len(calls) > 6:
            raise ProviderCancelled()

    with pytest.raises(ProviderCancelled):
        ValhallaTravel(replace(config, block_size=2)).matrix(nodes(CITIES), check_cancelled=check)
