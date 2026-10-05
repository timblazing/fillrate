"""Manual plan evaluator (spec §10, §12 `evaluate`, M6).

Evaluates a hand-edited plan for one cluster of a completed pipeline run against that run's own
recorded problem: the travel artifact's matrix, the problem artifact's visits, objective
coefficients and time data, the aggregation's visit lineage, and (for snapshot runs) the
selected travel snapshot. Validation is the pipeline's own ``check_routes`` and result rows are
the pipeline's own ``truck_summaries``, so a manual plan is judged with exactly the constraint
semantics a solver candidate is. Evaluating the run's optimized routes reproduces its recorded
metrics.

A plan is ``{"cluster_id": ..., "routes": [[visit_id, ...], ...]}``: ordered visit IDs per
truck, the same shape as a solve artifact's ``routes``. A valid evaluation says only that the
plan passes the validator; it is a manual baseline, never a solver result or proof of anything
about the instance.

Stateless and bounded: nothing here opens SQLite or the network. Next.js reads the run's
artifacts and posts them to FastAPI ``/evaluate`` (spec §2).
"""

from __future__ import annotations

import math
from typing import Annotated, Any, Literal

from pydantic import Field

from .loads import monetary_objective
from .model import Count, Doc, RunSettings, ScenarioDocument, TruckSummary
from .pipeline import (
    PipelineError,
    check_routes,
    line_record,
    resolve_snapshot,
    snapshot_leg_reader,
    truck_summaries,
)
from .timeplan import duration_leg_reader
from .travel_provider import SnapshotBindingError, TravelSnapshot, stop_nodes

EVALUATOR_VERSION = "fillrate-evaluate/1"
MAX_PLAN_VISITS = 10_000

VisitId = Annotated[str, Field(min_length=1, max_length=500)]
Route = Annotated[list[VisitId], Field(min_length=1, max_length=MAX_PLAN_VISITS)]

ViolationCode = Literal[
    "unknown_visit",
    "unreachable_visit",
    "duplicate_visit",
    "missing_visit",
    "empty_truck",
    "over_capacity",
    "leg_missing",
    "leg_over_limit",
    "leg_mismatch",
    "leg_no_duration",
    "window_late",
    "horizon_exceeded",
    "cluster_diameter",
]


class EvaluationError(ValueError):
    """The request does not describe one consistent recorded cluster problem."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class ClusterPlan(Doc):
    """Ordered visit IDs per truck for one cluster; the shape of a solve artifact's routes."""

    cluster_id: Annotated[str, Field(min_length=1, max_length=200)]
    routes: Annotated[list[Route], Field(min_length=1, max_length=MAX_PLAN_VISITS)]


class EvaluateRequest(Doc):
    """One cluster of a completed run, as its artifacts recorded it, plus the plans to evaluate.

    ``cluster``, ``problem`` and ``travel`` are that cluster's entries of the clustering, problem
    and (decoded) travel artifacts; ``visits`` are the aggregation's visits of the cluster.
    ``reference`` is normally the run's optimized routes, evaluated alongside for comparison.
    """

    schema_version: Literal[1] = 1
    scenario: ScenarioDocument
    settings: RunSettings
    cluster: dict[str, Any]
    problem: dict[str, Any]
    travel: dict[str, Any]
    visits: list[dict[str, Any]]
    travel_snapshot: dict[str, Any] | None = None
    plan: ClusterPlan
    reference: ClusterPlan | None = None


class PlanViolation(Doc):
    code: ViolationCode
    message: str
    # 1-based position of the truck in the submitted plan, when the violation is on one truck.
    truck: int | None = None
    visit_id: str | None = None


class PlanMetrics(Doc):
    """The run's cluster metrics for this plan, under the run's objective definition."""

    trucks: int
    # Trucks using a leg with no recorded distance or duration: counted, but not measured, so
    # distance and objective are unavailable (None) for the plan.
    unmeasured_trucks: int = 0
    visit_count: int  # visits in the cluster problem
    planned_visit_count: int  # distinct problem visits on some truck
    load: Count
    capacity_lower_bound: int
    avg_fill: float | None
    min_fill: float | None
    loaded_distance_m: Count | None
    drive_s: Count | None
    wait_s: Count | None
    planned_amount_cents: Count
    objective_mode: str
    truck_penalty: Count
    distance_cost: Count
    # truck_penalty × trucks + distance_cost × loaded meters: the PyVRP cost the run's solver
    # minimizes (open routes, so returns cost nothing). Comparable only between plans of this
    # cluster problem, and meaningful as a ranking only between valid plans.
    objective: Count | None
    # Cost objective only: the objective converted exactly to cents.
    objective_cents: float | None = None


class PlanEvaluation(Doc):
    valid: bool
    violations: list[PlanViolation]
    metrics: PlanMetrics
    trucks: list[TruckSummary]


class EvaluateResponse(Doc):
    schema_version: Literal[1] = 1
    evaluator_version: str = EVALUATOR_VERSION
    cluster_id: str
    manual: PlanEvaluation
    reference: PlanEvaluation | None = None


def evaluate(request: EvaluateRequest) -> EvaluateResponse:
    cid = request.cluster.get("id")
    meta, prob, trav = request.cluster, request.problem, request.travel
    if not (cid == prob.get("cluster_id") == trav.get("cluster_id")):
        raise EvaluationError(
            "cluster_mismatch", "Clustering, problem and travel entries name different clusters."
        )
    for plan in (request.plan, request.reference):
        if plan is not None and plan.cluster_id != cid:
            raise EvaluationError(
                "cluster_mismatch", f"The plan is for {plan.cluster_id}, not cluster {cid}."
            )
    if sum(len(r) for r in request.plan.routes) > MAX_PLAN_VISITS:
        raise EvaluationError(
            "plan_too_large", f"A plan may list at most {MAX_PLAN_VISITS} visits."
        )
    visits = {v["visit_id"]: v for v in request.visits}
    if any(vid not in visits for vid in meta.get("visits", [])):
        raise EvaluationError("visits_missing", "The cluster's aggregated visits are incomplete.")

    scenario, settings = request.scenario, request.settings
    products = {p.id: p for p in scenario.products}
    try:
        lines = {
            line.id: line_record(order, line, products)
            for order in scenario.orders
            for line in order.lines
        }
    except KeyError as error:
        raise EvaluationError("unknown_product", f"Unknown product {error}.") from error

    raw_leg, leg_seconds = travel_readers(request, meta["locations"])
    capacity = settings.trailer_capacity

    def run(plan: ClusterPlan, prefix: str) -> PlanEvaluation:
        found, checked = check_routes(
            meta, prob, trav, plan.routes, visits, lines, settings, raw_leg, leg_seconds
        )
        # A truck that uses a leg the provider has no value for cannot be measured; its
        # violation is reported and it gets no result row (truck IDs keep plan positions).
        measured = [
            truck
            for truck in truck_summaries(
                cid, checked, visits, lines, capacity, prefix, strict=False
            )
            if truck is not None
        ]
        unmeasured = len(checked) - len(measured)
        return PlanEvaluation(
            valid=not found,
            violations=[
                PlanViolation(code=f.code, message=str(f), truck=f.truck, visit_id=f.visit_id)
                for f in found
            ],
            metrics=plan_metrics(measured, unmeasured, meta, prob, visits, capacity),
            trucks=measured,
        )

    return EvaluateResponse(
        cluster_id=cid,
        manual=run(request.plan, "M"),
        reference=run(request.reference, "T") if request.reference else None,
    )


def travel_readers(request: EvaluateRequest, locations: list[str]):
    """The same leg readers the run's validation used: the selected snapshot's effective
    matrices, or the estimated provider's durations from scenario coordinates."""
    scenario, settings = request.scenario, request.settings
    coords = {loc.id: (loc.lat, loc.lon) for loc in scenario.locations}
    try:
        stops = {loc: coords[loc] for loc in locations}
    except KeyError as error:
        raise EvaluationError("unknown_location", f"Unknown location {error}.") from error
    depot = scenario.depot
    raw_meters = raw_seconds = None
    try:
        snapshot = resolve_snapshot(
            settings,
            TravelSnapshot.model_validate(request.travel_snapshot)
            if request.travel_snapshot is not None
            else None,
            None,
        )
        if snapshot:
            raw_meters, raw_seconds = snapshot.effective(
                stop_nodes(depot.id, (depot.lat, depot.lon), stops)
            )
    except PipelineError as error:
        raise EvaluationError(error.code, str(error)) from error
    except SnapshotBindingError as error:
        raise EvaluationError("travel_snapshot_mismatch", str(error)) from error
    loc_ids = sorted(stops)
    return (
        snapshot_leg_reader(raw_meters, loc_ids),
        duration_leg_reader(raw_seconds, loc_ids, depot, stops, settings.travel_circuity),
    )


def plan_metrics(
    trucks: list[TruckSummary], unmeasured: int, meta, prob, visits, capacity: int
) -> PlanMetrics:
    used = [t for t in trucks if t.visits]
    fills = [t.fill for t in used]
    count = len(used) + unmeasured
    distance = sum(t.distance_m for t in used) if not unmeasured else None
    drives = [t.drive_s for t in used]
    waits = [t.wait_s_total for t in used]
    objective = (
        prob["truck_penalty"] * count + prob["distance_cost"] * distance
        if distance is not None
        else None
    )
    monetary = prob.get("monetary")
    cents = None
    if monetary and objective is not None:
        # Recomputed from the recorded rates and checked against the recorded coefficients.
        converted = monetary_objective(
            monetary["cost_per_truck_cents"], monetary["cost_per_mile_cents"]
        )
        if (converted.truck_penalty, converted.distance_cost) != (
            prob["truck_penalty"],
            prob["distance_cost"],
        ):
            raise EvaluationError(
                "objective_mismatch", "The recorded cost coefficients do not match the rates."
            )
        cents = objective * converted.cents_numerator / converted.cents_denominator
    planned = {v.visit_id for t in used for v in t.visits}
    return PlanMetrics(
        trucks=count,
        unmeasured_trucks=unmeasured,
        visit_count=len(prob["visits"]),
        planned_visit_count=len(planned & set(prob["visits"])),
        load=sum(t.load for t in used),
        capacity_lower_bound=math.ceil(sum(visits[v]["load"] for v in meta["visits"]) / capacity),
        avg_fill=sum(fills) / len(fills) if fills else None,
        min_fill=min(fills) if fills else None,
        loaded_distance_m=distance,
        drive_s=sum(drives) if used and not unmeasured and None not in drives else None,
        wait_s=sum(waits) if used and not unmeasured and None not in waits else None,
        planned_amount_cents=sum(t.amount_cents for t in used),
        objective_mode=prob["objective"],
        truck_penalty=prob["truck_penalty"],
        distance_cost=prob["distance_cost"],
        objective=objective,
        objective_cents=cents,
    )


def cluster_request(
    scenario: ScenarioDocument,
    settings: RunSettings,
    stages: dict[str, dict[str, Any]],
    cluster_id: str,
    routes: list[list[str]],
    *,
    travel_snapshot: TravelSnapshot | None = None,
    with_reference: bool = True,
) -> EvaluateRequest:
    """The request Next.js assembles from a run's stored artifacts (``stages``: stage type →
    payload, travel already decoded), for tests, lessons and offline use."""
    pick = {
        name: next(c for c in stages[name]["clusters"] if c.get("cluster_id", c.get("id")) == cid)
        for name, cid in (
            ("clustering", cluster_id),
            ("problem", cluster_id),
            ("travel", cluster_id),
            ("solve", cluster_id),
        )
    }
    members = set(pick["clustering"]["visits"])
    solved = pick["solve"].get("status") == "solved" and pick["solve"]["routes"]
    return EvaluateRequest(
        scenario=scenario,
        settings=settings,
        cluster=pick["clustering"],
        problem=pick["problem"],
        travel=pick["travel"],
        visits=[v for v in stages["aggregation"]["visits"] if v["visit_id"] in members],
        travel_snapshot=travel_snapshot.model_dump(mode="json") if travel_snapshot else None,
        plan=ClusterPlan(cluster_id=cluster_id, routes=routes),
        reference=(
            ClusterPlan(cluster_id=cluster_id, routes=pick["solve"]["routes"])
            if with_reference and solved
            else None
        ),
    )
