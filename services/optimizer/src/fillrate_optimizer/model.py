"""Pipeline documents shared with the web app (spec §5, §8a, §10).

Pydantic owns these; `bun run contracts:generate` exports them to JSON Schema
and TypeScript. Units: meters, integer hundredths of a foot, integer cents.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Id = Annotated[str, Field(min_length=1, max_length=200)]
Count = Annotated[int, Field(strict=True, ge=0, le=9007199254740991)]
Lat = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Lon = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]
CoordinateSource = Literal["imported", "manual", "census", "zcta", "unresolved"]


class Doc(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---- Scenario (business + spatial input) ------------------------------------------------------


class Depot(Doc):
    id: Id
    label: str
    lat: Lat
    lon: Lon


class Product(Doc):
    id: Id
    label: str
    linear_feet_per_piece: Annotated[int, Field(strict=True, ge=1)]


class Location(Doc):
    id: Id
    label: str
    lat: Lat | None
    lon: Lon | None
    coordinate_source: CoordinateSource


class OrderLine(Doc):
    id: Id
    product_id: Id
    ordered_pieces: Count
    net_value_per_piece_cents: Count
    linear_feet_per_piece: Annotated[int, Field(strict=True, ge=1)] | None = None


class Order(Doc):
    id: Id
    location_id: Id
    order_date: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    lines: list[OrderLine] = Field(min_length=1)


class InventoryItem(Doc):
    product_id: Id
    available_pieces: Count


class ScenarioDocument(Doc):
    schema_version: Literal[1] = 1
    name: str
    depot: Depot
    products: list[Product]
    locations: list[Location]
    orders: list[Order]
    inventory: list[InventoryItem]


PreflightAction = Literal["block", "warn"]


class PreflightPolicy(Doc):
    """M2 scope item 8: which preflight checks stop a run. Policy, not physics (§7)."""

    missing_coordinates: PreflightAction = "block"
    far_from_depot: PreflightAction = "block"
    oversize_stop: PreflightAction = "block"


class RunSettings(Doc):
    schema_version: Literal[1] = 1
    trailer_capacity: Annotated[int, Field(strict=True, ge=1, le=1_000_000)] = 5_300
    travel_circuity: Annotated[float, Field(ge=1, le=5)] = 1.2
    cluster_circuity: Annotated[float, Field(ge=1, le=5)] = 1.2
    max_leg_m: Annotated[int, Field(strict=True, ge=1, le=20_000_000)] = 804_672
    # Optional policy, off by default (spec v1.8 §1): the 500-mile rule is per leg only.
    max_cluster_diameter_m: Annotated[int, Field(strict=True, ge=1, le=20_000_000)] | None = None
    k: Annotated[int, Field(strict=True, ge=1, le=1000)] | None = None
    auto_k_cap: Annotated[int, Field(strict=True, ge=1, le=100)] = 25
    kmeans_seed: Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)] = 0
    kmeans_n_init: Annotated[int, Field(strict=True, ge=1, le=100)] = 10
    max_stops: Annotated[int, Field(strict=True, ge=1, le=10_000)] = 500
    solver_seed: Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)] = 0
    solver_max_iterations: Annotated[int, Field(strict=True, ge=1, le=10_000_000)] | None = None
    solver_time_limit_s: Annotated[float, Field(gt=0, le=300)] = 10
    objective: Literal["trucks_then_distance", "weighted_distance", "cost"] = "trucks_then_distance"
    weighted_truck_penalty_m: Annotated[int, Field(strict=True, ge=0)] | None = None
    preflight: PreflightPolicy = Field(default_factory=PreflightPolicy)
    # "Exclude these lines and run": recorded, reconciled exclusions (reason excluded_by_user).
    excluded_line_ids: Annotated[list[Id], Field(max_length=25_000)] = Field(default_factory=list)
    cost_per_truck_cents: Count | None = None
    cost_per_mile_cents: Count | None = None

    @model_validator(mode="after")
    def validate_cost_rates(self) -> RunSettings:
        if self.objective == "cost" and (
            self.cost_per_truck_cents is None or self.cost_per_mile_cents is None
        ):
            raise ValueError("cost objective requires both truck and mile rates in integer cents")
        return self


# ---- Run summary (results, spec §10) ----------------------------------------------------------

UnplannedReason = Literal[
    "excluded_unresolved_coordinates",
    "excluded_by_user",
    "oversize_piece",
    "stock_shortage",
    "unreachable",
    "unreachable_in_partition",
    "candidate_invalid",
    "no_valid_candidate",
]


class MapLocation(Doc):
    id: Id
    label: str
    lat: float | None
    lon: float | None
    coordinate_source: CoordinateSource
    cluster_id: str | None
    state: Literal["planned", "partial", "unplanned", "excluded", "no_demand"]


class LineOnBoard(Doc):
    line_id: Id
    order_id: Id
    product_id: Id
    pieces: Count
    linear_feet: Count
    amount_cents: Count


class TruckVisit(Doc):
    visit_id: str
    location_id: Id
    sequence: int
    leg_m: Count
    load: Count
    lines: list[LineOnBoard]


class TruckSummary(Doc):
    id: str
    cluster_id: str
    load: Count
    fill: float
    distance_m: Count
    amount_cents: Count
    visits: list[TruckVisit]


class ClusterSummary(Doc):
    id: str
    index: int
    location_ids: list[str]
    visit_count: int
    planned_visit_count: int
    status: Literal["validated", "invalid_candidate", "no_candidate", "nothing_to_solve"]
    trucks: int
    load: Count
    capacity_lower_bound: int
    avg_fill: float | None
    min_fill: float | None
    diameter_m: Count
    mean_centroid_distance_m: float
    loaded_distance_m: Count
    planned_amount_cents: Count
    objective_mode: str
    truck_penalty: Count
    distance_bound_m: Count | None
    solver_feasible: bool | None
    iterations: int
    runtime_s: float
    violations: list[str]


class ProductReconciliation(Doc):
    product_id: Id
    label: str
    starting_inventory: Count
    residual: Count
    ordered: Count
    excluded: Count
    eligible: Count
    allocated: Count
    unselected: Count
    planned: Count
    allocated_unplanned: Count
    ordered_cents: Count
    allocated_cents: Count
    planned_cents: Count


class UnplannedLine(Doc):
    line_id: Id
    order_id: Id
    product_id: Id
    location_id: Id
    pieces: Count
    amount_cents: Count
    reason: UnplannedReason
    stage: Literal["preflight", "allocation", "problem", "solve", "validation"]
    evidence: str


class Repair(Doc):
    reason: Literal["diameter", "solve_size", "degenerate_size"]
    detail: str


class ClusteringSummary(Doc):
    strategy: Literal["kmeans", "none"]
    requested_k: int | None
    selected_k: int | None
    raw_cluster_count: int
    effective_cluster_count: int
    fits: int
    auto_limit_reached: bool
    repairs: list[Repair]


PreflightCheckId = Literal[
    "missing_coordinates", "far_from_depot", "oversize_stop", "approximate_coordinates"
]


class PreflightFinding(Doc):
    """One preflight check that found something. `action` is what the run did about it."""

    check: PreflightCheckId
    action: Literal["block", "warn"]
    location_ids: list[Id]
    line_ids: list[Id]
    message: str


class Diagnostic(Doc):
    code: str
    severity: Literal["info", "warning", "error"]
    message: str


class Totals(Doc):
    ordered_cents: Count
    allocated_cents: Count
    planned_cents: Count
    trucks: int
    locations: int
    visits: int
    planned_visits: int
    load: Count
    avg_fill: float | None
    min_fill: float | None
    utilization: float | None
    loaded_distance_m: Count
    capacity_lower_bound: int
    sum_cluster_lower_bounds: int


class RunSummary(Doc):
    schema_version: Literal[1] = 1
    scenario_name: str
    validity: Literal["valid", "invalid"]
    coverage: Literal["complete", "partial", "empty"]
    proof: Literal["heuristic"] = "heuristic"
    settings: RunSettings
    depot: Depot
    totals: Totals
    clustering: ClusteringSummary
    clusters: list[ClusterSummary]
    trucks: list[TruckSummary]
    locations: list[MapLocation]
    products: list[ProductReconciliation]
    unplanned: list[UnplannedLine]
    preflight: list[PreflightFinding] = Field(default_factory=list)
    diagnostics: list[Diagnostic]
    versions: dict[str, str]
