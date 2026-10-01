"""Offline replay of an exported pipeline run (spec §13, M4/M7).

`replay.py` in the web app's Python bundle calls `main()` here, so the checks that the README
documents are ordinary tested code. The bundle holds the scenario, the recorded settings, the
recorded deterministic stage artifacts and `expected.json`; nothing here needs the network.

Semantics (see the bundle README):

* Deterministic stages (preflight, allocation, aggregation, clustering) must reproduce exactly.
  Their recorded payloads are compared after dropping measured runtimes (`runtime_s`): a CP-SAT
  allocation stage records how long it took, which is provenance and never repeats.
* The plan is rebuilt and validated again. Validity, allocation strategy and policy must always
  match. Coverage, shipments, planned revenue and loaded miles must match only when the run used an
  iteration budget on the recorded versions; with a time budget, an override or version drift they
  are reported, not required.
* Travel is the pipeline's estimated haversine × circuity matrix, which the settings already carry,
  or the stored directed travel snapshot named by `travel_snapshot_id` (M6). A snapshot ships in
  the bundle as `travel-snapshot.json`; it must hash to the recorded identity before anything is
  rerun, and the recorded travel provenance must reproduce. A bundle that declares any other
  travel provider is refused rather than silently replayed with estimated travel.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .canonical import content_hash
from .model import RunSettings, ScenarioDocument
from .pipeline import PipelineOutput, run_pipeline, versions
from .travel_provider import TravelSnapshot

DETERMINISTIC_STAGES = ("preflight", "allocation", "aggregation", "clustering")
# Measured wall-clock values recorded as provenance; they never repeat and are not results.
MEASURED_KEYS = frozenset({"runtime_s"})
ESTIMATED_TRAVEL = "estimated"
SNAPSHOT_TRAVEL = "snapshot"
SNAPSHOT_FILE = "travel-snapshot.json"


def without_measured(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: without_measured(v) for k, v in value.items() if k not in MEASURED_KEYS}
    if isinstance(value, list):
        return [without_measured(v) for v in value]
    return value


def stage_digest(payload: Any) -> str:
    """Content hash of a stage payload without its measured runtimes."""
    return content_hash(without_measured(payload))


def expected_record(run_id: str, output: PipelineOutput, settings: RunSettings) -> dict[str, Any]:
    """The `expected.json` of a finished run; the web export writes the same shape."""
    summary = output.summary
    return {
        "run_id": run_id,
        "validity": summary.validity,
        "coverage": summary.coverage,
        "totals": summary.totals.model_dump(mode="json"),
        "clustering": summary.clustering.model_dump(mode="json"),
        "versions": summary.versions,
        "deterministic_output_hashes": {
            stage: next(
                (a.manifest["output_hash"] for a in output.artifacts if a.stage == stage), None
            )
            for stage in DETERMINISTIC_STAGES
        },
        "allocation": summary.allocation.model_dump(
            mode="json", include={"strategy", "fulfillment_policy", "kind"}
        ),
        "travel": travel_record(output, settings),
        "iteration_based": settings.solver_max_iterations is not None,
    }


def travel_record(output: PipelineOutput, settings: RunSettings) -> dict[str, Any]:
    travel = output.summary.travel
    if travel is not None and travel.mode == "snapshot":
        return {
            "provider": SNAPSHOT_TRAVEL,
            "snapshot_id": settings.travel_snapshot_id,
            "summary": travel.model_dump(mode="json"),
        }
    return {"provider": ESTIMATED_TRAVEL, "circuity": settings.travel_circuity}


def load_snapshot(root: Path, settings: RunSettings, travel: dict[str, Any], out) -> TravelSnapshot:
    """The bundled snapshot, or a ValueError naming why it cannot be trusted."""
    recorded = travel.get("snapshot_id")
    if settings.travel_snapshot_id != recorded:
        raise ValueError("the settings and expected.json name different travel snapshots")
    path = root / SNAPSHOT_FILE
    if not path.exists():
        raise ValueError(f"the bundle declares a travel snapshot but {SNAPSHOT_FILE} is missing")
    snapshot = TravelSnapshot.model_validate(json.loads(path.read_text()))
    verified = snapshot.identity == recorded
    out(f"{'travel':<12} {'snapshot identity verified' if verified else 'IDENTITY DIFFERS'}")
    if not verified:
        raise ValueError(f"{SNAPSHOT_FILE} does not hash to the recorded identity")
    return snapshot


def recorded_payload(root: Path, stage: str) -> Any | None:
    path = root / "artifacts" / f"{stage}.json"
    return json.loads(path.read_text())["payload"] if path.exists() else None


def replay(
    root: Path, *, iterations: int | None = None, out: Callable[[str], None] = print
) -> list[str]:
    """Replay the bundle in `root`; returns the failed checks (empty means REPLAY OK)."""
    expected = json.loads((root / "expected.json").read_text())
    travel = expected.get("travel") or {"provider": ESTIMATED_TRAVEL}
    provider = travel.get("provider")
    if provider not in (ESTIMATED_TRAVEL, SNAPSHOT_TRAVEL):
        out(f"travel provider {provider!r} cannot be replayed by this optimizer")
        return ["travel_provider"]
    scenario = ScenarioDocument.model_validate(json.loads((root / "scenario.json").read_text()))
    settings = RunSettings.model_validate(json.loads((root / "settings.json").read_text()))
    snapshot = None
    if provider == ESTIMATED_TRAVEL and settings.travel_snapshot_id:
        out("the settings select a travel snapshot but the bundle records estimated travel")
        return ["travel_provider"]
    if provider == SNAPSHOT_TRAVEL:
        try:
            snapshot = load_snapshot(root, settings, travel, out)
        except ValueError as error:
            out(f"{error}\nREPLAY FAILED: travel_snapshot")
            return ["travel_snapshot"]
    exact = bool(expected["iteration_based"])
    if iterations:
        settings = settings.model_copy(update={"solver_max_iterations": iterations})
        exact = False
    local = versions()
    drift = {k: (v, local.get(k)) for k, v in expected["versions"].items() if local.get(k) != v}
    if drift:
        out(f"note: versions differ from the recording: {drift}")
        exact = False

    result = run_pipeline(scenario, settings, travel_snapshot=snapshot)
    failures: list[str] = []
    hashes = {a.stage: a.manifest["output_hash"] for a in result.artifacts}
    payloads = {a.stage: a.payload for a in result.artifacts}
    for stage, recorded in expected["deterministic_output_hashes"].items():
        recorded_stage = recorded_payload(root, stage)
        if recorded is None:
            same, note = True, ""
        elif recorded_stage is not None:
            same = stage_digest(recorded_stage) == stage_digest(payloads[stage])
            note = " (measured runtimes differ)" if same and hashes.get(stage) != recorded else ""
        else:
            same, note = hashes.get(stage) == recorded, ""
        out(f"{stage:<12} {'reproduced' + note if same else 'DIFFERS'}")
        if not same:
            failures.append(stage)

    summary, totals = result.summary, expected["totals"]
    if snapshot and travel.get("summary") is not None:
        recorded_travel = summary.travel.model_dump(mode="json") if summary.travel else None
        same = recorded_travel == travel["summary"]
        out(f"{'travel data':<12} {'reproduced' if same else 'DIFFERS'}")
        if not same:
            failures.append("travel_data")
    recorded_allocation = expected.get("allocation")
    if recorded_allocation:
        now = {
            "strategy": summary.allocation.strategy,
            "fulfillment_policy": summary.allocation.fulfillment_policy,
        }
        for name, value in now.items():
            same = recorded_allocation[name] == value
            out(
                f"{name:<18} recorded {recorded_allocation[name]!s:<20} replay {value!s:<20} "
                f"{'=' if same else '≠'}"
            )
            if not same:
                failures.append(name)
    rows = [
        ("validity", expected["validity"], summary.validity),
        ("coverage", expected["coverage"], summary.coverage),
        ("shipments", totals["trucks"], summary.totals.trucks),
        ("planned_cents", totals["planned_cents"], summary.totals.planned_cents),
        ("loaded_distance_m", totals["loaded_distance_m"], summary.totals.loaded_distance_m),
    ]
    for name, recorded_value, value in rows:
        same = recorded_value == value
        out(
            f"{name:<18} recorded {recorded_value!s:<12} replay {value!s:<12} "
            f"{'=' if same else '≠'}"
        )
        if not same and (exact or name == "validity"):
            failures.append(name)
    if not exact:
        out("solver metrics are informational: time budget, override or version drift (see README)")
    out("REPLAY OK" if not failures else f"REPLAY FAILED: {', '.join(failures)}")
    return failures


def main(argv: list[str] | None = None, root: Path | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--iterations", type=int, help="Rerun with a fixed solver iteration budget."
    )
    args = parser.parse_args(argv)
    return 1 if replay(root or Path.cwd(), iterations=args.iterations) else 0


if __name__ == "__main__":
    sys.exit(main())
