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
        availability="planned",
        provided_by="preprocessing",
        description=(
            "M6: immutable directed travel snapshots (imported or Valhalla truck matrices) are "
            "stored by content hash and selected in run settings; the worker's travel stage, "
            "reachability and the submission preflight read that matrix. A durable job can "
            "build a Valhalla snapshot for a scenario version; that job is verified against "
            "fixtures only."
        ),
        restrictions=[
            "Selectable only through the operator API (travel_snapshot_id) and the worker; "
            "no browser control or matrix preview yet.",
            "No live Valhalla deployment or route geometry has been verified; the snapshot "
            "building job runs against fixtures only.",
        ],
        fixture=None,
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
        restrictions=["One depot, one vehicle type, open routes, distance-only costs."],
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
    # ---- Solver Lab (M6): generic normalized routing instances, not the fulfillment pipeline ----
    Behavior(
        id="solver_lab",
        provided_by="native",
        description=(
            "Lab instances (fillrate_optimizer.lab) create depots, clients and vehicle types "
            "directly and are solved by PyVRP 0.14.0 as one problem: closed routes from one "
            "depot, every edge with its raw distance and duration, a seed and an iteration or "
            "runtime budget. Planar instances use rounded euclidean abstract units (never "
            "latitude/longitude); geographic ones haversine × circuity meters and "
            "constant-speed seconds. An independent validator recomputes coverage, loads, "
            "fleet counts, limits, distances, durations and the nominal objective, and flags "
            "any PyVRP route number that differs."
        ),
        restrictions=[
            "Exactly one depot; no time windows, release times, pickups, prizes, groups, "
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
            "Solver Lab only; every type starts and ends at the single depot.",
            "Max distance and shift duration are penalized in PyVRP's search; only the "
            "independent validator decides whether a route respects them.",
        ],
        fixture="tests/test_lab.py::test_mixed_fleet_uses_cheaper_type_within_its_count",
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
            ("multiple_depots", "several depots with per-vehicle-type start and end depots"),
            ("reloads", "reload depots and multiple trips per vehicle"),
            ("optional_clients", "optional visits with prizes"),
            ("client_groups", "mutually exclusive client groups"),
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
        travel_modes=["haversine"],
        behaviors=BEHAVIORS,
        limits=Limits(),
        defaults=Defaults(),
        units=Units(),
    )
