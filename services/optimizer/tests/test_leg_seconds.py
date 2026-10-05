"""Leg drive seconds on planned trucks (spec §13, M7 timeline)."""

from fillrate_optimizer.model import RunSummary

from .test_travel_snapshots import run, snapshot, snapshot_document


def test_snapshot_leg_seconds_follow_the_directed_duration_matrix():
    document = snapshot_document()
    ids = [node["id"] for node in document["nodes"]]
    # Make drive time directional and unrelated to distance: A -> C takes 7 s, C -> A 900 s.
    durations = [row[:] for row in document["durations"]]
    durations[ids.index("A")][ids.index("C")] = 7.4
    durations[ids.index("C")][ids.index("A")] = 900
    summary = run(snapshot(durations=durations)).summary
    truck = next(t for t in summary.trucks if len(t.visits) == 3)
    legs = {v.location_id: v for v in truck.visits}
    assert legs["C"].leg_s == 7  # nearest integer, same conversion as meters
    assert legs["A"].leg_s == 10_000  # D -> A: 100 km at the fixture's d / 10 seconds
    assert legs["E"].leg_s == 30_000
    # The synthetic return to the depot is neither planned nor timed.
    assert truck.drive_s == 10_000 + 7 + 30_000 == sum(v.leg_s for v in truck.visits)
    # The reverse direction is a different number, so legs are read directed.
    durations[ids.index("A")][ids.index("C")] = 901
    flipped = run(snapshot(durations=durations)).summary
    again = next(t for t in flipped.trucks if len(t.visits) == 3)
    assert {v.location_id: v.leg_s for v in again.visits}["C"] == 901


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
