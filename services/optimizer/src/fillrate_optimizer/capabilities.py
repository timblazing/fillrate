"""Internal capabilities document (spec §3, §12).

The advanced UI and the Python export derive their options from this
document. Every behavior is labeled ``native`` (a pinned PyVRP feature) or
``preprocessing``/``workaround`` (done by Fillrate around the solver), and each
label is backed by a capability fixture in ``tests/``.
"""

from __future__ import annotations

import platform
import sys
from importlib.metadata import version
from typing import Literal

from pydantic import BaseModel

from .loads import TRAILER_53FT
from .travel import DEFAULT_CIRCUITY, DEFAULT_MAX_LEG_M

SCHEMA_VERSION = 1
ADAPTER_VERSION = "pyvrp-partition/1"

PINNED = ("pyvrp", "ortools", "scikit-learn", "numpy", "h3", "fastapi", "pydantic")


class Behavior(BaseModel):
    id: str
    availability: Literal["implemented", "planned", "unsupported"] = "implemented"
    provided_by: Literal["native", "preprocessing", "workaround", "validation"]
    restrictions: list[str] = []
    description: str
    fixture: str | None


class Limits(BaseModel):
    max_stops_per_solve: int = 500
    max_orders: int = 5_000
    run_wall_limit_seconds: int = 600
    solve_attempt_limit_seconds: int = 300


class Defaults(BaseModel):
    trailer_capacity: int = TRAILER_53FT
    circuity: float = DEFAULT_CIRCUITY
    max_leg_m: int = DEFAULT_MAX_LEG_M
    # Optional policy, off by default (spec v1.8): the 500-mile rule is per leg only.
    max_cluster_diameter_m: int | None = None


class Units(BaseModel):
    distance: str = "meters (integer)"
    linear_feet: str = "hundredths of a foot (integer)"
    money: str = "cents (integer)"


class Capabilities(BaseModel):
    schema_version: int = SCHEMA_VERSION
    adapter_version: str = ADAPTER_VERSION
    python: str
    platform: str
    versions: dict[str, str]
    travel_modes: list[str]
    behaviors: list[Behavior]
    limits: Limits
    defaults: Defaults
    units: Units


BEHAVIORS = [
    Behavior(
        id="directed_road_travel",
        availability="implemented",
        provided_by="preprocessing",
        description=(
            "M6: immutable directed travel snapshots (imported or Valhalla truck matrices) are "
            "stored by content hash and selected in run settings or the /scenarios workbench; "
            "the worker's travel stage, reachability, the submission preflight and the "
            "independent validator read that matrix. A durable job builds a Valhalla `truck` "
            "snapshot from the deployment's pinned service (docs/valhalla.md); stops outside "
            "its coverage get unreachable edges, never an estimate."
        ),
        restrictions=[
            "Static matrices only: no traffic or time-dependent travel. A recorded snapshot is "
            "immutable and replays exactly; rebuilding can differ slightly because Valhalla's "
            "CostMatrix results depend on which locations share a request (the block size is "
            "recorded).",
            "Live Valhalla verified on local Colima on Apple silicon (arm64) with the pinned "
            "valhalla-scripted 3.9.0 image and Geofabrik Tennessee/Mississippi/Arkansas "
            "extracts dated 2026-10-05; each deployment records its own coverage, and the "
            "owner's production deployment is not verified.",
            "Coverage is whatever the deployment built: a stop outside it is unreachable.",
            "Valhalla is optional; estimated haversine x circuity stays the default.",
        ],
        fixture="tests/test_travel_snapshots.py::test_snapshot_legs_and_reachability_replace_the_estimate",
    ),
    Behavior(
        id="capacitated_loads",
        provided_by="native",
        description="Linear feet as the only load dimension; one vehicle type, unlimited count.",
        fixture="tests/test_pyvrp_capabilities.py::test_capacity_splits_across_trucks",
    ),
    Behavior(
        id="fixed_truck_cost",
        provided_by="native",
        description="Fixed cost per truck steers the solver toward fewer, fuller trucks.",
        fixture="tests/test_pyvrp_capabilities.py::test_fixed_cost_prefers_fewer_trucks",
    ),
    Behavior(
        id="open_routes",
        provided_by="workaround",
        description=(
            "PyVRP 0.14.0 requires an end depot. Every stop → depot edge has zero distance, "
            "so trucks do not pay for a return leg."
        ),
        fixture="tests/test_pyvrp_capabilities.py::test_open_route_has_free_return",
    ),
    Behavior(
        id="max_leg_distance",
        provided_by="preprocessing",
        description=(
            "Legs over the limit are omitted from the model. PyVRP prices missing edges at "
            "MAX_VALUE (2^44), not as a hard constraint, so the validator rejects any "
            "solution that still uses one."
        ),
        fixture="tests/test_pyvrp_capabilities.py::test_prohibited_leg_is_avoided_when_possible",
    ),
    Behavior(
        id="max_cluster_diameter",
        provided_by="preprocessing",
        description=(
            "Optional policy, off by default. When a limit is set: k-means on 3D unit vectors, "
            "then deterministic 2-means bisection of any cluster whose widest pair "
            "(haversine × cluster circuity) exceeds it. The validator re-checks it."
        ),
        restrictions=["Off unless max_cluster_diameter_m is set in run settings."],
        fixture="tests/test_pipeline.py::test_diameter_repair_splits_wide_cluster",
    ),
    Behavior(
        id="graph_reachability",
        provided_by="preprocessing",
        description=(
            "Before solving, each cluster's allowed-leg graph is searched from the depot. "
            "Visits with no path are reported unreachable (or unreachable in their partition), "
            "not solved."
        ),
        fixture="tests/test_pipeline.py::test_partition_that_removes_the_bridge_is_diagnosed",
    ),
    Behavior(
        id="truck_count_first_objective",
        provided_by="preprocessing",
        description=(
            "Fixed truck cost F = n·L + 1 per cluster (n visits, L leg limit) so any feasible plan "
            "with fewer trucks outranks one with more; then distance."
        ),
        restrictions=[
            "One depot, open routes, distance-only costs.",
            "With a fleet (heterogeneous_fleet_pipeline) every vehicle type carries the same F, so "
            "the count of trucks of any type is minimized first, then distance.",
        ],
        fixture="tests/test_pipeline.py::test_trucks_first_vs_weighted_zero_counterexample",
    ),
    Behavior(
        id="time_windows",
        provided_by="native",
        description=(
            "Per-visit service-start windows on a single-day horizon in the scenario's IANA "
            "timezone, normalized to integer seconds from local midnight. PyVRP client "
            "tw_early/tw_late and edge durations are native; trucks leave at depot_open "
            "(vehicle tw_early = start_late) and finish by horizon_end (vehicle tw_late). "
            "The validator recomputes arrival, wait, start and departure from the raw "
            "durations; preflight blocks empty and provably unreachable windows."
        ),
        restrictions=[
            "Single planning day; the horizon ends at 24:00 by default and at most 48:00.",
            "Nonexistent local times are rejected; ambiguous ones need an explicit fold.",
            "No release times.",
            "Clustering ignores windows; each cluster enforces them when solved.",
            "Open routes: synthetic return edges have zero duration and the end depot is "
            "unconstrained, so the route ends at its last departure "
            "(tests/test_time_windows.py terminal fixture).",
            "Estimated durations use the constant provider speed.",
        ],
        fixture="tests/test_time_windows.py::test_native_fields_wait_for_the_window_and_pay_service",
    ),
    Behavior(
        id="service_durations",
        provided_by="native",
        description=(
            "Per-visit service minutes (defaulted from the location) become PyVRP client "
            "service_duration; the truck is busy for that long before the next leg."
        ),
        restrictions=[
            "Single planning day, no release times; clustering ignores service durations.",
            "Every visit of a location split across trucks inherits the location's service "
            "duration and window.",
        ],
        fixture="tests/test_time_windows.py::test_service_duration_changes_feasibility_and_truck_count",
    ),
    Behavior(
        id="warm_start",
        provided_by="native",
        description=(
            "Run setting warm_start {kind: run, run_id} or {kind: manual_baseline, baseline_id}: "
            "each cluster starts PyVRP's search from the source's validated plan "
            "(pyvrp.solve initial_solution). With a feasible initial solution the pinned search "
            "keeps it as the incumbent, so the returned objective is never higher. Fillrate "
            "passes a plan only after the independent validator accepts it on the new problem; "
            "every cluster records used or skipped "
            "with a reason, and the plan is a recorded input of the solve stage."
        ),
        restrictions=[
            "Compatibility rule: same travel identity (estimated circuity or snapshot), a "
            "validated source cluster that planned exactly the same visit IDs, and the same "
            "location and load for every visit; otherwise the cluster is solved cold "
            "(travel_changed, visit_set_changed, source_invalid, demand_changed).",
            "The mapped plan must pass the independent validator on the new problem "
            "(invalid_on_new_problem) and be complete and feasible to PyVRP (solver_rejected). "
            "Pinned PyVRP accepts infeasible, incomplete or mismatched initial solutions without "
            "an error (tests/test_warm_start.py), so Fillrate refuses them instead.",
            "Sources are succeeded pipeline runs the submitter can read, or the submitter's saved "
            "manual baselines that the evaluator found valid when saved. A baseline covers one "
            "cluster of the run it was made on; other clusters are solved cold "
            "(visit_set_changed). An invalid baseline is never a source.",
            "Warm starts change solver provenance only, never the comparison signature.",
        ],
        fixture="tests/test_warm_start.py::test_feasible_initial_solution_is_never_worsened",
    ),
    Behavior(
        id="independent_validation",
        provided_by="validation",
        description=(
            "Coverage, piece lineage, capacity, physical legs, cluster membership and (when "
            "enabled) diameter are rechecked from the raw travel artifact; with the time-window "
            "adapter, window and horizon feasibility are recomputed from raw durations. "
            "Solver feasibility is never trusted alone."
        ),
        fixture="tests/test_pipeline.py::test_validator_rejects_solver_feasible_missing_edge_candidate",
    ),
    Behavior(
        id="manual_evaluator",
        provided_by="validation",
        description=(
            "A hand-edited plan for one cluster of a completed pipeline run (ordered visit IDs "
            "per truck: reorder visits, move them between trucks, add or remove trucks) is "
            "checked by the same independent validator against the run's recorded travel "
            "artifact, problem, visit lineage and, for snapshot runs, the selected snapshot. "
            "It reports concrete violations and the run's cluster metrics and objective for "
            "both the manual and the optimized plan; the optimized plan reproduces the run."
        ),
        restrictions=[
            "One cluster at a time, within that cluster's visits; visits cannot move between "
            "clusters.",
            "Evaluation alone stores nothing: a valid manual plan is a baseline, not a solver "
            "result. A saved baseline (separate endpoint) can be a warm-start source only "
            "while it is valid.",
        ],
        fixture=(
            "tests/test_evaluate.py::"
            "test_evaluating_the_optimized_routes_reproduces_the_recorded_metrics"
        ),
    ),
    Behavior(
        id="heterogeneous_fleet_pipeline",
        provided_by="native",
        description=(
            "Run setting fleet: a list of vehicle types (id, label, count or unlimited, capacity "
            "in hundredths of a foot, fixed and per-mile cents). Every cluster's PyVRP model "
            "gets one VehicleType per type (capacity, fixed cost, unit distance cost, and a "
            "per-cluster num_available), so capacities and costs bind natively. Fill is measured "
            "against each truck's own capacity; stops are split to, and oversize pieces checked "
            "against, the largest type. The independent validator checks each truck against its "
            "type's capacity and each type's count; manual plans and warm starts carry a type "
            "per route and are refused when they do not match the run's fleet. The fleet is part "
            "of the comparison signature and the replay bundle."
        ),
        restrictions=[
            "Delivery capacity in linear feet only: no other load dimensions, and no per-type "
            "max distance or shift duration in the pipeline yet.",
            "Every type starts and ends at the single depot with the same open-route workaround.",
            "Counts are fleet-wide, which PyVRP cannot express across independent clusters; see "
            "fleet_wide_counts. A count may be null for unlimited, as the single trailer is.",
            "Without a fleet the pipeline is exactly the single unlimited trailer: identical "
            "settings, stage identities and results.",
            "Cost objective: each type's cents rates are scaled by one common divisor into exact "
            "integer PyVRP costs and converted to cents once.",
        ],
        fixture="tests/test_fleet.py::test_vehicle_types_bind_capacity_and_fill_is_per_type",
    ),
    Behavior(
        id="fleet_wide_counts",
        provided_by="workaround",
        description=(
            "Vehicle counts apply to the whole dispatch, but clusters are solved independently. "
            "Fillrate solves clusters in order, each against the vehicles of every type that "
            "earlier clusters left (the model's num_available), then an independent check sums "
            "every type across clusters and marks the plan invalid with a concrete violation "
            "when any count is exceeded. PyVRP does not enforce counts across clusters."
        ),
        restrictions=[
            "A greedy order rule, not an optimal allocation of vehicles to clusters: an early "
            "cluster can take vehicles a later one needs, which then has no candidate.",
            "The manual evaluator checks one cluster against the full counts; the fleet-wide sum "
            "is a run-level check.",
        ],
        fixture="tests/test_fleet.py::test_counts_are_fleet_wide_across_clusters",
    ),
]


def capabilities() -> Capabilities:
    return Capabilities(
        python=sys.version.split()[0],
        platform=f"{platform.system().lower()}-{platform.machine()}",
        versions={name: version(name) for name in PINNED},
        travel_modes=["haversine", "imported", "valhalla"],
        behaviors=BEHAVIORS,
        limits=Limits(),
        defaults=Defaults(),
        units=Units(),
    )
