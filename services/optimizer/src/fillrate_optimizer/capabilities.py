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
    # ---- Solver Lab (M6): generic normalized routing instances, not the fulfillment pipeline ----
    Behavior(
        id="solver_lab",
        provided_by="native",
        description=(
            "Lab instances (fillrate_optimizer.lab) create depots, clients and vehicle types "
            "directly and are solved by PyVRP 0.14.0 as one problem: routes between depots, every "
            "edge with its raw distance and duration, a seed and an iteration or "
            "runtime budget. Planar instances use rounded euclidean abstract units (never "
            "latitude/longitude); geographic ones haversine × circuity meters and "
            "constant-speed seconds. An independent validator recomputes coverage, loads, "
            "fleet counts, limits, distances, durations and the nominal objective, and flags "
            "any PyVRP route number that differs."
        ),
        restrictions=[
            "No time windows, release times, pickups, prizes, groups, "
            "shipments or reloads (each is refused as a planned capability).",
            "Heuristic search: results are the best found within the budget, never proven optimal.",
            "At most 500 clients, 8 dimensions and 10 vehicle types per instance.",
        ],
        fixture="tests/test_lab.py::test_lab_run_agrees_with_independent_validation",
    ),
    Behavior(
        id="multiple_load_dimensions",
        provided_by="native",
        description=(
            "Lab instances name 1–8 load dimensions with explicit integer units; client "
            "deliveries and vehicle capacities become PyVRP delivery/capacity vectors in the "
            "instance's dimension order. Any one dimension can bind."
        ),
        restrictions=[
            "Solver Lab only; the fulfillment pipeline still uses linear feet alone.",
            "Delivery loads only (no pickups).",
        ],
        fixture="tests/test_lab.py::test_weight_dimension_binds_and_changes_the_plan",
    ),
    Behavior(
        id="heterogeneous_fleet",
        provided_by="native",
        description=(
            "Lab vehicle types each have a finite count, per-dimension capacity, fixed cost, "
            "unit distance and duration costs, and optional per-route max distance and shift "
            "duration (PyVRP VehicleType). The validator checks counts per type."
        ),
        restrictions=[
            "Solver Lab instances; the pipeline's fleet is heterogeneous_fleet_pipeline.",
            "Every type starts and ends at its own start and end depots.",
            "Max distance and shift duration are penalized in PyVRP's search; only the "
            "independent validator decides whether a route respects them.",
        ],
        fixture="tests/test_lab.py::test_mixed_fleet_uses_cheaper_type_within_its_count",
    ),
    Behavior(
        id="multiple_depots",
        provided_by="native",
        description=(
            "Lab instances name up to 10 depots; each vehicle type has a start depot and an end "
            "depot (default: the first depot), which become PyVRP depots and "
            "VehicleType start_depot/end_depot. The matrices list the depots first, then the "
            "clients. The validator recomputes each route from its own start depot to its own "
            "end depot and rejects a route that does not use its type's depots."
        ),
        restrictions=[
            "Solver Lab only; the fulfillment pipeline still has one depot.",
            "No depot capacity, stock or opening hours: a depot is a place vehicles start and end.",
            "Every type's start and end depot is fixed in the instance; the solver does not "
            "choose which depot a vehicle uses.",
        ],
        fixture="tests/test_lab.py::test_vehicles_start_and_end_at_their_types_depots",
    ),
    Behavior(
        id="reloads",
        provided_by="native",
        description=(
            "Lab vehicle types may list reload depots and a maximum number of reloads (PyVRP "
            "VehicleType reload_depots/max_reloads): a vehicle returns to a reload depot, is full "
            "again, and starts another trip, so one vehicle can serve more than its capacity in "
            "one route. The validator splits every route into trips, resets the load at each "
            "reload and checks capacity per trip, the reload count and the reload depots."
        ),
        restrictions=[
            "Solver Lab only; the fulfillment pipeline has no reloads.",
            "A reload takes no time and costs nothing beyond the distance driven; max distance "
            "and shift duration apply to the whole route.",
            "Delivery loads only: every trip starts full and is never restocked partially.",
        ],
        fixture="tests/test_lab.py::test_reloads_let_one_vehicle_serve_more_than_its_capacity",
    ),
    Behavior(
        id="optional_clients",
        provided_by="native",
        description=(
            "Lab clients may be optional (PyVRP Client required=false with a prize): the solver "
            "may skip them, and the prize of every skipped client is added to PyVRP's objective "
            "as an uncollected prize. Fillrate reports the nominal cost, the uncollected prizes "
            "and their sum as separate terms and lists the skipped clients; the validator "
            "requires every required client to be visited."
        ),
        restrictions=[
            "Solver Lab only; the fulfillment pipeline has no optional visits.",
            "A prize is in the instance's cost unit but is never part of a cost: the nominal "
            "objective excludes it and the sum is shown beside it.",
            "A required client cannot carry a prize; an optional client with no prize is "
            "skipped unless visiting it is free.",
            "Heuristic: a skipped client was judged not worth its detour, not proven so.",
        ],
        fixture="tests/test_lab.py::test_optional_clients_are_skipped_when_the_prize_does_not_pay",
    ),
    Behavior(
        id="client_groups",
        provided_by="native",
        description=(
            "Lab instances may declare groups of mutually exclusive alternative clients (PyVRP "
            "ClientGroup): a required group is served by exactly one of its members, an optional "
            "group by at most one, and the solver picks the member that suits the routes best, "
            "for example a customer who can be served at one of two service points. Fillrate "
            "reports which member served each group and its validator rejects a plan that visits "
            "two members or leaves a required group unserved."
        ),
        restrictions=[
            "Solver Lab only; the fulfillment pipeline has no alternative service points.",
            "Members must be optional clients (required: false) with no prize of their own; "
            "a client belongs to at most one group.",
            "Each member keeps its own location, delivery and service duration; the solver "
            "decides the member, not the order or the vehicle.",
        ],
        fixture="tests/test_lab.py::test_a_required_group_is_served_by_the_cheaper_alternative",
    ),
    *[
        Behavior(
            id=capability,
            availability="planned",
            provided_by="native",
            description=f"Solver Lab: {text}. Instances that use it are refused for now.",
            fixture=None,
        )
        for capability, text in (
            ("paired_shipments", "pickup and delivery pairs"),
            ("pickups_and_deliveries", "client pickup loads beside deliveries"),
            (
                "lab_time_windows",
                "client and vehicle time windows and release times (the fulfillment pipeline's "
                "time_windows adapter is separate)",
            ),
            ("routing_profiles", "per-vehicle-type travel profiles"),
        )
    ],
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
