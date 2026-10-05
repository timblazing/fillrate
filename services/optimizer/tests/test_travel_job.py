"""Durable Valhalla snapshot job against a loopback fake Valhalla (no live service)."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from fillrate_optimizer.synthetic import build
from fillrate_optimizer.travel_job import TravelJobError, build_snapshot, demand_nodes
from fillrate_optimizer.travel_provider import TravelSnapshot
from fillrate_optimizer.valhalla import ProviderCancelled, ValhallaConfig


def directed_km(source, target):
    if (source["lat"], source["lon"]) == (target["lat"], target["lon"]):
        return 0
    base = 1000 * (abs(source["lat"] - target["lat"]) + abs(source["lon"] - target["lon"]))
    return round(base + (1.5 if source["lon"] < target["lon"] else 7.25), 3)


class Fake(BaseHTTPRequestHandler):
    calls = 0
    fail_status = None  # permanent rejection
    transient_first = 0  # 503 for this many initial requests
    on_call = None

    def log_message(self, *args):
        pass

    def do_POST(self):
        type(self).calls += 1
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if type(self).on_call:
            type(self).on_call(type(self).calls)
        status = 200
        if type(self).fail_status:
            status, out = type(self).fail_status, {"error": "bad"}
        elif type(self).calls <= type(self).transient_first:
            status, out = 503, {"error": "busy"}
        else:
            rows = [
                [
                    {
                        "from_index": i,
                        "to_index": j,
                        "distance": directed_km(s, t),
                        "time": directed_km(s, t) * 60,
                    }
                    for j, t in enumerate(body["targets"])
                ]
                for i, s in enumerate(body["sources"])
            ]
            out = {
                "units": "kilometers",
                "algorithm": "timedistancematrix",
                "sources_to_targets": rows,
            }
        data = json.dumps(out).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


@pytest.fixture
def server():
    Fake.calls, Fake.fail_status, Fake.transient_first, Fake.on_call = 0, None, 0, None
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def cfg(url, **kwargs):
    return ValhallaConfig(
        url=url,
        provider_version="fake-valhalla/1",
        dataset_revision="fixture-extract",
        graph_config_hash="sha256:fixture",
        costing_options={"length": 21.64},
        block_size=kwargs.pop("block_size", 20),
        max_matrix_distance_m=1e7,
        **kwargs,
    )


def scenario():
    return build().model_dump(mode="json")


def run(url, **kwargs):
    stored, events = [], []
    summary = build_snapshot(
        scenario(),
        store=lambda document, snapshot_id: stored.append((document, snapshot_id)),
        progress=events.append,
        config=cfg(url, **kwargs.pop("config", {})),
        **kwargs,
    )
    return summary, stored, events


def test_success_across_blocks_is_directed_and_hash_bound(server):
    summary, stored, events = run(server)
    nodes = demand_nodes(build())
    assert len(nodes) > 20  # more than one block per side
    document, snapshot_id = stored[0]
    snapshot = TravelSnapshot.model_validate(document)
    assert snapshot.identity == snapshot_id == summary["snapshot_id"]
    assert [n.id for n in snapshot.nodes] == [n.id for n in nodes]
    assert summary["node_count"] == len(nodes) and summary["blocks"] == Fake.calls > 1
    i, j = 0, 1
    assert snapshot.distances[i][j] != snapshot.distances[j][i]  # asymmetric
    assert snapshot.distances[i][j] == directed_km(nodes[i].model_dump(), nodes[j].model_dump())
    assert (
        snapshot.provider == "valhalla"
        and snapshot.options["graph_config_hash"] == "sha256:fixture"
    )
    assert (
        events[0]["blocks_done"] == 0
        and events[-1]["blocks_done"] == events[-1]["blocks_total"] == summary["blocks"]
    )
    assert all(e["stage"] == "travel_snapshot" for e in events)


def test_permanent_rejection_fails_without_retry_or_store(server):
    Fake.fail_status = 400
    stored = []
    with pytest.raises(TravelJobError) as error:
        build_snapshot(
            scenario(),
            store=lambda *a: stored.append(a),
            progress=lambda d: None,
            config=cfg(server),
        )
    assert error.value.code == "valhalla_request_rejected"
    assert Fake.calls == 1 and not stored


def test_transient_then_success(server):
    Fake.transient_first = 1
    summary, stored, _ = run(server)
    assert len(stored) == 1 and summary["snapshot_id"] == stored[0][1]
    assert Fake.calls == 1 + summary["blocks"]


def test_exhausted_transient_is_a_failure_with_its_own_code(server):
    Fake.transient_first = 99
    stored = []
    with pytest.raises(TravelJobError) as error:
        build_snapshot(
            scenario(),
            store=lambda *a: stored.append(a),
            progress=lambda d: None,
            config=cfg(server, retries=1),
        )
    assert error.value.code == "valhalla_unavailable" and not stored
    assert Fake.calls == 2


def test_cancellation_mid_build_stores_nothing(server):
    state = {"cancel": False}
    Fake.on_call = lambda n: state.update(cancel=n >= 2)

    def check():
        if state["cancel"]:
            raise ProviderCancelled()

    stored = []
    with pytest.raises(ProviderCancelled):
        build_snapshot(
            scenario(),
            store=lambda *a: stored.append(a),
            progress=lambda d: None,
            check_cancelled=check,
            config=cfg(server),
        )
    assert not stored and Fake.calls == 2


def test_unconfigured_is_a_stable_error(monkeypatch):
    monkeypatch.delenv("VALHALLA_URL", raising=False)
    with pytest.raises(TravelJobError) as error:
        build_snapshot(scenario(), store=lambda *a: None, progress=lambda d: None)
    assert error.value.code == "valhalla_not_configured"
