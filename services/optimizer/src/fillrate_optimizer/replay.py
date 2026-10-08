"""Offline replay of an exported pipeline run (spec §13, M4/M7).

`replay.py` in the web app's Python bundle calls `main()` here, so the checks that the README
documents are ordinary tested code. The bundle holds the scenario, the recorded settings, the
recorded deterministic stage artifacts and `expected.json`; nothing here needs the network.

Semantics (see the bundle README):

* Deterministic stages (preflight, allocation, aggregation, clustering) must reproduce exactly.
  Their recorded payloads are compared after dropping measured runtimes (`runtime_s`), which are
  provenance and never repeat.
* The plan is rebuilt and validated again. Validity, allocation strategy and policy must always
  match. Coverage, shipments, planned revenue and loaded miles must match only when the run used an
  iteration budget on the recorded versions; with a time budget, an override or version drift they
  are reported, not required.
* Travel is the pipeline's estimated haversine × circuity matrix, which the settings already carry.
  A bundle that declares any other travel provider is refused rather than silently replayed with
  estimated travel.
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

DETERMINISTIC_STAGES = ("preflight", "allocation", "aggregation", "clustering")
# Measured wall-clock values recorded as provenance; they never repeat and are not results.
MEASURED_KEYS = frozenset({"runtime_s"})
ESTIMATED_TRAVEL = "estimated"


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
            mode="json", include={"strategy", "fulfillment_policy"}
        ),
        "travel": travel_record(output, settings),
        "iteration_based": settings.solver_max_iterations is not None,
    }


def travel_record(output: PipelineOutput, settings: RunSettings) -> dict[str, Any]:
    return {"provider": ESTIMATED_TRAVEL, "circuity": settings.travel_circuity}


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
    if provider != ESTIMATED_TRAVEL:
        out(f"travel provider {provider!r} cannot be replayed by this optimizer")
        return ["travel_provider"]
    scenario = ScenarioDocument.model_validate(json.loads((root / "scenario.json").read_text()))
    settings = RunSettings.model_validate(json.loads((root / "settings.json").read_text()))
    exact = bool(expected["iteration_based"])
    if iterations:
        settings = settings.model_copy(update={"solver_max_iterations": iterations})
        exact = False
    local = versions()
    drift = {k: (v, local.get(k)) for k, v in expected["versions"].items() if local.get(k) != v}
    if drift:
        out(f"note: versions differ from the recording: {drift}")
        exact = False

    result = run_pipeline(scenario, settings)
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
