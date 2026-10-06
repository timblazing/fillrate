"""Solver Lab documents (spec §4 "Progressive depth", §5 normalized routing, §10, M6).

A lab instance is a normalized routing problem written directly: depots, clients (visits) and
vehicle types, with no orders, products or allocation. It is solved by the pinned PyVRP 0.14.0
and checked by an independent validator (`lab.validate`). Pydantic owns these models;
`bun run contracts:generate` exports them to JSON Schema and TypeScript.

Units are explicit integers. Loads use each dimension's declared unit. Planar instances are
abstract benchmark coordinates (never latitude/longitude): distance is rounded euclidean distance
in abstract units, and one abstract time unit elapses per distance unit. Geographic instances use
haversine × circuity in meters and constant-speed durations in seconds. Costs are integers in
`cost_unit`.

Adding a capability (shipments) adds
fields here and removes their entry from ``PLANNED_FIELDS``; see docs/solver-lab.md.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

LAB_SCHEMA_VERSION = 1

LabId = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9][\w.:-]*$")]
Label = Annotated[str, Field(max_length=200)]
Amount = Annotated[int, Field(strict=True, ge=0, le=1_000_000_000)]
Coordinate = Annotated[float, Field(ge=-1_000_000, le=1_000_000, allow_inf_nan=False)]
Lat = Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
Lon = Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)]

MAX_CLIENTS = 500
MAX_DEPOTS = 10
MAX_RELOADS = 50
MAX_GROUPS = 100
MAX_DIMENSIONS = 8
MAX_VEHICLE_TYPES = 10
MAX_VEHICLES_PER_TYPE = 500

# Fields a later capability will add. Sending one now is refused with the capability's name rather
# than a generic "extra field" error. Keys are (where, field); "instance" is the top level.
PLANNED_FIELDS: dict[tuple[str, str], str] = {
    ("instance", "shipments"): "paired_shipments",
    ("client", "pickup"): "pickups_and_deliveries",
    ("client", "tw_early"): "lab_time_windows",
    ("client", "tw_late"): "lab_time_windows",
    ("client", "release_time"): "lab_time_windows",
    ("vehicle_type", "tw_early"): "lab_time_windows",
    ("vehicle_type", "tw_late"): "lab_time_windows",
    ("vehicle_type", "profile"): "routing_profiles",
}


class PlannedCapabilityError(ValueError):
    """The instance uses a Solver Lab capability that is planned but not implemented."""

    def __init__(self, capability: str, detail: str):
        self.capability = capability
        super().__init__(f"planned capability {capability}: {detail}")


def planned_fields(raw: object) -> list[tuple[str, str, str]]:
    """(where, field, capability) for every planned field present in a raw instance."""
    if not isinstance(raw, dict):
        return []
    found: list[tuple[str, str, str]] = []
    for (where, name), capability in PLANNED_FIELDS.items():
        items = {
            "instance": [raw],
            "client": raw.get("clients"),
            "vehicle_type": raw.get("vehicle_types"),
        }[where]
        if isinstance(items, list) and any(isinstance(i, dict) and name in i for i in items):
            found.append((where, name, capability))
    return found


class LabDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LabDimension(LabDoc):
    """A named load dimension (units, weight, volume or any user-defined resource)."""

    id: LabId
    label: Label = ""
    unit: Annotated[str, Field(min_length=1, max_length=40)]


class LabDepot(LabDoc):
    id: LabId
    label: Label = ""
    # Planar instances use x/y; geographic instances use lat/lon (never both).
    x: Coordinate | None = None
    y: Coordinate | None = None
    lat: Lat | None = None
    lon: Lon | None = None


class LabClient(LabDoc):
    """A visit created directly (spec §5: no order needed). Delivery is per dimension id; a
    dimension left out delivers 0."""

    id: LabId
    label: Label = ""
    x: Coordinate | None = None
    y: Coordinate | None = None
    lat: Lat | None = None
    lon: Lon | None = None
    delivery: dict[str, Amount] = Field(default_factory=dict)
    # Duration units: abstract (planar) or seconds (geographic).
    service_duration: Amount = 0
    # Optional visits (PyVRP Client.required/prize). Absent means a required client with no prize.
    # An optional client (``required: false``) may be skipped; the solver then pays its ``prize``
    # (in the instance's cost unit) as an uncollected prize. Prizes are never folded into costs.
    required: bool | None = None
    prize: Amount | None = None

    @property
    def is_required(self) -> bool:
        return self.required is not False

    @property
    def prize_value(self) -> int:
        return self.prize or 0


class LabGroup(LabDoc):
    """Mutually exclusive alternatives (PyVRP ClientGroup): at most one member is visited. A
    ``required`` group must be served by exactly one member (a customer reachable at one of
    several service points); an optional group may be left unserved. Members are optional clients
    (``required: false``) without a prize of their own, so the group, not a prize, decides."""

    id: LabId
    label: Label = ""
    members: Annotated[list[LabId], Field(min_length=2, max_length=50)]
    required: bool = True


class LabVehicleType(LabDoc):
    """A vehicle type with a finite count. Every vehicle starts at ``start_depot`` and ends at
    ``end_depot`` (depot ids; both default to the first depot, so a single-depot instance needs
    neither). Routes are closed in the sense that every route returns to a depot; there is no open
    route workaround. Capacity names every dimension."""

    id: LabId
    label: Label = ""
    count: Annotated[int, Field(strict=True, ge=1, le=MAX_VEHICLES_PER_TYPE)]
    capacity: dict[str, Amount]
    fixed_cost: Amount = 0
    unit_distance_cost: Amount = 1
    unit_duration_cost: Amount = 0
    # Per-route limits in distance / duration units (PyVRP max_distance, shift_duration).
    max_distance: Annotated[int, Field(strict=True, ge=1, le=1_000_000_000)] | None = None
    shift_duration: Annotated[int, Field(strict=True, ge=1, le=1_000_000_000)] | None = None
    start_depot: LabId | None = None
    end_depot: LabId | None = None
    # Reloads (PyVRP reload depots): between trips a vehicle returns to one of ``reload_depots``
    # (depot ids), reloads to full capacity there at no time cost, and starts its next trip. At
    # most ``max_reloads`` times per route, so a route has up to max_reloads + 1 trips. Capacity
    # applies per trip; max_distance and shift_duration apply to the whole route. Absent (None)
    # means the vehicle never reloads.
    reload_depots: list[LabId] | None = Field(default=None, max_length=MAX_DEPOTS)
    max_reloads: Annotated[int, Field(strict=True, ge=0, le=MAX_RELOADS)] | None = None


class LabTravel(LabDoc):
    """Geographic only: haversine × circuity meters, and seconds at a constant speed."""

    circuity: Annotated[float, Field(ge=1, le=5)] = 1.2
    speed_m_per_s: Annotated[float, Field(gt=0, le=100)] = 11.176


class LabSolver(LabDoc):
    """Seed and stopping criteria. With ``max_iterations`` the run stops after that many
    iterations (reproducible across machines) unless the runtime cap is hit first; without it,
    the runtime alone stops the search (machine dependent)."""

    seed: Annotated[int, Field(strict=True, ge=0, le=1_000_000)] = 0
    max_iterations: Annotated[int, Field(strict=True, ge=1, le=50_000)] | None = 2_000
    max_runtime_s: Annotated[float, Field(gt=0, le=30)] = 30


class LabInstance(LabDoc):
    schema_version: Literal[1] = 1
    kind: Literal["lab_instance"] = "lab_instance"
    name: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(max_length=2000)] = ""
    coordinates: Literal["planar", "geographic"]
    travel: LabTravel = Field(default_factory=LabTravel)
    cost_unit: Annotated[str, Field(min_length=1, max_length=40)] = "cost units"
    dimensions: Annotated[list[LabDimension], Field(min_length=1, max_length=MAX_DIMENSIONS)]
    depots: Annotated[list[LabDepot], Field(min_length=1, max_length=MAX_DEPOTS)]
    clients: Annotated[list[LabClient], Field(min_length=1, max_length=MAX_CLIENTS)]
    vehicle_types: Annotated[
        list[LabVehicleType], Field(min_length=1, max_length=MAX_VEHICLE_TYPES)
    ]
    # Alternative service groups; absent means no groups.
    groups: Annotated[list[LabGroup], Field(max_length=MAX_GROUPS)] | None = None
    solver: LabSolver = Field(default_factory=LabSolver)

    @model_validator(mode="before")
    @classmethod
    def _refuse_planned(cls, data):
        found = planned_fields(data)
        if found:
            where, name, capability = found[0]
            raise PlannedCapabilityError(capability, f"{where} field {name!r} is not supported yet")
        return data

    @model_validator(mode="after")
    def _check(self):
        from .validate import instance_problems

        problems = instance_problems(self)
        if problems:
            raise ValueError("; ".join(problems[:10]))
        return self

    @property
    def depot(self) -> LabDepot:
        """The first depot: the default start and end of every vehicle type."""
        return self.depots[0]

    def start_depot_of(self, vehicle_type: LabVehicleType) -> str:
        return vehicle_type.start_depot or self.depots[0].id

    def end_depot_of(self, vehicle_type: LabVehicleType) -> str:
        return vehicle_type.end_depot or self.depots[0].id

    def group_of(self) -> dict[str, LabGroup]:
        """Client id → its group (clients not in a group are absent)."""
        return {m: g for g in self.groups or [] for m in g.members}

    def dimension_ids(self) -> list[str]:
        return [d.id for d in self.dimensions]

    def delivery_vector(self, client: LabClient) -> list[int]:
        return [client.delivery.get(d, 0) for d in self.dimension_ids()]

    def capacity_vector(self, vehicle_type: LabVehicleType) -> list[int]:
        return [vehicle_type.capacity[d] for d in self.dimension_ids()]


# ---- Result (spec §10 single-problem runs) -----------------------------------------------------

Loads = dict[str, int]


class LabViolation(LabDoc):
    code: str
    message: str
    route: int | None = None
    client_id: str | None = None
    vehicle_type: str | None = None
    dimension: str | None = None
    trip: int | None = None


class LabVisit(LabDoc):
    client_id: str
    # Trip of the route this visit belongs to (0 unless the vehicle reloads).
    trip: int = 0
    # Load on board before and after serving this visit, per dimension (delivery only).
    load_before: Loads
    load_after: Loads
    leg_distance: int
    leg_duration: int
    arrival: int
    service_duration: int
    departure: int


class LabTrip(LabDoc):
    """One trip of a route: from the route's start depot or a reload depot to the next reload
    depot or the route's end depot. Loads are per trip (full again after every reload)."""

    index: int
    from_depot: str
    to_depot: str
    client_ids: list[str]
    load: Loads
    utilization: dict[str, float]
    distance: int


class LabRoute(LabDoc):
    index: int
    vehicle_type: str
    # Depot ids the route starts and ends at (absent in results stored before multiple depots).
    start_depot: str | None = None
    end_depot: str | None = None
    # Trips between reloads (one when the vehicle never reloads; absent in results stored earlier).
    trips: list[LabTrip] = Field(default_factory=list)
    visits: list[LabVisit]
    # Total delivered over all trips; each trip is checked against capacity on its own.
    load: Loads
    # Fullest trip's load / capacity per dimension, 0–1 when feasible (above 1 means overloaded).
    utilization: dict[str, float]
    distance: int
    duration: int
    travel_duration: int
    service_duration: int
    fixed_cost: int
    distance_cost: int
    duration_cost: int
    cost: int


class LabObjective(LabDoc):
    """Nominal objective recomputed from the instance (PyVRP 0.14 semantics): per used vehicle
    its fixed cost, plus unit_distance_cost × route distance and unit_duration_cost × route
    duration. ``total`` is this nominal cost only. Infeasibility penalties are never part of it.
    With optional clients PyVRP minimizes ``total`` plus the prizes of the clients it skips:
    ``uncollected_prizes`` is reported as its own term and ``objective_with_prizes`` is the sum
    PyVRP optimized. Prizes are in the instance's cost unit but are never costs."""

    fixed_cost: int
    distance_cost: int
    duration_cost: int
    total: int
    uncollected_prizes: int = 0
    prizes_collected: int = 0
    objective_with_prizes: int | None = None


class LabGroupOutcome(LabDoc):
    """Which member (if any) serves a group."""

    group_id: str
    required: bool
    served_by: str | None


class LabSkipped(LabDoc):
    """An optional client that no route visits, and the prize forgone."""

    client_id: str
    prize: int


class LabFleetUse(LabDoc):
    vehicle_type: str
    available: int
    used: int


class LabSolverInfo(LabDoc):
    name: Literal["pyvrp"] = "pyvrp"
    version: str
    adapter_version: str
    seed: int
    max_iterations: int | None
    max_runtime_s: float
    iterations: int
    runtime_s: float
    stopped_by: Literal["iterations", "runtime"]
    # PyVRP's own nominal cost of the returned solution and its excess (penalized) quantities.
    # Penalty weights are search guidance, not a cost, so only the excess amounts are reported.
    nominal_cost: int
    excess_load: Loads
    excess_distance: int
    time_warp: int


class LabTotals(LabDoc):
    routes: int
    clients_total: int
    clients_served: int
    distance: int
    duration: int
    travel_duration: int
    service_duration: int
    load: Loads


class LabUnits(LabDoc):
    distance: str
    duration: str
    cost: str
    dimensions: dict[str, str]


class LabResult(LabDoc):
    schema_version: Literal[1] = 1
    kind: Literal["lab_result"] = "lab_result"
    instance_name: str
    coordinates: Literal["planar", "geographic"]
    problem_fingerprint: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
    units: LabUnits
    # Never "optimal": a heuristic search found this candidate within the budget.
    proof: Literal["heuristic"] = "heuristic"
    solver_feasible: bool
    validated_feasible: bool
    violations: list[LabViolation]
    objective: LabObjective
    # Optional clients not visited (empty unless the instance has optional clients).
    skipped: list[LabSkipped] = Field(default_factory=list)
    # One entry per alternative group (empty unless the instance has groups).
    groups: list[LabGroupOutcome] = Field(default_factory=list)
    totals: LabTotals
    fleet: list[LabFleetUse]
    routes: list[LabRoute]
    solver: LabSolverInfo
