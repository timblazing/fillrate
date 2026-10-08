"""Leg drive seconds on planned trucks (spec §13, M7 timeline)."""

import json
from pathlib import Path

from fillrate_optimizer.model import RunSettings, RunSummary, ScenarioDocument
from fillrate_optimizer.pipeline import run_pipeline


def run(_travel=None):
    document = json.loads((Path(__file__).parents[3] / "examples/m1-synthetic.json").read_text())
    return run_pipeline(
        ScenarioDocument.model_validate(document["scenario"]),
        RunSettings.model_validate(document["settings"]),
    )


def test_estimated_leg_seconds_use_the_constant_speed():
    summary = run(None).summary
    assert summary.trucks
    for truck in summary.trucks:
        assert truck.drive_s == sum(v.leg_s for v in truck.visits)
        for visit in truck.visits:
            # meters are already haversine x circuity; seconds = meters / 11.176 m/s
            assert abs(visit.leg_s - visit.leg_m / 11.176) <= 1.5


def test_results_persisted_before_leg_seconds_still_validate():
    summary = run(None).summary.model_dump(mode="json")
    for truck in summary["trucks"]:
        truck.pop("drive_s")
        for visit in truck["visits"]:
            visit.pop("leg_s")
    old = RunSummary.model_validate(summary)
    assert all(t.drive_s is None and v.leg_s is None for t in old.trucks for v in t.visits)
