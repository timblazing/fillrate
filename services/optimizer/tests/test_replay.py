"""Replay export semantics (spec §13): what the bundle README promises, proven on small runs."""

import copy
import json
from pathlib import Path

import pytest

from fillrate_optimizer import lesson_allocation
from fillrate_optimizer.model import RunSettings, ScenarioDocument
from fillrate_optimizer.pipeline import run_pipeline
from fillrate_optimizer.replay import (
    DETERMINISTIC_STAGES,
    expected_record,
    main,
    replay,
    stage_digest,
    without_measured,
)

SCENARIO = lesson_allocation.build()


def settings(**update) -> RunSettings:
    return lesson_allocation.SETTINGS.model_copy(update=update)


def write_bundle(root: Path, config: RunSettings, scenario: ScenarioDocument = SCENARIO) -> dict:
    """The files the web export writes into a replay bundle (`packages/db/src/replay.ts`)."""
    output = run_pipeline(scenario, config)
    (root / "artifacts").mkdir(parents=True)
    (root / "scenario.json").write_text(json.dumps(scenario.model_dump(mode="json")))
    (root / "settings.json").write_text(json.dumps(config.model_dump(mode="json")))
    expected = expected_record("run-1", output, config)
    (root / "expected.json").write_text(json.dumps(expected))
    for artifact in output.artifacts:
        if artifact.stage in DETERMINISTIC_STAGES:
            (root / "artifacts" / f"{artifact.stage}.json").write_text(
                json.dumps({"manifest": artifact.manifest, "payload": artifact.payload})
            )
    return expected


def edit(root: Path, name: str, change) -> None:
    path = root / name
    document = json.loads(path.read_text())
    change(document)
    path.write_text(json.dumps(document))


@pytest.mark.parametrize(
    "strategy",
    ["order_date_then_value", "first_come", "priority", "proportional", "optimized"],
)
@pytest.mark.parametrize("policy", ["piece", "whole_order"])
def test_every_allocation_strategy_and_policy_replays(tmp_path, strategy, policy):
    config = settings(allocation_strategy=strategy, fulfillment_policy=policy)
    expected = write_bundle(tmp_path, config)
    assert expected["allocation"]["strategy"] == strategy
    assert expected["allocation"]["fulfillment_policy"] == policy
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == []
    assert lines[-1] == "REPLAY OK"
    assert [line.split()[0] for line in lines[:4]] == list(DETERMINISTIC_STAGES)


def test_measured_runtimes_are_provenance_not_results(tmp_path):
    """A CP-SAT allocation stage records its runtime; replaying must not call that a difference."""
    expected = write_bundle(tmp_path, settings(allocation_strategy="optimized"))
    recorded = json.loads((tmp_path / "artifacts/allocation.json").read_text())["payload"]
    assert recorded["stages"][0]["status"] == "optimal"
    assert "runtime_s" in recorded["stages"][0]

    # The recording came from a slower machine: same decisions, different measured runtime.
    edit(
        tmp_path,
        "artifacts/allocation.json",
        lambda d: d["payload"]["stages"][0].update(runtime_s=123.456),
    )
    edit(
        tmp_path,
        "expected.json",
        lambda d: d["deterministic_output_hashes"].update(allocation="0" * 64),
    )
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == []
    assert any(
        line.startswith("allocation") and "measured runtimes differ" in line for line in lines
    )
    assert expected["allocation"]["kind"] == "cp_sat"


def test_stage_digest_ignores_only_measured_values():
    payload = {"stages": [{"status": "optimal", "value": 5, "runtime_s": 0.1}], "runtime_s": 2}
    other = copy.deepcopy(payload)
    other["stages"][0]["runtime_s"] = 9.9
    assert stage_digest(payload) == stage_digest(other)
    assert without_measured(payload) == {"stages": [{"status": "optimal", "value": 5}]}
    other["stages"][0]["value"] = 6
    assert stage_digest(payload) != stage_digest(other)


def test_a_changed_allocation_decision_is_reported(tmp_path):
    write_bundle(tmp_path, settings())

    def move_a_piece(document):
        allocated = document["payload"]["allocated"]
        line = next(k for k, v in sorted(allocated.items()) if v > 0)
        allocated[line] -= 1

    edit(tmp_path, "artifacts/allocation.json", move_a_piece)
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == ["allocation"]
    assert lines[-1] == "REPLAY FAILED: allocation"


def test_a_recorded_hash_is_enough_when_the_artifact_is_missing(tmp_path):
    write_bundle(tmp_path, settings())
    (tmp_path / "artifacts/clustering.json").unlink()
    assert replay(tmp_path, out=lambda _: None) == []
    edit(
        tmp_path,
        "expected.json",
        lambda d: d["deterministic_output_hashes"].update(clustering="0" * 64),
    )
    assert replay(tmp_path, out=lambda _: None) == ["clustering"]


def test_allocation_identity_must_match_the_recording(tmp_path):
    write_bundle(tmp_path, settings())
    # The settings file now asks for a different rule than the recording: both are reported.
    edit(
        tmp_path,
        "settings.json",
        lambda d: d.update(allocation_strategy="first_come", fulfillment_policy="whole_order"),
    )
    failures = replay(tmp_path, out=lambda _: None)
    assert {"strategy", "fulfillment_policy"} <= set(failures)


def test_iteration_budget_requires_the_recorded_plan(tmp_path):
    expected = write_bundle(tmp_path, settings())
    assert expected["iteration_based"] is True
    edit(
        tmp_path,
        "expected.json",
        lambda d: d["totals"].update(planned_cents=d["totals"]["planned_cents"] + 1),
    )
    assert replay(tmp_path, out=lambda _: None) == ["planned_cents"]
    edit(tmp_path, "expected.json", lambda d: d["totals"].update(trucks=d["totals"]["trucks"] + 1))
    assert replay(tmp_path, out=lambda _: None) == ["shipments", "planned_cents"]


def test_time_budget_reports_solver_metrics_without_failing(tmp_path):
    expected = write_bundle(tmp_path, settings(solver_max_iterations=None, solver_time_limit_s=2))
    assert expected["iteration_based"] is False
    edit(
        tmp_path,
        "expected.json",
        lambda d: d["totals"].update(planned_cents=d["totals"]["planned_cents"] + 1),
    )
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == []
    assert any(line.startswith("planned_cents") and "≠" in line for line in lines)
    assert any("informational" in line for line in lines)
    # Validity is a result, never informational.
    edit(tmp_path, "expected.json", lambda d: d.update(validity="invalid"))
    assert replay(tmp_path, out=lambda _: None) == ["validity"]


def test_iterations_override_is_the_documented_reproduction_mode(tmp_path):
    write_bundle(tmp_path, settings(solver_max_iterations=None, solver_time_limit_s=2))
    edit(tmp_path, "expected.json", lambda d: d["totals"].update(planned_cents=0))
    # --iterations N reruns with a fixed budget; metrics are then informational.
    assert replay(tmp_path, iterations=50, out=lambda _: None) == []
    assert main(["--iterations", "50"], root=tmp_path) == 0


def test_main_exit_status_follows_the_replay(tmp_path):
    write_bundle(tmp_path, settings())
    assert main([], root=tmp_path) == 0
    edit(tmp_path, "expected.json", lambda d: d.update(validity="invalid"))
    assert main([], root=tmp_path) == 1


def test_bundles_declare_estimated_travel_and_other_providers_are_refused(tmp_path):
    """Road and imported matrices are M6; replaying them as estimated travel would be wrong."""
    expected = write_bundle(tmp_path, settings())
    assert expected["travel"] == {"provider": "estimated", "circuity": 1.2}
    edit(
        tmp_path,
        "expected.json",
        lambda d: d.update(travel={"provider": "valhalla", "profile": "truck"}),
    )
    lines: list[str] = []
    assert replay(tmp_path, out=lines.append) == ["travel_provider"]
    assert "valhalla" in lines[0]
    assert not any(line.startswith("preflight") for line in lines)  # refused before any rerun


def test_a_bundle_recorded_before_provenance_fields_still_replays(tmp_path):
    write_bundle(tmp_path, settings())
    edit(tmp_path, "expected.json", lambda d: (d.pop("allocation"), d.pop("travel")))
    assert replay(tmp_path, out=lambda _: None) == []
