"""Directed travel snapshots in the pipeline (spec §7, M6): selection, binding, reuse."""

import copy
import json
import random

import pytest

from fillrate_optimizer.canonical import content_hash, js_number, js_number_exact
from fillrate_optimizer.capabilities import capabilities
from fillrate_optimizer.model import PreflightPolicy, RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import PipelineError, run_pipeline, validate_cluster
from fillrate_optimizer.preflight import preflight_checks
from fillrate_optimizer.replay import DETERMINISTIC_STAGES, expected_record, main, replay
from fillrate_optimizer.travel_provider import SnapshotBindingError, TravelNode, TravelSnapshot

from .travel_parity import PATH, build, scenario_document, snapshot_document

WARN = PreflightPolicy(missing_coordinates="warn", far_from_depot="warn", oversize_stop="warn")
BASE = {"solver_max_iterations": 300, "solver_time_limit_s": 5, "preflight": WARN, "k": 1}


def snapshot(**changes) -> TravelSnapshot:
    document = snapshot_document()
    document.update(changes)
    return TravelSnapshot.model_validate(document)


def settings(snap: TravelSnapshot | None, **more) -> RunSettings:
    update = {**BASE, **more}
    if snap is not None:
        update["travel_snapshot_id"] = snap.identity
    return RunSettings(**update)


def scenario(**moved) -> ScenarioDocument:
    return ScenarioDocument.model_validate(scenario_document(moved or None))


def output_hash(out, stage: str) -> str:
    return next(a.manifest["output_hash"] for a in out.artifacts if a.stage == stage)


def run(snap: TravelSnapshot | None, **more):
    return run_pipeline(scenario(), settings(snap, **more), travel_snapshot=snap)


def visit_sets(summary) -> list[set[str]]:
    return sorted(
        ({visit.location_id for visit in truck.visits} for truck in summary.trucks), key=sorted
    )


# ---- cross-language contract ---------------------------------------------------------------------


def test_parity_fixture_is_current_and_expected_findings_hold():
    document = json.loads(PATH.read_text())
    assert document == json.loads(json.dumps(build())), "run `uv run python -m tests.travel_parity`"
    got = [(f["check"], f["action"], f["location_ids"]) for f in document["findings"]]
    assert got == [
        ("missing_coordinates", "block", ["M"]),
        ("far_from_depot", "block", ["F"]),
        ("far_via_stop", "warn", ["C", "E"]),  # B's 804,672.5 m leg rounds to the limit: allowed
    ]
    assert document["effective_meters"]["matrix"] == [
        [0, 804672, 100000],
        [-1, 0, -1],
        [-1, 100000, 0],
    ]
    assert snapshot().identity == document["identity"]


def test_js_number_fast_path_matches_the_exact_formatter():
    rng = random.Random(7)
    values = [rng.uniform(-1e5, 1e5) for _ in range(2000)]
    values += [rng.random() * 10 ** rng.randint(-8, 22) for _ in range(2000)]
    values += [
        1e-4,
        9.999e-5,
        0.0001234,
        1e15,
        9999999999999998.0,
        1e16,
        1.5e16,
        123456.789,
        2.0**40,
    ]
    for value in values:
        assert js_number(value) == js_number_exact(value), value


def test_directed_road_travel_stays_planned_until_browser_selection_exists():
    behavior = next(b for b in capabilities().behaviors if b.id == "directed_road_travel")
    assert behavior.availability == "planned"
    assert capabilities().travel_modes == ["haversine"]
    assert any("browser" in text for text in behavior.restrictions)


# ---- reachability uses the selected directed matrix ----------------------------------------------


def test_snapshot_legs_and_reachability_replace_the_estimate():
    estimated = run(None).summary
    # Straight-line travel puts every stop on one eastbound line: one truck reaches them all.
    assert estimated.travel.mode == "estimated" and estimated.travel.circuity == 1.2
    assert estimated.totals.trucks == 1 and estimated.validity == "valid"

    snap = snapshot()
    out = run(snap)
    summary = out.summary
    assert summary.validity == "valid" and summary.coverage == "partial"
    # B is reachable only straight from the depot, and C and E only through A: two trucks.
    assert visit_sets(summary) == [{"A", "C", "E"}, {"B"}]
    # 100 + 200 + 300 km along A → C → E, plus the half-meter tie on D → B rounded to even.
    assert summary.totals.loaded_distance_m == 100_000 + 200_000 + 300_000 + 804_672
    # F has legs out of it but none into it: unreachable, not merely far; M has no coordinates.
    reasons = {u.location_id: u.reason for u in summary.unplanned}
    assert reasons == {"F": "unreachable", "M": "excluded_unresolved_coordinates"}
    assert summary.travel.mode == "snapshot"
    assert summary.travel.snapshot_id == snap.identity
    assert (summary.travel.provider, summary.travel.profile) == ("imported", "truck")
    assert summary.travel.node_count == 7 and summary.travel.circuity is None
    stage = {a.stage: a.payload for a in out.artifacts}
    assert stage["travel"]["snapshot"]["id"] == snap.identity
    assert stage["travel"]["clusters"][0]["snapshot_id"] == snap.identity
    assert "circuity" not in stage["travel"]["clusters"][0]


def test_return_legs_and_unused_directions_never_enter_the_plan():
    # E → D is 100 km in the snapshot and D → E is missing. The open route never pays a return.
    summary = run(snapshot()).summary
    assert all(truck.distance_m == sum(v.leg_m for v in truck.visits) for truck in summary.trucks)
    assert not any(
        v.leg_m == 100_000 and v.location_id == "D" for t in summary.trucks for v in t.visits
    )


def test_blocking_preflight_uses_the_matrix_not_straight_lines():
    snap = snapshot()
    blocked = settings(snap, preflight=PreflightPolicy())
    with pytest.raises(PipelineError) as error:
        run_pipeline(scenario(), blocked, travel_snapshot=snap)
    assert error.value.code == "preflight_blocked"
    # Same stops are all within 500 miles in a straight line; only the matrix flags F.
    estimated = preflight_checks(
        scenario(), RunSettings(**{**BASE, "preflight": PreflightPolicy()})
    )
    assert [f.check for f in estimated] == ["missing_coordinates"]


def test_preflight_binds_to_the_snapshot_coordinates():
    snap = snapshot()
    run_settings = RunSettings(travel_snapshot_id=snap.identity)
    moved = ScenarioDocument.model_validate(scenario_document({"A": (0, 1.001)}))
    with pytest.raises(SnapshotBindingError) as error:
        preflight_checks(moved, run_settings, snap)
    assert error.value.moved == ["A"] and error.value.missing == []
    short = snapshot_document()
    index = [n["id"] for n in short["nodes"]].index("E")
    for key in ("distances", "durations"):
        short[key].pop(index)
        for row in short[key]:
            row.pop(index)
    short["nodes"].pop(index)
    with pytest.raises(SnapshotBindingError) as error:
        preflight_checks(scenario(), run_settings, TravelSnapshot.model_validate(short))
    assert error.value.missing == ["E"]
    clash = scenario_document()
    clash["locations"][0]["id"] = "D"
    clash["orders"][0]["location_id"] = "D"
    with pytest.raises(SnapshotBindingError, match="also a location ID"):
        preflight_checks(ScenarioDocument.model_validate(clash), run_settings, snap)


# ---- identity binding and failure modes ----------------------------------------------------------


def error_code(**kwargs) -> str:
    with pytest.raises(PipelineError) as error:
        run_pipeline(scenario(), kwargs.pop("run_settings"), **kwargs)
    return error.value.code


def test_the_selected_identity_must_resolve_and_match():
    snap = snapshot()
    wanted = settings(snap)
    assert error_code(run_settings=wanted) == "travel_snapshot_missing"
    assert (
        error_code(run_settings=settings(None), travel_snapshot=snap) == "travel_snapshot_unbound"
    )
    # A different matrix with the same nodes has a different identity.
    other = snapshot(
        distances=[
            [0 if i == j else (1000 if i != j else None) for j in range(7)] for i in range(7)
        ],
        durations=[[0 if i == j else 100 for j in range(7)] for i in range(7)],
    )
    assert other.identity != snap.identity
    assert error_code(run_settings=wanted, travel_snapshot=other) == "travel_snapshot_identity"
    assert (
        error_code(run_settings=wanted, snapshot_loader=lambda _id: other.model_dump(mode="json"))
        == "travel_snapshot_identity"
    )

    # Transport errors, absent rows and invalid documents are permanent, named failures.
    def absent(_id):
        raise RuntimeError("travel_snapshot_not_found")

    assert error_code(run_settings=wanted, snapshot_loader=absent) == "travel_snapshot_unavailable"
    broken = copy.deepcopy(snap.model_dump(mode="json"))
    broken["distances"][0][0] = None
    assert (
        error_code(run_settings=wanted, snapshot_loader=lambda _id: broken)
        == "travel_snapshot_unavailable"
    )
    loaded = run_pipeline(
        scenario(), wanted, snapshot_loader=lambda _id: snap.model_dump(mode="json")
    )
    assert loaded.summary.travel.snapshot_id == snap.identity


def test_a_coordinate_edited_after_the_snapshot_fails_the_run_before_solving():
    snap = snapshot()
    edited = ScenarioDocument.model_validate(scenario_document({"B": (0, 2.5)}))
    with pytest.raises(PipelineError) as error:
        run_pipeline(edited, settings(snap), travel_snapshot=snap)
    assert error.value.code == "travel_snapshot_mismatch"
    assert "B" in str(error.value)


# ---- stage reuse, comparison and replay identities -----------------------------------------------


def recording():
    cache = {}

    def checkpoint(artifact):
        cache.setdefault(
            artifact.manifest["input_hash"],
            {"manifest": artifact.manifest, "payload": artifact.payload},
        )

    return cache, checkpoint


def test_stage_reuse_is_bound_to_the_snapshot_identity():
    cache, checkpoint = recording()
    snap = snapshot()
    first = run_pipeline(
        scenario(), settings(snap), travel_snapshot=snap, execution_id="one", checkpoint=checkpoint
    )
    again = run_pipeline(
        scenario(),
        settings(snap, solver_seed=3),
        travel_snapshot=snap,
        execution_id="two",
        cache=cache.get,
        checkpoint=checkpoint,
    )
    by_stage = {a.stage: a.manifest for a in again.artifacts}
    for stage in ("allocation", "aggregation", "clustering", "travel"):
        assert by_stage[stage]["reused_from"] == "one"
    assert set(by_stage["travel"]["effective_settings"]) == {"max_leg_m", "travel_snapshot_id"}
    assert first.summary.totals.loaded_distance_m == again.summary.totals.loaded_distance_m

    # Same nodes, same coordinates, one different leg: another snapshot, so travel is recomputed
    # while the stages that never read travel are still reused.
    closer = snapshot_document()
    closer["distances"][1][3] = 190_000  # A → C, a leg the plan uses
    closer["durations"][1][3] = 19_000
    other = TravelSnapshot.model_validate(closer)
    third = run_pipeline(
        scenario(),
        settings(other),
        travel_snapshot=other,
        execution_id="three",
        cache=cache.get,
        checkpoint=checkpoint,
    )
    by_stage = {a.stage: a.manifest for a in third.artifacts}
    assert by_stage["travel"]["reused_from"] is None
    assert by_stage["allocation"]["reused_from"] == "one"
    assert by_stage["clustering"]["reused_from"] == "one"
    assert third.summary.totals.loaded_distance_m == first.summary.totals.loaded_distance_m - 10_000

    # Estimated runs still hash the circuity, never a snapshot, so their cache keys are unchanged.
    estimated = run_pipeline(scenario(), settings(None), execution_id="four")
    effective = {a.stage: a.manifest["effective_settings"] for a in estimated.artifacts}
    assert set(effective["travel"]) == {"max_leg_m", "travel_circuity"}
    assert (
        "travel_circuity" in effective["preflight"]
        and "travel_snapshot_id" not in effective["preflight"]
    )
    assert "travel_snapshot_id" in {
        k
        for a in first.artifacts
        if a.stage == "preflight"
        for k in a.manifest["effective_settings"]
    }


def test_a_stale_travel_artifact_is_rejected_by_independent_validation():
    """A cached travel stage whose manifest and hashes verify but whose legs disagree with the
    snapshot the run selected: the validator reads the snapshot, not the artifact."""
    snap = snapshot()
    probe = run_pipeline(scenario(), settings(snap), travel_snapshot=snap)
    entry = next(a for a in probe.artifacts if a.stage == "travel")
    forged_payload = copy.deepcopy(entry.payload)
    for cluster in forged_payload["clusters"]:
        cluster["matrix"][0][1] = 50_000  # D → A, 100,000 m in the snapshot
    forged_manifest = {**entry.manifest, "output_hash": content_hash(forged_payload)}
    forged = {
        entry.manifest["input_hash"]: {"manifest": forged_manifest, "payload": forged_payload}
    }

    out = run_pipeline(scenario(), settings(snap), travel_snapshot=snap, cache=forged.get)
    assert out.summary.validity == "invalid"
    checks = next(a.payload for a in out.artifacts if a.stage == "validation")["clusters"][0]
    assert any("travel snapshot" in v for v in checks["violations"])
    assert out.summary.trucks == [] or out.summary.coverage != "complete"

    # A cached artifact from a different snapshot also fails its own identity check.
    changed = snapshot_document()
    changed["distances"][0][1] = 150_000
    changed["durations"][0][1] = 15_000
    other = TravelSnapshot.model_validate(changed)
    swapped = {entry.manifest["input_hash"]: {"manifest": entry.manifest, "payload": entry.payload}}
    swapped_run = run_pipeline(scenario(), settings(other), travel_snapshot=other)
    wanted = next(a.manifest["input_hash"] for a in swapped_run.artifacts if a.stage == "travel")
    swapped = {
        wanted: {"manifest": {**entry.manifest, "input_hash": wanted}, "payload": entry.payload}
    }
    with pytest.raises(PipelineError) as error:
        run_pipeline(scenario(), settings(other), travel_snapshot=other, cache=swapped.get)
    assert error.value.code == "cache_corrupt"


def test_validate_cluster_cross_checks_each_leg_against_the_snapshot():
    out = run(snapshot())
    stage = {a.stage: a.payload for a in out.artifacts}
    meta = stage["clustering"]["clusters"][0]
    prob = stage["problem"]["clusters"][0]
    trav = stage["travel"]["clusters"][0]
    visits = {v["visit_id"]: v for v in stage["aggregation"]["visits"]}
    lines = {f"L-{x}": {"lf": 400, "value": 100} for x in "ABCEF"}
    solve = {"status": "solved", "solver_feasible": True, "routes": [[v] for v in prob["visits"]]}
    run_settings = settings(snapshot())
    assert (
        validate_cluster(meta, prob, trav, solve, visits, lines, run_settings, lambda a, b: 0)[
            "valid"
        ]
        is False
    )
    exact = {
        (a, b): trav["matrix"][i][j]
        for i, a in enumerate(trav["nodes"])
        for j, b in enumerate(trav["nodes"])
    }
    # Legs that disagree with the snapshot are violations; agreeing legs add none.
    honest = validate_cluster(
        meta, prob, trav, solve, visits, lines, run_settings, lambda a, b: exact[(a, b)]
    )
    assert not any("travel snapshot" in v for v in honest["violations"])


def test_replay_reproduces_from_the_serialized_snapshot_without_a_loader():
    snap = snapshot()
    one = run_pipeline(scenario(), settings(snap), travel_snapshot=snap, execution_id="a")
    reloaded = TravelSnapshot.model_validate_json(snap.model_dump_json())
    two = run_pipeline(scenario(), settings(reloaded), travel_snapshot=reloaded, execution_id="b")
    assert reloaded.identity == snap.identity
    for stage in ("preflight", "allocation", "aggregation", "clustering", "travel", "problem"):
        assert output_hash(one, stage) == output_hash(two, stage), stage
    assert one.summary.travel == two.summary.travel
    assert one.summary.totals == two.summary.totals
    effective = TravelNode(id="A", lat=0, lon=1)
    assert snap.effective([effective])[0].tolist() == [[0]]


# ---- offline replay bundles (packages/db/src/replay.ts writes these files) ---------------------


def write_snapshot_bundle(root, snap: TravelSnapshot) -> dict:
    run_settings = settings(snap)
    output = run_pipeline(scenario(), run_settings, travel_snapshot=snap)
    (root / "artifacts").mkdir(parents=True)
    (root / "scenario.json").write_text(json.dumps(scenario_document()))
    (root / "settings.json").write_text(json.dumps(run_settings.model_dump(mode="json")))
    (root / "travel-snapshot.json").write_text(snap.model_dump_json())
    expected = expected_record("run-1", output, run_settings)
    (root / "expected.json").write_text(json.dumps(expected))
    for artifact in output.artifacts:
        if artifact.stage in DETERMINISTIC_STAGES:
            (root / "artifacts" / f"{artifact.stage}.json").write_text(
                json.dumps({"manifest": artifact.manifest, "payload": artifact.payload})
            )
    return expected


def edit(root, name: str, change) -> None:
    path = root / name
    document = json.loads(path.read_text())
    change(document)
    path.write_text(json.dumps(document))


def test_a_snapshot_bundle_replays_offline_and_verifies_its_identity(tmp_path):
    snap = snapshot()
    expected = write_snapshot_bundle(tmp_path, snap)
    assert expected["travel"]["provider"] == "snapshot"
    assert expected["travel"]["snapshot_id"] == snap.identity
    assert expected["travel"]["summary"]["profile"] == "truck"
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == []
    text = "\n".join(lines)
    assert "snapshot identity verified" in text and "REPLAY OK" in text
    assert any(line.startswith("travel data") and "reproduced" in line for line in lines)
    assert any(line.startswith("preflight") and "reproduced" in line for line in lines)
    assert main([], root=tmp_path) == 0


def test_a_snapshot_bundle_never_replays_over_another_matrix(tmp_path):
    snap = snapshot()
    write_snapshot_bundle(tmp_path, snap)

    def tamper(document):
        document["distances"][0][1] = 1  # D → A is no longer the recorded 100,000 m

    edit(tmp_path, "travel-snapshot.json", tamper)
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == ["travel_snapshot"]
    assert "IDENTITY DIFFERS" in "\n".join(lines)
    assert not any(line.startswith("preflight") for line in lines)  # refused before any rerun
    assert main([], root=tmp_path) == 1


def test_snapshot_bundle_inconsistencies_are_refused(tmp_path):
    write_snapshot_bundle(tmp_path, snapshot())
    # The recording names a different snapshot than the settings do.
    edit(tmp_path, "expected.json", lambda d: d["travel"].update(snapshot_id="f" * 64))
    assert replay(tmp_path, out=lambda _: None) == ["travel_snapshot"]
    # A bundle that omits the snapshot file cannot be replayed.
    other = tmp_path / "other"
    other.mkdir()
    write_snapshot_bundle(other, snapshot())
    (other / "travel-snapshot.json").unlink()
    lines: list[str] = []
    assert replay(other, out=lines.append) == ["travel_snapshot"]
    assert "travel-snapshot.json is missing" in "\n".join(lines)
    # Settings that select a snapshot cannot hide behind an estimated-travel record.
    third = tmp_path / "third"
    third.mkdir()
    write_snapshot_bundle(third, snapshot())
    edit(
        third,
        "expected.json",
        lambda d: d.update(travel={"provider": "estimated", "circuity": 1.2}),
    )
    assert replay(third, out=lambda _: None) == ["travel_provider"]


def test_recorded_travel_provenance_must_reproduce(tmp_path):
    write_snapshot_bundle(tmp_path, snapshot())
    edit(tmp_path, "expected.json", lambda d: d["travel"]["summary"].update(profile="auto"))
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == ["travel_data"]
    assert any(line.startswith("travel data") and "DIFFERS" in line for line in lines)
