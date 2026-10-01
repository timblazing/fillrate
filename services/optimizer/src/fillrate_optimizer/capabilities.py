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
            "M6 provider modules validate imported snapshots and assemble bounded Valhalla "
            "truck matrices. Worker selection and durable matrix snapshots are still pending."
        ),
        restrictions=[
            "Python provider fixtures only; not selectable in browser or worker jobs.",
            "No live Valhalla deployment or route geometry has been verified.",
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
        id="independent_validation",
        provided_by="validation",
        description=(
            "Coverage, piece lineage, capacity, physical legs, cluster membership and (when "
            "enabled) diameter are rechecked from the raw travel artifact; solver feasibility "
            "is never trusted alone."
        ),
        fixture="tests/test_pipeline.py::test_validator_rejects_solver_feasible_missing_edge_candidate",
    ),
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
