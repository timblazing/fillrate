"""Valhalla road geometry for inspected trucks: chunking, decoding, discrepancies, refusals."""

import json
import os

import pytest

from fillrate_optimizer.route_geometry import (
    GeometryError,
    GeometryStop,
    GeometryUnavailable,
    RouteGeometryRequest,
    chunk_ranges,
    decode_polyline6,
    fetch_route_geometry,
)
from fillrate_optimizer.travel_provider import TravelNode, TravelSnapshot
from fillrate_optimizer.valhalla import ProviderError, TransientProviderError, ValhallaConfig

COSTING = {"length": 21.64, "weight": 21.77}


def encode(points):
    """Encode [lon, lat] pairs as polyline6."""
    out, plat, plon = [], 0, 0
    for lon, lat in points:
        for value, prev in ((round(lat * 1e6), plat), (round(lon * 1e6), plon)):
            delta = value - prev
            delta = ~(delta << 1) if delta < 0 else delta << 1
            while delta >= 0x20:
                out.append(chr((0x20 | (delta & 0x1F)) + 63))
                delta >>= 5
            out.append(chr(delta + 63))
        plat, plon = round(lat * 1e6), round(lon * 1e6)
    return "".join(out)


def config(**kwargs):
    return ValhallaConfig(
        url="http://valhalla:8002",
        provider_version="valhalla-3.9.0",
        dataset_revision="extract-1",
        graph_config_hash="sha256:graph",
        costing_options=COSTING,
        **kwargs,
    )


def stops(n, step=0.1):
    return [GeometryStop(id=f"S{i}", lat=35 + i * step, lon=-90 + i * step / 2) for i in range(n)]


def snapshot_for(stop_list, *, provider="valhalla", scale=1.0, cfg=None):
    cfg = cfg or config()
    nodes = [TravelNode(id=s.id, lat=s.lat, lon=s.lon) for s in stop_list]
    n = len(nodes)
    d = [[0 if i == j else 10.0 * abs(i - j) for j in range(n)] for i in range(n)]
    t = [[0 if i == j else 600.0 * abs(i - j) for j in range(n)] for i in range(n)]
    d = [[v * scale for v in row] for row in d]
    return TravelSnapshot(
        nodes=nodes,
        provider=provider,
        provider_version=cfg.provider_version if provider == "valhalla" else "x/1",
        dataset_revision=cfg.dataset_revision,
        profile="truck",
        options={"costing_options": COSTING, "graph_config_hash": "sha256:graph"},
        distance_units="kilometers",
        duration_units="seconds",
        distances=d,
        durations=t,
    )


def request_for(stop_list, snap):
    return RouteGeometryRequest(
        snapshot_id=snap.identity,
        snapshot=snap.model_dump(mode="json"),
        truck_id="C1-T1",
        stops=stop_list,
    )


class FakeValhalla:
    """Routes between consecutive locations as straight two-point shapes, 10 km / 600 s each."""

    def __init__(self, fail_when=None, length_factor=1.0, transient=False):
        self.calls = []
        self.fail_when = fail_when
        self.factor = length_factor
        self.transient = transient

    def __call__(self, endpoint, body, timeout):
        assert endpoint == "http://valhalla:8002/route"
        assert timeout <= 60
        assert body["costing"] == "truck"
        assert body["costing_options"] == {"truck": COSTING}
        assert body["shape_format"] == "polyline6" and body["units"] == "kilometers"
        locations = body["locations"]
        assert all(loc["type"] == "break" for loc in locations)
        self.calls.append(locations)
        if self.transient:
            raise TransientProviderError("down")
        if self.fail_when and self.fail_when(locations):
            raise ProviderError("Valhalla rejected matrix request (HTTP 400)")
        legs = []
        for a, b in zip(locations, locations[1:], strict=False):
            shape = encode([[a["lon"], a["lat"]], [b["lon"], b["lat"]]])
            legs.append({"summary": {"length": 10 * self.factor, "time": 600}, "shape": shape})
        return {"trip": {"units": "kilometers", "legs": legs}}


def test_polyline6_roundtrip():
    points = [[-90.049, 35.1495], [-90.0501, 35.15], [-89.9, 34.2]]
    assert decode_polyline6(encode(points)) == points
    with pytest.raises(ProviderError):
        decode_polyline6("")
    with pytest.raises(ProviderError):
        decode_polyline6("_")  # truncated varint


def test_chunk_ranges_overlap_and_cover():
    assert chunk_ranges(2, 20) == [(0, 2)]
    assert chunk_ranges(20, 20) == [(0, 20)]
    assert chunk_ranges(21, 20) == [(0, 20), (19, 21)]
    ranges = chunk_ranges(60, 20)
    assert ranges[0] == (0, 20) and ranges[-1][1] == 60
    assert all(b[0] == a[1] - 1 for a, b in zip(ranges, ranges[1:], strict=False))
    assert all(end - start <= 20 for start, end in ranges)


def test_long_route_chunks_in_order_without_resequencing():
    s = stops(45)
    snap = snapshot_for(s)
    fake = FakeValhalla()
    result = fetch_route_geometry(request_for(s, snap), config(), transport=fake, max_locations=20)
    assert [len(c) for c in fake.calls] == [20, 20, 7]
    sent = [(loc["lat"], loc["lon"]) for call in fake.calls for loc in call]
    # Every chunk starts at the previous chunk's final location.
    assert fake.calls[1][0] == fake.calls[0][-1] and fake.calls[2][0] == fake.calls[1][-1]
    assert [leg.from_id for leg in result.legs] == [f"S{i}" for i in range(44)]
    assert [leg.to_id for leg in result.legs] == [f"S{i}" for i in range(1, 45)]
    assert len(sent) == 47
    assert result.chunks["resequenced"] is False and result.chunks["requests"] == 3
    assert all(leg.status == "ok" and len(leg.coordinates) == 2 for leg in result.legs)
    assert result.summary["drawn"] == 44 and result.summary["missing"] == 0


def test_open_route_has_no_synthetic_return_leg():
    s = stops(4)
    snap = snapshot_for(s)
    fake = FakeValhalla()
    result = fetch_route_geometry(request_for(s, snap), config(), transport=fake)
    assert len(result.legs) == 3
    assert [loc["lat"] for loc in fake.calls[0]] == [x.lat for x in s]
    assert result.legs[-1].to_id == "S3"


def test_discrepancies_are_recorded_not_hidden():
    s = stops(3)
    snap = snapshot_for(s)  # matrix: 10 km, 600 s per hop
    result = fetch_route_geometry(
        request_for(s, snap), config(), transport=FakeValhalla(length_factor=1.5)
    )
    leg = result.legs[0]
    assert (leg.matrix_m, leg.matrix_s) == (10_000, 600)
    assert (leg.route_m, leg.route_s) == (15_000.0, 600.0)
    assert leg.delta_m == 5000.0 and leg.relative_m == 0.5 and leg.delta_s == 0.0
    assert leg.notable and result.summary["notable"] == 2
    exact = fetch_route_geometry(request_for(s, snap), config(), transport=FakeValhalla())
    assert not any(leg.notable for leg in exact.legs)
    assert exact.legs[0].delta_m == 0.0


def test_rejected_chunk_falls_back_per_leg_and_reports_failures():
    s = stops(5)
    snap = snapshot_for(s)
    bad = s[2]

    def fail(locations):
        return any(loc["lat"] == bad.lat for loc in locations)

    fake = FakeValhalla(fail_when=fail)
    result = fetch_route_geometry(request_for(s, snap), config(), transport=fake)
    statuses = [leg.status for leg in result.legs]
    # Legs into and out of S2 have no route; the others still draw. Nothing is a straight line.
    assert statuses == ["ok", "no_route", "no_route", "ok"]
    assert result.legs[1].coordinates is None and result.legs[1].error
    assert result.summary["missing"] == 2 and result.summary["drawn"] == 2
    assert len(fake.calls) == 1 + 4  # one chunk, then one request per leg


def test_transient_failure_is_not_retried():
    s = stops(3)
    fake = FakeValhalla(transient=True)
    with pytest.raises(GeometryError) as error:
        fetch_route_geometry(request_for(s, snapshot_for(s)), config(), transport=fake)
    assert error.value.code == "provider_unavailable" and len(fake.calls) == 1


def test_same_location_leg_needs_no_request():
    s = [stops(2)[0], stops(2)[0].model_copy(update={"id": "S0b"}), stops(3)[2]]
    snap = snapshot_for(s)
    fake = FakeValhalla()
    result = fetch_route_geometry(request_for(s, snap), config(), transport=fake)
    assert result.legs[0].status == "same_location" and result.legs[0].route_m == 0.0
    assert result.legs[1].status == "ok"
    assert len(fake.calls) == 1 and len(fake.calls[0]) == 2


@pytest.mark.parametrize(
    ("provider", "reason"),
    [("haversine", "estimated_travel"), ("imported", "imported_matrix")],
)
def test_non_valhalla_snapshots_are_refused(provider, reason):
    s = stops(3)
    snap = snapshot_for(s, provider=provider)
    fake = FakeValhalla()
    with pytest.raises(GeometryUnavailable) as error:
        fetch_route_geometry(request_for(s, snap), config(), transport=fake)
    assert error.value.reason == reason and not fake.calls


def test_context_mismatch_and_unconfigured_are_refused():
    s = stops(3)
    snap = snapshot_for(s)
    fake = FakeValhalla()
    for changed in (
        config().__class__(**{**config().__dict__, "dataset_revision": "extract-2"}),
        config().__class__(**{**config().__dict__, "provider_version": "valhalla-3.10"}),
        config().__class__(**{**config().__dict__, "graph_config_hash": "sha256:other"}),
        config().__class__(**{**config().__dict__, "costing_options": {"length": 12}}),
    ):
        with pytest.raises(GeometryUnavailable) as error:
            fetch_route_geometry(request_for(s, snap), changed, transport=fake)
        assert error.value.reason == "provider_context_mismatch"
    with pytest.raises(GeometryUnavailable) as error:
        fetch_route_geometry(request_for(s, snap), None, transport=fake)
    assert error.value.reason == "valhalla_not_configured"
    assert not fake.calls


def test_identity_and_binding_are_checked():
    s = stops(3)
    snap = snapshot_for(s)
    bad = request_for(s, snap).model_copy(update={"snapshot_id": "0" * 64})
    with pytest.raises(GeometryError) as error:
        fetch_route_geometry(bad, config(), transport=FakeValhalla())
    assert error.value.code == "travel_snapshot_identity"
    moved = [*s[:2], s[2].model_copy(update={"lat": 40.0})]
    with pytest.raises(GeometryError) as error:
        fetch_route_geometry(request_for(moved, snap), config(), transport=FakeValhalla())
    assert error.value.code == "travel_snapshot_mismatch"


@pytest.mark.skipif(
    not os.environ.get("VALHALLA_URL"), reason="needs a live Valhalla (VALHALLA_URL)"
)
def test_live_valhalla_tn_ms_ar():
    """Memphis depot, then Nashville, Jackson TN, Tupelo, Jackson MS, Little Rock, Jonesboro."""
    from fillrate_optimizer.valhalla import ValhallaTravel

    cfg = ValhallaConfig.from_env()
    places = [
        ("depot", 35.1495, -90.0490),
        ("nash", 36.1627, -86.7816),
        ("jtn", 35.6145, -88.8139),
        ("tupelo", 34.2576, -88.7034),
        ("jms", 32.2988, -90.1848),
        ("lr", 34.7465, -92.2896),
        ("jb", 35.8423, -90.7043),
    ]
    sl = [GeometryStop(id=i, lat=a, lon=b) for i, a, b in places]
    snap = ValhallaTravel(cfg).matrix([TravelNode(id=s.id, lat=s.lat, lon=s.lon) for s in sl])
    from fillrate_optimizer.route_geometry import max_route_locations

    # A small limit forces chunking against the real server.
    result = fetch_route_geometry(request_for(sl, snap), cfg, max_locations=4)
    assert result.chunks["requests"] == 2
    assert result.summary["drawn"] == 6 and result.summary["missing"] == 0
    for leg in result.legs:
        assert len(leg.coordinates) > 2
        assert abs(leg.relative_m) < 0.15, (leg.from_id, leg.to_id, leg.delta_m)
    assert max_route_locations() >= 2
    print(
        json.dumps(
            [
                (
                    x.from_id,
                    x.to_id,
                    x.matrix_m,
                    x.route_m,
                    x.delta_m,
                    x.matrix_s,
                    x.route_s,
                    x.delta_s,
                )
                for x in result.legs
            ]
        )
    )
