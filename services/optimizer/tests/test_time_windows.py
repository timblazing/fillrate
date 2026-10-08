"""M6 time windows and service durations: normalization, the adapter, the validator, preflight."""

import json
from pathlib import Path

import numpy as np
import pytest
import pyvrp
from pydantic import ValidationError

from fillrate_optimizer.canonical import content_hash
from fillrate_optimizer.loads import (
    PartitionProblem,
    PartitionTime,
    PartitionVisit,
    build_partition_model,
    solve_partition,
)
from fillrate_optimizer.model import RunSettings, ScenarioDocument, TimeModel
from fillrate_optimizer.pipeline import PipelineError, run_pipeline, validate_cluster
from fillrate_optimizer.preflight import preflight_checks
from fillrate_optimizer.synthetic_time import SETTINGS as TW_SETTINGS
from fillrate_optimizer.timeplan import time_context
from fillrate_optimizer.timewin import VisitTime, elapsed_s, recompute_route

from .conftest import MEMPHIS, east

ROOT = Path(__file__).resolve().parents[3] / "examples"
CHI = "America/Chicago"
# The hash the M1 example had before the time model existed; unset fields must not change it.
M1_HASH = "6872e971f0bf6574530afa48adb90ec8fd97db41f455d4790b9ccadeea268400"


def example(name: str):
    document = json.loads((ROOT / name).read_text())
    return (
        ScenarioDocument.model_validate(document["scenario"]),
        RunSettings.model_validate(document["settings"]),
    )


# ---- normalization ---------------------------------------------------------------------------


def test_clock_times_are_elapsed_seconds_from_local_midnight():
    assert elapsed_s(CHI, "2026-10-06", "00:00") == 0
    assert elapsed_s(CHI, "2026-10-06", "09:30") == 9 * 3600 + 1800
    assert elapsed_s(CHI, "2026-10-06", "24:00") == 86_400


def test_spring_forward_gap_is_rejected_and_the_skipped_hour_is_not_counted():
    # 2026-03-08: 02:00 CST jumps to 03:00 CDT, so 03:00 is two elapsed hours after midnight.
    assert elapsed_s(CHI, "2026-03-08", "03:00") == 7200
    assert elapsed_s(CHI, "2026-03-08", "24:00") == 23 * 3600
    with pytest.raises(ValueError, match="does not exist"):
        elapsed_s(CHI, "2026-03-08", "02:30")


def test_fall_back_overlap_needs_an_explicit_fold():
    # 2026-11-01: 02:00 CDT falls back to 01:00 CST, so 01:30 happens twice.
    with pytest.raises(ValueError, match="ambiguous"):
        elapsed_s(CHI, "2026-11-01", "01:30")
    assert elapsed_s(CHI, "2026-11-01", "01:30", 0) == 5400
    assert elapsed_s(CHI, "2026-11-01", "01:30", 1) == 9000
    assert elapsed_s(CHI, "2026-11-01", "24:00") == 25 * 3600


def test_after_midnight_clock_times_and_the_48_hour_limit():
    assert elapsed_s(CHI, "2026-10-06", "25:30") == 25 * 3600 + 1800
    assert elapsed_s(CHI, "2026-10-06", "48:00") == 48 * 3600
    for bad in ("48:01", "49:00", "9:00", "09:60"):
        with pytest.raises(ValueError):
            elapsed_s(CHI, "2026-10-06", bad)
    with pytest.raises(ValidationError):
        TimeModel(timezone=CHI, planning_date="2026-10-06", horizon_end="49:00")
    with pytest.raises(ValidationError, match="IANA"):
        TimeModel(timezone="Mars/Olympus", planning_date="2026-10-06")


def scenario_doc(locations, time_model=None, orders=None):
    return {
        "name": "tw",
        "depot": {"id": "D", "label": "Depot", "lat": MEMPHIS[0], "lon": MEMPHIS[1]},
        "products": [{"id": "P", "label": "Pallet", "linear_feet_per_piece": 400}],
        "locations": [
            {
                "id": i,
                "label": i,
                "lat": at[0],
                "lon": at[1],
                "coordinate_source": "imported",
                **extra,
            }
            for i, at, extra in locations
        ],
        "orders": orders
        or [
            {
                "id": f"O-{i}",
                "location_id": i,
                "order_date": "2026-10-05",
                "lines": [
                    {
                        "id": f"L-{i}",
                        "product_id": "P",
                        "ordered_pieces": 2,
                        "net_value_per_piece_cents": 100,
                    }
                ],
            }
            for i, _, _ in locations
        ],
        "inventory": [{"product_id": "P", "available_pieces": 100}],
        **({"time_model": time_model} if time_model else {}),
    }


TM = {"timezone": CHI, "planning_date": "2026-10-06", "depot_open": "06:00", "horizon_end": "26:00"}


def test_windows_need_a_time_model_and_must_fit_the_horizon():
    loc = [("A", east(10), {"window": {"earliest": "08:00", "latest": "09:00"}})]
    with pytest.raises(ValidationError, match="need a time_model"):
        ScenarioDocument.model_validate(scenario_doc(loc))
    with pytest.raises(ValidationError, match="need a time_model"):
        ScenarioDocument.model_validate(scenario_doc([("A", east(10), {"service_minutes": 5})]))
    late = [("A", east(10), {"window": {"earliest": "08:00", "latest": "27:00"}})]
    with pytest.raises(ValidationError, match="past the horizon"):
        ScenarioDocument.model_validate(scenario_doc(late, TM))
    after_midnight = [("A", east(10), {"window": {"earliest": "23:00", "latest": "25:30"}})]
    doc = ScenarioDocument.model_validate(scenario_doc(after_midnight, TM))
    ctx = time_context(doc)
    assert ctx.locations["A"].latest_s == 25 * 3600 + 1800 and ctx.horizon_end_s == 26 * 3600


def test_ambiguous_window_time_uses_the_window_fold():
    tm = {"timezone": CHI, "planning_date": "2026-11-01"}
    window = {"earliest": "01:30", "latest": "03:00"}
    with pytest.raises(ValidationError, match="ambiguous"):
        ScenarioDocument.model_validate(scenario_doc([("A", east(5), {"window": window})], tm))
    doc = ScenarioDocument.model_validate(
        scenario_doc([("A", east(5), {"window": {**window, "fold": 1}})], tm)
    )
    assert time_context(doc).locations["A"].earliest_s == 9000


# ---- the model is unchanged without a time model ----------------------------------------------


def test_documents_without_time_fields_keep_their_hash_and_shape():
    scenario, _ = example("m1-synthetic.json")
    dumped = scenario.model_dump(mode="json")
    assert content_hash(dumped) == M1_HASH
    assert "time_model" not in dumped
    assert all("window" not in loc and "service_minutes" not in loc for loc in dumped["locations"])
    assert time_context(scenario) is None


def test_a_time_model_without_windows_or_service_leaves_the_run_untouched():
    doc = scenario_doc([("A", east(10), {})], {"timezone": CHI, "planning_date": "2026-10-06"})
    scenario = ScenarioDocument.model_validate(doc)
    assert time_context(scenario) is None
    out = run_pipeline(scenario, RunSettings(solver_max_iterations=100))
    stage = {x.stage: x.payload for x in out.artifacts}
    assert all("time" not in prob for prob in stage["problem"]["clusters"])
    assert out.summary.time is None
    visit = out.summary.trucks[0].visits[0]
    assert visit.arrival_s is None and "arrival_s" not in visit.model_dump(mode="json")


def square(distance, duration):
    return PartitionProblem(
        distance=np.array(distance, dtype=np.int64),
        visits=[PartitionVisit("a", 1, 100), PartitionVisit("b", 2, 100)],
        capacity=5_300,
        max_leg_m=1_000_000,
        truck_penalty=1_000_000,
        max_iterations=200,
        max_runtime_s=5,
        time=duration,
    )


D3 = [[0, 10, 10], [10, 0, 1], [10, 1, 0]]  # meters; depot, A, B


def ptime(visits, seconds=((0, 50, 50), (50, 0, 10), (50, 10, 0)), open_s=0, horizon=10_000):
    return PartitionTime(np.array(seconds, dtype=np.int64), visits, open_s, horizon)


def test_the_partition_model_has_no_time_data_without_the_adapter():
    model = build_partition_model(square(D3, None))
    data = model.data()
    assert all(c.tw_early == 0 and c.tw_late == np.iinfo(np.int64).max for c in data.clients())
    assert all(c.service_duration == 0 for c in data.clients())
    assert not np.any(data.duration_matrix(0))
    vt = data.vehicle_type(0)
    assert vt.tw_early == 0 and vt.tw_late == np.iinfo(np.int64).max


# ---- adapter: waiting, service, terminal semantics --------------------------------------------


def test_native_fields_wait_for_the_window_and_pay_service():
    problem = square(D3, ptime([VisitTime(30, 500, 900), VisitTime(0, None, None)], open_s=100))
    model = build_partition_model(problem)
    data = model.data()
    a = data.client(0)
    assert (a.tw_early, a.tw_late, a.service_duration) == (500, 900, 30)
    vt = data.vehicle_type(0)
    assert (vt.tw_early, vt.start_late, vt.tw_late) == (100, 100, 10_000)
    best = model.solve(pyvrp.stop.MaxIterations(50), seed=0, display=False).best
    assert best.is_feasible()
    # The route that serves A: arrive 150, wait to 500, serve 30 s.
    served_a = next(r for r in best.routes() if any(v.is_client() and v.idx == 1 for v in r))
    assert served_a.wait_duration() >= 350 and served_a.service_duration() >= 30


def one_or_two_trucks(service_s):
    visits = [VisitTime(service_s, None, 120), VisitTime(service_s, None, 120)]
    return solve_partition(square(D3, ptime(visits)))


def test_service_duration_changes_feasibility_and_truck_count():
    assert len(one_or_two_trucks(0).routes) == 1  # A at 50, B at 60: both inside 120
    result = one_or_two_trucks(100)  # A done at 150, so B at 160 misses 120 on one truck
    assert result.solver_feasible and len(result.routes) == 2


def test_an_unreachable_window_has_no_feasible_candidate():
    visits = [VisitTime(0, None, 20), VisitTime(0, None, None)]  # A is 50 s away
    assert not solve_partition(square(D3, ptime(visits))).solver_feasible


def test_terminal_return_is_free_in_time_and_the_end_depot_does_not_constrain():
    # The raw return legs take 3000 s, but the synthetic return costs nothing: the route may
    # finish at its last departure even when departure + a real return would pass the horizon.
    seconds = [[0, 50, 50], [3000, 0, 10], [3000, 10, 0]]
    visits = [VisitTime(100, None, None), VisitTime(100, None, None)]
    problem = square(D3, ptime(visits, seconds, horizon=300))
    model = build_partition_model(problem)
    data = model.data()
    assert data.duration_matrix(0)[1, 0] == 0 and data.duration_matrix(0)[2, 0] == 0
    assert data.depot(0).tw_early == 0 and data.depot(0).tw_late == np.iinfo(np.int64).max
    result = model.solve(pyvrp.stop.MaxIterations(50), seed=0, display=False)
    assert result.is_feasible()
    route = result.best.routes()[0]
    assert sum(v.is_client() for v in route) == 2
    assert route.end_time() == route.start_time() + 50 + 100 + 10 + 100
    assert route.end_time() <= 300
    # The independent recomputation agrees: route end is the last departure, no return added.
    timings, violations = recompute_route([50, 10], visits, ["a", "b"], 0, 300)
    assert timings[-1].departure_s == route.end_time() and violations == []


# ---- the independent validator ----------------------------------------------------------------


def test_recompute_route_waits_serves_and_flags_violations():
    visits = [VisitTime(60, 500, 600), VisitTime(30, 0, 700)]
    timings, violations = recompute_route([100, 50], visits, ["a", "b"], 200, 1_000)
    a, b = timings
    assert (a.arrival_s, a.wait_s, a.start_s, a.departure_s) == (300, 200, 500, 560)
    assert (b.arrival_s, b.wait_s, b.start_s, b.departure_s) == (610, 0, 610, 640)
    assert violations == []
    _, late = recompute_route([450, 50], visits, ["a", "b"], 200, 1_000)
    assert any("a: service would start at 650 s, after its window end 600 s" in v for v in late)
    _, over = recompute_route([100, 50], visits, ["a", "b"], 200, 630)
    assert any("route ends at 640 s, after the horizon end 630 s" in v for v in over)


def test_a_candidate_the_solver_accepts_on_tampered_durations_is_rejected():
    # The solver is handed durations that are far too short, so one truck looks feasible.
    visits = [VisitTime(0, None, 120), VisitTime(0, None, 120)]
    tampered = ((0, 5, 5), (5, 0, 5), (5, 5, 0))
    accepted = solve_partition(square(D3, ptime(visits, tampered)))
    assert accepted.solver_feasible and len(accepted.routes) == 1
    # The validator recomputes from the real durations (A 50 s from the depot, B 100 s after).
    _, violations = recompute_route([50, 100], visits, ["a", "b"], 0, 10_000)
    assert any(
        "b: service would start at 150 s, after its window end 120 s" in v for v in violations
    )


def run_example():
    scenario, settings = example("m6-time-windows.json")
    return scenario, settings, run_pipeline(scenario, settings)


def test_validate_cluster_rejects_a_solver_feasible_window_violation():
    scenario, settings, out = run_example()
    stage = {x.stage: x.payload for x in out.artifacts}
    meta, prob = stage["clustering"]["clusters"][0], stage["problem"]["clusters"][0]
    trav = stage["travel"]["clusters"][0]
    visits = {v["visit_id"]: v for v in stage["aggregation"]["visits"]}
    lines = {line.id: {"lf": 400, "value": 42_000} for o in scenario.orders for line in o.lines}
    by_loc = {v["location_id"]: vid for vid, v in visits.items()}
    from fillrate_optimizer.pipeline import duration_leg_reader

    locs = sorted(by_loc)
    reader = duration_leg_reader(
        locs,
        scenario.depot,
        {loc.id: (loc.lat, loc.lon) for loc in scenario.locations},
        settings.travel_circuity,
    )
    # TW-C (13:00-15:00) before TW-A (09:00-10:00) on one truck: A starts after 13:30.
    solve = {
        "status": "solved",
        "solver_feasible": True,
        "routes": [
            [by_loc["TW-C"], by_loc["TW-A"]],
            [by_loc["TW-B"]],
            [by_loc["TW-D"]],
            [by_loc["TW-E"]],
            [by_loc["TW-F"]],
        ],
    }
    check = validate_cluster(meta, prob, trav, solve, visits, lines, settings, reader)
    assert not check["valid"]
    assert any("TW-A: service would start" in v and "window end" in v for v in check["violations"])


# ---- preflight --------------------------------------------------------------------------------


def preflight(locations, tm=TM, **settings):
    scenario = ScenarioDocument.model_validate(scenario_doc(locations, tm))
    return {f.check: f for f in preflight_checks(scenario, RunSettings(**settings))}


def test_preflight_blocks_an_empty_window():
    found = preflight([("A", east(10), {"window": {"earliest": "10:00", "latest": "09:00"}})])
    assert found["window_empty"].action == "block"
    assert found["window_empty"].location_ids == ["A"] and found["window_empty"].line_ids == ["L-A"]
    assert "earliest 10:00:00 is after latest 09:00:00" in found["window_empty"].message


def test_preflight_blocks_a_window_the_depot_cannot_reach_in_time():
    # 120 mi x 1.2 circuity at 11.176 m/s is about 5.8 h; leaving at 06:00 cannot make 08:00.
    locations = [
        ("FAR", east(120), {"window": {"earliest": "07:00", "latest": "08:00"}}),
        ("NEAR", east(10), {"window": {"earliest": "07:00", "latest": "09:00"}}),
    ]
    found = preflight(locations)
    finding = found["window_unreachable"]
    assert finding.action == "block" and finding.location_ids == ["FAR"]
    assert "shortest allowed drive from the depot" in finding.message
    assert "after the window end 08:00:00" in finding.message
    assert "window_empty" not in found
    # Service that cannot finish inside the horizon is provably infeasible too.
    late = preflight([("A", east(10), {"service_minutes": 1_000})], {**TM, "horizon_end": "10:00"})
    assert late["window_unreachable"].location_ids == ["A"]
    # A reachable window raises nothing.
    assert not preflight([("A", east(10), {"window": {"earliest": "07:00", "latest": "12:00"}})])


def test_pipeline_stops_on_a_blocking_time_finding():
    doc = scenario_doc(
        [("FAR", east(120), {"window": {"earliest": "07:00", "latest": "08:00"}})], TM
    )
    with pytest.raises(PipelineError) as error:
        run_pipeline(ScenarioDocument.model_validate(doc), RunSettings(solver_max_iterations=50))
    assert error.value.code == "preflight_blocked" and "window_unreachable" in str(error.value)


# ---- end to end ---------------------------------------------------------------------------------


def test_example_run_satisfies_an_independent_recomputation():
    scenario, settings, out = run_example()
    s = out.summary
    assert s.validity == "valid" and s.coverage == "complete" and not s.unplanned
    assert s.time and s.time.timezone == CHI and s.time.depot_open_s == 6 * 3600
    assert any(d.code == "clustering_ignores_windows" for d in s.diagnostics)
    windows = {loc.id: loc.window for loc in scenario.locations if loc.window is not None}
    services = {loc.id: loc.service_minutes * 60 for loc in scenario.locations}
    waited = 0
    for truck in s.trucks:
        clock = truck.shift_start_s
        assert clock == 6 * 3600
        for visit in truck.visits:
            arrival = clock + visit.leg_s
            earliest = (
                elapsed_s(CHI, "2026-10-06", windows[visit.location_id].earliest)
                if (visit.location_id in windows)
                else 0
            )
            start = max(arrival, earliest)
            assert (visit.arrival_s, visit.start_s) == (arrival, start)
            assert (
                visit.wait_s == start - arrival and visit.service_s == services[visit.location_id]
            )
            clock = start + visit.service_s
            assert visit.departure_s == clock
            if visit.location_id in windows:
                latest = elapsed_s(CHI, "2026-10-06", windows[visit.location_id].latest)
                assert visit.window_latest_s == latest and visit.start_s <= latest
            else:
                assert visit.window_latest_s is None
            waited += visit.wait_s
        assert truck.end_s == clock <= s.time.horizon_end_s
        assert truck.wait_s_total == sum(v.wait_s for v in truck.visits)
        assert truck.service_s_total == sum(v.service_s for v in truck.visits)
    assert waited > 0 and len(s.trucks) == 2
    # Bundled example settings are the module's; keep the two in lockstep.
    assert settings == TW_SETTINGS


def test_capabilities_list_the_time_behaviors_with_resolving_fixtures():
    from fillrate_optimizer.capabilities import BEHAVIORS

    behaviors = {b.id: b for b in BEHAVIORS}
    for name in ("time_windows", "service_durations"):
        behavior = behaviors[name]
        assert behavior.availability == "implemented" and behavior.provided_by == "native"
        module, _, test = behavior.fixture.partition("::")
        assert test in globals() and module == "tests/test_time_windows.py"
