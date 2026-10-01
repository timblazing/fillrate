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
Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
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


class GeocodeMatch(Doc):
    """How an address became a coordinate (spec §6). Records the match, never a confidence score.

    Census matches are interpolated along address ranges, not rooftop points. ZCTA matches are
    the Gazetteer internal point of the ZIP Code Tabulation Area with the same code as the ZIP.
    """

    provider: Literal["census", "zcta"]
    # Census benchmark (e.g. Public_AR_Current) or "zcta-gazetteer-<vintage>".
    dataset: Annotated[str, Field(min_length=1, max_length=100)]
    match_type: Literal["exact", "non_exact"] | None = None
    matched_address: Annotated[str, Field(max_length=500)] | None = None
    zcta: Annotated[str, Field(pattern=r"^\d{5}$")] | None = None
    # Content hash of the stored raw provider response (Census batch chunk or one-line reply).
    response_ref: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")] | None = None
    resolved_at: Annotated[str, Field(min_length=1, max_length=40)]


class CoordinateOrigin(Doc):
    """A location's first coordinate, kept with its provenance when a manual correction or an
    explicit re-geocode replaces it (spec §6: keep original and corrected provenance)."""

    lat: Lat | None
    lon: Lon | None
    coordinate_source: CoordinateSource
    geocode: GeocodeMatch | None = None


class Location(Doc):
    id: Id
    label: str
    lat: Lat | None
    lon: Lon | None
    coordinate_source: CoordinateSource
    # Original address text as imported (spec §6: keep original input beside normalized values).
    address: Annotated[str, Field(max_length=500)] | None = None
    geocode: GeocodeMatch | None = None
    original: CoordinateOrigin | None = None


class OrderLine(Doc):
    id: Id
    product_id: Id
    ordered_pieces: Count
    net_value_per_piece_cents: Count
    linear_feet_per_piece: Annotated[int, Field(strict=True, ge=1)] | None = None


class Order(Doc):
    id: Id
    customer_id: Id | None = None
    location_id: Id
    order_date: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    # Used by the "priority" strategy and the lexicographic CP-SAT objective (spec §8).
    priority: Annotated[int, Field(strict=True, ge=1, le=100)] = 1
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
    """M2 scope item 8: which preflight checks stop a run. Policy, not physics (§7).

    Round two (spec v1.9): `far_from_depot` covers only stops no chain of allowed drives
    reaches; a far stop reachable through another stop is the warning `far_via_stop`. A stop
    larger than one trailer splits across shipments by default.
    """

    missing_coordinates: PreflightAction = "block"
    far_from_depot: PreflightAction = "block"
    oversize_stop: PreflightAction = "warn"
    # ZIP/ZCTA approximate coordinates (spec §6): warn by default; "block" asks the user to exclude
    # those stops or correct them before running.
    approximate_coordinates: PreflightAction = "warn"


class RunSettings(Doc):
    schema_version: Literal[1] = 1
    trailer_capacity: Annotated[int, Field(strict=True, ge=1, le=1_000_000)] = 5_300
    travel_circuity: Annotated[float, Field(ge=1, le=5)] = 1.2
    # Identity (content hash) of a stored, immutable directed travel snapshot (spec §7, M6). When
    # set, legs, reachability and preflight use that matrix and `travel_circuity` is not used for
    # travel. Null means estimated travel: haversine × `travel_circuity`.
    travel_snapshot_id: Hash | None = None
    cluster_circuity: Annotated[float, Field(ge=1, le=5)] = 1.2
    max_leg_m: Annotated[int, Field(strict=True, ge=1, le=20_000_000)] = 804_672
    # Optional policy, off by default (spec v1.8 §1): the 500-mile rule is per leg only.
    max_cluster_diameter_m: Annotated[int, Field(strict=True, ge=1, le=20_000_000)] | None = None
    # Clustering method (spec §8a): k-means (default), the deterministic H3 baseline, or the M4
    # no-clustering baseline ("none": one partition, eligible only when it fits MAX_STOPS).
    cluster_strategy: Literal["kmeans", "h3", "none"] = "kmeans"
    h3_resolution: Annotated[int, Field(strict=True, ge=0, le=15)] = 2
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
    # Sweep axis "inventory available" (spec §8a): every product's stock scaled to this percent,
    # rounded down to whole pieces. A changed assumption: it forms its own comparison cohort.
    inventory_percent: Annotated[int, Field(strict=True, ge=0, le=1000)] = 100
    # "Exclude these lines and run": recorded, reconciled exclusions (reason excluded_by_user).
    excluded_line_ids: Annotated[list[Id], Field(max_length=25_000)] = Field(default_factory=list)
    cost_per_truck_cents: Count | None = None
    cost_per_mile_cents: Count | None = None
    # Allocation (spec §8, M5). Greedy strategies are heuristics; "optimized" is CP-SAT.
    allocation_strategy: Literal[
        "order_date_then_value", "first_come", "priority", "proportional", "optimized"
    ] = "order_date_then_value"
    fulfillment_policy: Literal["piece", "whole_order"] = "piece"
    allocation_objective: Literal["revenue", "priority_then_revenue"] = "revenue"
    respect_order_date: bool = False
    allocation_time_limit_s: Annotated[float, Field(gt=0, le=300)] = 10

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
    "excluded_with_order",
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
    strategy: Literal["kmeans", "h3", "none"]
    requested_k: int | None
    selected_k: int | None
    raw_cluster_count: int
    effective_cluster_count: int
    fits: int
    auto_limit_reached: bool
    repairs: list[Repair]
    h3_resolution: int | None = None


PreflightCheckId = Literal[
    "missing_coordinates",
    "far_from_depot",
    "oversize_stop",
    "far_via_stop",
    "approximate_coordinates",
]


class PreflightFinding(Doc):
    """One preflight check that found something. `action` is what the run did about it."""

    check: PreflightCheckId
    action: Literal["block", "warn"]
    location_ids: list[Id]
    line_ids: list[Id]
    message: str


class TravelSummary(Doc):
    """Which travel data the run used (spec §7): estimated, or a stored directed snapshot."""

    mode: Literal["estimated", "snapshot"]
    provider: Annotated[str, Field(max_length=200)]
    provider_version: Annotated[str, Field(max_length=200)]
    dataset_revision: Annotated[str, Field(max_length=200)]
    profile: Annotated[str, Field(max_length=200)]
    # Estimated travel only.
    circuity: float | None = None
    # Snapshot travel only: the immutable snapshot's identity, its node count and warning count.
    snapshot_id: Hash | None = None
    node_count: int | None = None
    warning_count: int | None = None


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


class AllocationStageSummary(Doc):
    objective: Literal["revenue_cents", "priority_weighted_pieces"]
    status: Literal["optimal", "feasible", "infeasible", "model_invalid", "unknown"]
    value: int
    bound: int | None
    runtime_s: float


class AllocationSummary(Doc):
    """Strategy provenance (spec §8): heuristic or CP-SAT, with each CP-SAT stage's status."""

    strategy: Literal[
        "order_date_then_value", "first_come", "priority", "proportional", "optimized"
    ]
    fulfillment_policy: Literal["piece", "whole_order"]
    kind: Literal["heuristic", "cp_sat"]
    stages: list[AllocationStageSummary]
    notes: list[str]
    runtime_s: float


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
    # Absent on runs created before M5.
    allocation: AllocationSummary | None = None
    # Absent on runs created before M6.
    travel: TravelSummary | None = None
    diagnostics: list[Diagnostic]
    versions: dict[str, str]


# ---- k explorer (spec §8a "Cluster stability", §9) ----------------------------------------------


class ExplorerSettings(Doc):
    """A clustering-only job: no allocation changes, no PyVRP. `base` supplies the population
    (eligible, allocated locations) and the spatial policy; ks × seeds are the k-means tasks and
    each H3 resolution is one deterministic task. All of them count toward the task cap."""

    schema_version: Literal[1] = 1
    kind: Literal["explorer"] = "explorer"
    base: RunSettings = Field(default_factory=RunSettings)
    ks: (
        Annotated[list[Annotated[int, Field(strict=True, ge=1, le=1000)]], Field(max_length=100)]
        | None
    ) = None
    seeds: Annotated[
        list[Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)]],
        Field(min_length=1, max_length=100),
    ] = Field(default_factory=lambda: list(range(10)))
    selected_k: Annotated[int, Field(strict=True, ge=1, le=1000)] | None = None
    reference_seed: Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)] = 0
    h3_resolutions: Annotated[
        list[Annotated[int, Field(strict=True, ge=0, le=15)]], Field(max_length=16)
    ] = Field(default_factory=lambda: [1, 2, 3])


class ExplorerK(Doc):
    k: int
    inertia_by_seed: list[float]
    inertia_mean: float
    raw_cluster_count: int
    effective_cluster_count: int
    diameter_repairs_by_seed: list[int]
    stability_raw: float | None
    stability_repaired: float | None


class ExplorerH3(Doc):
    resolution: int
    raw_cluster_count: int
    effective_cluster_count: int
    inertia: float
    diameter_repairs: int
    stability: Literal["deterministic"] = "deterministic"


class ExplorerLocation(Doc):
    id: Id
    lat: float
    lon: float
    reference_cluster: int
    agreement_raw: float | None
    agreement_repaired: float | None


class ExplorerSummary(Doc):
    schema_version: Literal[1] = 1
    kind: Literal["explorer"] = "explorer"
    scenario_name: str
    settings: ExplorerSettings
    ks: list[int]
    seeds: list[int]
    reference_seed: int
    selected_k: int
    tasks: int
    max_tasks: int
    fits: int
    locations_clustered: int
    per_k: list[ExplorerK]
    h3: list[ExplorerH3]
    locations: list[ExplorerLocation]
    depot: Depot
    versions: dict[str, str]
