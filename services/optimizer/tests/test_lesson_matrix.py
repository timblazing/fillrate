"""The road matrix lesson's "what to look for" claims."""

import json
from pathlib import Path

import numpy as np
import pytest

from fillrate_optimizer import lesson_matrix
from fillrate_optimizer.model import RunSettings
from fillrate_optimizer.pipeline import run_pipeline
from fillrate_optimizer.replay import DETERMINISTIC_STAGES, expected_record, replay
from fillrate_optimizer.travel import METERS_PER_MILE, haversine_m
from fillrate_optimizer.travel_provider import TravelSnapshot, stop_nodes

ROOT = Path(__file__).resolve().parents[3] / "examples"
SEEDS = range(4)
LIMIT_MI = 500
WEST = {s[0] for s in lesson_matrix.STOPS if s[2] < lesson_matrix.RIVER_EAST}
EAST = {s[0] for s in lesson_matrix.STOPS if s[2] > lesson_matrix.RIVER_EAST}
RESORT = "RM-07"


def miles(meters: float) -> int:
    return round(meters / METERS_PER_MILE)


@pytest.fixture(scope="module")
def snap() -> TravelSnapshot:
    return lesson_matrix.snapshot()


@pytest.fixture(scope="module")
def runs(snap):
    """Solver seeds 0–3 on estimated travel and on the recorded snapshot."""
    return {
        (recorded, seed): run_pipeline(
            lesson_matrix.build(),
            lesson_matrix.settings(recorded).model_copy(update={"solver_seed": seed}),
            travel_snapshot=snap if recorded else None,
        )
        for recorded in (False, True)
        for seed in SEEDS
    }


@pytest.fixture(scope="module")
def estimated(runs):
    return runs[False, 0].summary


@pytest.fixture(scope="module")
def recorded(runs):
    return runs[True, 0].summary


def pair_miles(snap: TravelSnapshot) -> tuple[dict, dict]:
    """(estimated, recorded) miles for every directed pair of snapshot nodes."""
    ids = [n.id for n in snap.nodes]
    straight = haversine_m(np.array([(n.lat, n.lon) for n in snap.nodes])) * 1.2
    est = {
        (a, b): straight[i, j] / METERS_PER_MILE
        for i, a in enumerate(ids)
        for j, b in enumerate(ids)
    }
    rec = {
        (a, b): snap.distances[i][j] * 1000 / METERS_PER_MILE
        for i, a in enumerate(ids)
        for j, b in enumerate(ids)
    }
    return est, rec


# ---- the bundled files ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "recorded"), [("lesson-matrix.json", True), ("lesson-matrix-estimated.json", False)]
)
def test_example_files_match_the_generator(name, recorded):
    document = json.loads((ROOT / name).read_text())
    assert document["scenario"] == lesson_matrix.build().model_dump(mode="json")
    assert document["settings"] == lesson_matrix.settings(recorded).model_dump(mode="json")
    RunSettings.model_validate(document["settings"])


def test_the_bundled_snapshot_is_the_generated_one_and_says_it_is_synthetic(snap):
    document = json.loads((ROOT / "lesson-matrix-snapshot.json").read_text())
    stored = TravelSnapshot.model_validate(document)
    assert stored.identity == snap.identity
    settings = json.loads((ROOT / "lesson-matrix.json").read_text())["settings"]
    assert settings["travel_snapshot_id"] == snap.identity
    assert (
        json.loads((ROOT / "lesson-matrix-estimated.json").read_text())["settings"][
            "travel_snapshot_id"
        ]
        is None
    )
    # Clearly labeled: a synthetic recorded matrix, not real roads (spec §14).
    assert snap.provider == "imported"
    assert snap.options["synthetic"] is True
    assert "not real roads" in snap.dataset_revision
    assert [w["code"] for w in snap.warnings] == ["synthetic_matrix"]
    assert (snap.distance_units, snap.duration_units) == ("kilometers", "seconds")


def test_the_snapshot_binds_exactly_to_the_scenario(snap):
    scenario = lesson_matrix.build()
    stops = {loc.id: (loc.lat, loc.lon) for loc in scenario.locations}
    nodes = stop_nodes(scenario.depot.id, (scenario.depot.lat, scenario.depot.lon), stops)
    assert nodes == snap.nodes  # same IDs, order and coordinates: no stale binding
    meters, seconds = snap.effective(nodes)
    assert (meters >= 0).all() and (seconds >= 0).all()  # every edge recorded


def test_the_recorded_matrix_is_directed_and_not_proportional_to_straight_lines(snap):
    est, rec = pair_miles(snap)
    # Crossing the river eastbound uses the one-way bridge; westbound detours 110 miles south.
    assert round(rec["RM-03", "RM-04"]) == 82 and round(rec["RM-04", "RM-03"]) == 321
    assert round(est["RM-03", "RM-04"]) == round(est["RM-04", "RM-03"]) == 60
    for a in WEST:
        for b in EAST:
            if b != RESORT:
                assert rec[b, a] > rec[a, b], (a, b)  # westbound is always the longer way
    # Not proportional either: the eastbound trip from the farm supply still needs the south bridge.
    assert (round(est["RM-02", "RM-05"]), round(rec["RM-02", "RM-05"])) == (76, 149)
    # Same bank, no barrier: the recording is close to the estimate.
    assert abs(rec["DC-MEM", "RM-01"] - est["DC-MEM", "RM-01"]) < 3
    # The resort: within 500 miles on the estimate, beyond 500 on every recorded leg into it.
    assert round(est["DC-MEM", RESORT]) == 470 <= LIMIT_MI
    assert round(est["RM-06", RESORT]) == 347
    assert round(rec["DC-MEM", RESORT]) == 633
    into = {a: rec[a, RESORT] for (a, b) in rec if b == RESORT and a != RESORT}
    assert min(into.values()) > LIMIT_MI
    assert min(into, key=into.get) == "RM-05" and round(into["RM-05"]) == 532


# ---- step 1: estimated travel --------------------------------------------------------------------


def test_step_1_estimated_travel_plans_every_stop_on_two_trucks(estimated):
    assert (estimated.validity, estimated.coverage) == ("valid", "complete")
    assert estimated.unplanned == [] and estimated.preflight == []
    assert estimated.totals.trucks == 2 == estimated.totals.capacity_lower_bound
    assert miles(estimated.totals.loaded_distance_m) == 724
    assert estimated.totals.planned_cents == 714_000
    assert estimated.travel.mode == "estimated" and estimated.travel.circuity == 1.2
    resort = next(t for t in estimated.trucks if t.visits[-1].location_id == RESORT)
    assert [v.location_id for v in resort.visits][-2:] == ["RM-06", RESORT]
    assert miles(resort.visits[-1].leg_m) == 347


def test_every_solver_seed_finds_the_same_plan(runs):
    for recorded in (False, True):
        plans = {
            json.dumps(
                sorted([v.location_id for v in t.visits] for t in runs[recorded, s].summary.trucks)
            )
            for s in SEEDS
        }
        assert len(plans) == 1, recorded


# ---- step 2: the recorded matrix -----------------------------------------------------------------


def test_step_2_the_recorded_matrix_leaves_the_resort_unreachable(recorded, snap):
    assert (recorded.validity, recorded.coverage) == ("valid", "partial")
    assert [(f.check, f.action, f.location_ids) for f in recorded.preflight] == [
        ("far_from_depot", "warn", [RESORT])
    ]
    (line,) = recorded.unplanned
    assert (line.location_id, line.reason, line.pieces, line.amount_cents) == (
        RESORT,
        "unreachable",
        4,
        168_000,
    )
    assert recorded.totals.planned_cents == 546_000
    assert recorded.totals.trucks == 1
    assert miles(recorded.totals.loaded_distance_m) == 488
    (truck,) = recorded.trucks
    assert truck.load == 5_200 and round(truck.fill * 100) == 98
    travel = recorded.travel
    assert (travel.mode, travel.provider, travel.snapshot_id) == (
        "snapshot",
        "imported",
        snap.identity,
    )
    assert travel.dataset_revision == lesson_matrix.DATASET_REVISION
    assert (travel.node_count, travel.warning_count) == (8, 1)


def test_step_2_the_truck_serves_the_west_bank_before_crossing_once_eastbound(recorded):
    (truck,) = recorded.trucks
    order = [v.location_id for v in truck.visits]
    assert set(order[:3]) == WEST and set(order[3:]) == EAST - {RESORT}
    assert order == ["RM-02", "RM-01", "RM-03", "RM-04", "RM-06", "RM-05"]


def test_step_2_legs_and_drive_times_are_the_recorded_ones(recorded, snap):
    scenario = lesson_matrix.build()
    stops = {loc.id: (loc.lat, loc.lon) for loc in scenario.locations}
    meters, seconds = snap.effective(
        stop_nodes(scenario.depot.id, (scenario.depot.lat, scenario.depot.lon), stops)
    )
    index = {n.id: i for i, n in enumerate(snap.nodes)}
    (truck,) = recorded.trucks
    previous = "DC-MEM"
    for visit in truck.visits:
        assert visit.leg_m == meters[index[previous], index[visit.location_id]]
        assert visit.leg_s == seconds[index[previous], index[visit.location_id]]
        previous = visit.location_id


def test_step_3_travel_never_changes_allocation_or_clusters(runs):
    """Clustering uses the symmetric spatial metric (spec §7), whichever travel is selected."""

    def hashes(out):
        return {a.stage: a.manifest["output_hash"] for a in out.artifacts}

    est, rec = hashes(runs[False, 0]), hashes(runs[True, 0])
    for stage in ("allocation", "aggregation", "clustering"):
        assert est[stage] == rec[stage], stage
    assert est["travel"] != rec["travel"]


# ---- the replay bundle (packages/db/src/replay.ts writes these files) ---------------------------


def test_the_recorded_run_replays_offline_from_its_bundled_snapshot(tmp_path, runs, snap):
    output = runs[True, 0]
    settings = lesson_matrix.settings(True)
    (tmp_path / "artifacts").mkdir()
    (tmp_path / "scenario.json").write_text(
        json.dumps(lesson_matrix.build().model_dump(mode="json"))
    )
    (tmp_path / "settings.json").write_text(json.dumps(settings.model_dump(mode="json")))
    (tmp_path / "travel-snapshot.json").write_text(
        (ROOT / "lesson-matrix-snapshot.json").read_text()
    )
    (tmp_path / "expected.json").write_text(json.dumps(expected_record("run-1", output, settings)))
    for artifact in output.artifacts:
        if artifact.stage in DETERMINISTIC_STAGES:
            (tmp_path / "artifacts" / f"{artifact.stage}.json").write_text(
                json.dumps({"manifest": artifact.manifest, "payload": artifact.payload})
            )
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == []
    text = "\n".join(lines)
    assert "snapshot identity verified" in text and "REPLAY OK" in text
