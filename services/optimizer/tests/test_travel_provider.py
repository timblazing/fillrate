"""Directed-matrix and open-terminal proof for the first M6 increment."""

import copy
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import numpy as np
import pytest

from fillrate_optimizer.loads import (
    LoadProblem,
    PartitionProblem,
    PartitionVisit,
    Stop,
    Truck,
    solve_partition,
    validate_loads,
)
from fillrate_optimizer.pipeline import reachable, validate_cluster
from fillrate_optimizer.travel import distance_matrix_m, prohibited_legs
from fillrate_optimizer.travel_provider import (
    EstimatedTravel,
    ImportedTravel,
    TravelNode,
    TravelSnapshot,
)
from fillrate_optimizer.valhalla import (
    ProviderCancelled,
    ProviderError,
    TransientProviderError,
    ValhallaConfig,
    ValhallaTravel,
    post_json,
)

NODES = [TravelNode(id=name, lat=35, lon=-90 + i / 100) for i, name in enumerate(["D", "A", "B"])]


def document():
    return {
        "nodes": [node.model_dump() for node in NODES],
        "provider": "imported",
        "provider_version": "recorded-truck/1",
        "dataset_revision": "fixture-2026-10-01",
        "profile": "truck",
        "options": {"length": 21.64},
        "distance_units": "kilometers",
        "duration_units": "seconds",
        "distances": [[0, 400, None], [None, 0, 200], [999, 700, 0]],
        "durations": [[0, 4000, None], [None, 0, 2000], [9990, 7000, 0]],
    }


def config(**kwargs):
    return ValhallaConfig(
        url="http://valhalla:8002",
        provider_version="pinned-fixture",
        dataset_revision="osm-fixture-2026-10-01",
        graph_config_hash="sha256:fixture",
        costing_options={"length": 21.64},
        **kwargs,
    )


def mock_response(body):
    """Values identify the original nodes; deliberately shuffle rows and columns."""
    rows = []
    for i, source in enumerate(body["sources"]):
        source_id = round((source["lon"] + 90) * 100)
        row = []
        for j, target in enumerate(body["targets"]):
            target_id = round((target["lon"] + 90) * 100)
            distance = 0 if source_id == target_id else source_id * 10 + target_id + 1
            if source_id == 0 and target_id == 2:
                distance = None
            row.append(
                {
                    "from_index": i,
                    "to_index": j,
                    "distance": distance,
                    "time": None if distance is None else distance * 10,
                }
            )
        rows.append(list(reversed(row)))
    return {
        "units": "kilometers",
        "algorithm": "costmatrix",
        "sources_to_targets": list(reversed(rows)),
    }


def test_import_preserves_direction_units_nulls_and_order():
    raw = document()
    snapshot = ImportedTravel(raw).matrix([NODES[2], NODES[0], NODES[1]])
    assert snapshot.distances == [[0, 999, 700], [None, 0, 400], [200, None, 0]]
    distance, duration = snapshot.effective()
    assert distance.tolist() == [[0, 999000, 700000], [-1, 0, 400000], [200000, -1, 0]]
    assert duration[1, 0] == -1
    assert raw == document()
    assert (
        TravelSnapshot.model_validate_json(snapshot.model_dump_json()).identity == snapshot.identity
    )


@pytest.mark.parametrize(
    "change",
    [
        lambda d: d["nodes"].append(d["nodes"][0]),
        lambda d: d["distances"].pop(),
        lambda d: d["distances"][0].pop(),
        lambda d: d["distances"][0].__setitem__(0, None),
        lambda d: d["distances"][0].__setitem__(1, -1),
        lambda d: d["distances"][0].__setitem__(1, float("nan")),
        lambda d: d["distances"][0].__setitem__(1, float("inf")),
        lambda d: d["distances"][0].__setitem__(1, True),
        lambda d: d["distances"][0].__setitem__(1, "400"),
        lambda d: d["durations"][0].__setitem__(1, None),
        lambda d: d.__setitem__("distance_units", "feet"),
        lambda d: d["nodes"][0].__setitem__("lat", 91),
        lambda d: d["options"].__setitem__("bad", float("nan")),
    ],
)
def test_invalid_imports_are_rejected(change):
    raw = document()
    change(raw)
    with pytest.raises(ValueError):
        ImportedTravel(raw)


def test_coordinate_edits_and_unknown_nodes_cannot_reuse_matrix():
    provider = ImportedTravel(document())
    for node in [TravelNode(id="A", lat=36, lon=-89.99), TravelNode(id="X", lat=35, lon=-90)]:
        with pytest.raises(ValueError, match="matching coordinates"):
            provider.matrix([node])
    with pytest.raises(ValueError, match="unique"):
        provider.matrix([NODES[0], NODES[0]])


def test_conversion_rounds_once_and_keeps_raw_values():
    raw = document()
    raw["distance_units"] = "miles"
    raw["duration_units"] = "minutes"
    raw["distances"][0][1] = 0.001
    raw["durations"][0][1] = 0.125
    snapshot = TravelSnapshot.model_validate(raw)
    d, t = snapshot.effective()
    assert d[0, 1] == 2 and t[0, 1] == 8
    assert snapshot.distances[0][1] == 0.001


def test_identity_changes_with_coordinates_profile_options_dataset_and_conversion_units():
    original = TravelSnapshot.model_validate(document())
    for key, value in [
        ("dataset_revision", "new"),
        ("provider_version", "new"),
        ("profile", "auto"),
        ("options", {"length": 22}),
        ("distance_units", "meters"),
        ("duration_units", "minutes"),
        ("nodes", list(reversed(document()["nodes"]))),
    ]:
        raw = document()
        raw[key] = value
        assert TravelSnapshot.model_validate(raw).identity != original.identity


def test_estimated_provider_matches_existing_distance_boundary_and_records_speed():
    provider = EstimatedTravel(circuity=1.2, speed_m_per_s=10)
    snapshot = provider.matrix(NODES)
    d, t = snapshot.effective()
    assert np.array_equal(d, distance_matrix_m(np.array([(n.lat, n.lon) for n in NODES])))
    assert snapshot.profile == "estimated" and snapshot.options["speed_m_per_s"] == 10
    assert np.array_equal(t, np.rint(np.array(snapshot.distances) / 10).astype(np.int64))
    with pytest.raises(ValueError):
        EstimatedTravel(speed_m_per_s=0)


def test_directed_missing_edges_and_synthetic_terminal_with_real_pyvrp():
    snapshot = TravelSnapshot.model_validate(document())
    distance, _ = snapshot.effective()
    original = distance.copy()
    assert reachable(distance, 500000) == {0, 1, 2}
    assert reachable(distance[np.ix_([0, 2], [0, 2])], 500000) == {0}
    assert prohibited_legs(distance, 500000)[0, 2]
    result = solve_partition(
        PartitionProblem(
            distance=distance,
            visits=[PartitionVisit("A", 1, 1000), PartitionVisit("B", 2, 1000)],
            capacity=5300,
            max_leg_m=500000,
            truck_penalty=1000001,
            max_iterations=100,
            max_runtime_s=2,
        )
    )
    assert result.solver_feasible and result.routes == [[0, 1]]
    assert result.cost == 1600001  # 400 km + 200 km; the 999 km raw return is omitted.
    assert np.array_equal(distance, original)
    assert snapshot.distances[2][0] == 999


def test_independent_validator_rejects_missing_edge_despite_solver_feasibility():
    # Minimal lineage; the candidate visits B directly even though the raw edge is missing.
    from fillrate_optimizer.model import RunSettings

    check = validate_cluster(
        {"id": "C", "diameter_m": 0},
        {"visits": ["v"]},
        {"nodes": ["depot", "B"], "matrix": [[0, -1], [123, 0]]},
        {"status": "solved", "solver_feasible": True, "routes": [["v"]]},
        {"v": {"location_id": "B", "lines": [{"line_id": "l", "pieces": 1}]}},
        {"l": {"lf": 400}},
        RunSettings(),
    )
    assert not check["valid"] and "unreachable" in check["violations"][0]


def test_validator_reconstructs_physical_mileage():
    problem = LoadProblem(35, -90, [Stop("A", 35, -89.99, 400)])
    raw = np.array([[0, 100], [999, 0]])
    assert not validate_loads(problem, [Truck(["A"], 400, 100)], raw)
    assert [v.code for v in validate_loads(problem, [Truck(["A"], 400, 1099)], raw)] == [
        "distance_mismatch"
    ]
    assert [
        v.code
        for v in validate_loads(problem, [Truck(["A"], 400, 0)], np.array([[0, -1], [999, 0]]))
    ] == ["unreachable_leg"]


def test_valhalla_reassembles_shuffled_directed_blocks_and_reports_progress():
    calls, progress = [], []

    def transport(url, body, timeout):
        assert url == "http://valhalla:8002/sources_to_targets"
        assert body["costing"] == "truck" and body["verbose"] is True
        assert body["costing_options"] == {"truck": {"length": 21.64}}
        assert 0 < timeout <= 15
        calls.append(body)
        return mock_response(body)

    snapshot = ValhallaTravel(
        config(block_size=50, max_pairs=4, max_locations=4), transport=transport
    ).matrix(NODES, progress=lambda a, b: progress.append((a, b)))
    assert len(calls) == 4 and progress == [(0, 4), (1, 4), (2, 4), (3, 4), (4, 4)]
    assert snapshot.distances == [[0, 2, None], [11, 0, 13], [21, 22, 0]]
    assert snapshot.effective()[0][0, 2] == -1
    assert snapshot.options["graph_config_hash"] == "sha256:fixture"
    assert snapshot.provider == "valhalla"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r.__setitem__("units", "miles"),
        lambda r: r.__setitem__("sources_to_targets", []),
        lambda r: r["sources_to_targets"][0].append(r["sources_to_targets"][0][0]),
        lambda r: r["sources_to_targets"][0][0].__setitem__("from_index", 99),
        lambda r: r["sources_to_targets"][0][0].__setitem__("from_index", True),
        lambda r: r["sources_to_targets"][0][0].__setitem__("time", None),
        lambda r: r["sources_to_targets"][0][0].__setitem__("distance", -1),
        lambda r: r["sources_to_targets"][0][0].__setitem__("distance", float("inf")),
        lambda r: r.__setitem__("error_code", 154),
        lambda r: r.__setitem__("warnings", "bad"),
        lambda r: r.pop("algorithm"),
    ],
)
def test_valhalla_rejects_malformed_or_incomplete_blocks(mutate):
    def transport(url, body, timeout):
        response = mock_response(body)
        mutate(response)
        return response

    with pytest.raises(ProviderError):
        ValhallaTravel(config(), transport=transport).matrix(NODES)


def test_provider_request_extent_is_not_a_business_leg_limit():
    calls = []
    far = [NODES[0], TravelNode(id="far", lat=35, lon=-80)]
    with pytest.raises(ProviderError, match="does not prove route unreachability"):
        ValhallaTravel(config(), transport=lambda *args: calls.append(args)).matrix(far)
    assert calls == []


def test_retry_only_transient_errors_and_preserve_null_edges():
    calls = []

    def transport(url, body, timeout):
        calls.append(body)
        if len(calls) == 1:
            raise TransientProviderError("HTTP 503")
        return mock_response(body)

    snapshot = ValhallaTravel(config(), transport=transport, sleep=lambda _: None).matrix(NODES)
    assert len(calls) == 2 and snapshot.distances[0][2] is None
    calls.clear()

    def permanent(*args):
        calls.append(args)
        raise ProviderError("HTTP 400")

    with pytest.raises(ProviderError, match="400"):
        ValhallaTravel(config(), transport=permanent).matrix(NODES)
    assert len(calls) == 1


def test_cancellation_stops_blocks_and_retry_backoff():
    calls = []
    cancelled = False

    def check():
        if cancelled:
            raise ProviderCancelled()

    def transport(url, body, timeout):
        nonlocal cancelled
        calls.append(body)
        cancelled = True
        return mock_response(body)

    with pytest.raises(ProviderCancelled):
        ValhallaTravel(config(block_size=1), transport=transport).matrix(
            NODES, check_cancelled=check
        )
    assert len(calls) == 1
    cancelled = False

    def transient(*args):
        nonlocal cancelled
        cancelled = True
        raise TransientProviderError("HTTP 503")

    with pytest.raises(ProviderCancelled):
        ValhallaTravel(config(), transport=transient).matrix(NODES, check_cancelled=check)


def test_total_deadline_bounds_block_timeout_and_retries():
    tick = [0.0]
    timeouts = []

    def transport(url, body, timeout):
        timeouts.append(timeout)
        tick[0] += 2
        return mock_response(body)

    with pytest.raises(ProviderError, match="total time limit"):
        ValhallaTravel(
            config(block_size=1, total_timeout_s=3), transport=transport, clock=lambda: tick[0]
        ).matrix(NODES)
    assert timeouts == [3, 1]


def test_unconfigured_provider_and_invalid_limits_fail_before_requests(monkeypatch):
    monkeypatch.delenv("VALHALLA_URL", raising=False)
    with pytest.raises(ProviderError, match="unconfigured"):
        ValhallaConfig.from_env()
    for changes in [
        {"url": "file:///etc/passwd"},
        {"url": "http://user:pass@valhalla:8002"},
        {"block_size": 0},
        {"max_pairs": 0},
        {"max_locations": 1},
        {"timeout_s": 1000},
        {"total_timeout_s": float("inf")},
        {"costing_options": []},
        {"retries": -1},
    ]:
        with pytest.raises(ValueError):
            replace(config(), **changes)


def test_warnings_and_graph_options_are_preserved_without_changing_requests():
    warning = {"code": 1, "description": "fixture warning"}

    def transport(url, body, timeout):
        response = mock_response(body)
        response["warnings"] = [copy.deepcopy(warning)]
        return response

    snapshot = ValhallaTravel(config(), transport=transport).matrix(NODES)
    assert snapshot.warnings == [warning]


@pytest.mark.parametrize(
    "matrix",
    [
        np.array([[0, 1, 2]]),
        np.array([[0.0, 1.0], [1.0, 0.0]]),
        np.array([[0, -2], [1, 0]]),
        np.array([[1, 1], [1, 0]]),
    ],
)
def test_solver_boundary_rejects_malformed_effective_matrices(matrix):
    with pytest.raises(ValueError, match="partition matrix"):
        solve_partition(
            PartitionProblem(
                distance=matrix,
                visits=[PartitionVisit("A", 1, 400)],
                capacity=5300,
                max_leg_m=1000,
                truck_penalty=1001,
            )
        )


@pytest.mark.parametrize(
    "status,raw,error",
    [
        (200, b'{"ok":true}', None),
        (200, b"not-json", ProviderError),
        (200, b"[]", ProviderError),
        (200, b" " * 65, ProviderError),
        (400, b"{}", ProviderError),
        (503, b"{}", TransientProviderError),
        (302, b"{}", ProviderError),
    ],
)
def test_http_transport_posts_bounded_json_and_refuses_redirects(monkeypatch, status, raw, error):
    import fillrate_optimizer.valhalla as valhalla

    monkeypatch.setattr(valhalla, "MAX_RESPONSE_BYTES", 64)
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            import json

            requests.append(
                (self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            )
            self.send_response(status)
            if status == 302:
                self.send_header("Location", "http://127.0.0.1:1/should-not-fetch")
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        endpoint = f"http://127.0.0.1:{server.server_port}/sources_to_targets"
        if error:
            with pytest.raises(error):
                post_json(endpoint, {"costing": "truck"}, 1)
        else:
            assert post_json(endpoint, {"costing": "truck"}, 1) == {"ok": True}
        assert requests == [("/sources_to_targets", {"costing": "truck"})]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
