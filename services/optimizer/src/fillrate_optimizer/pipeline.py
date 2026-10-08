"""The fulfillment pipeline (spec §8a): one sequential pass over immutable inputs.

preflight → allocate → aggregate → cluster/repair → travel/problem → solve →
validate → summarize. Each stage returns a JSON payload that becomes a
content-addressed artifact with a versioned manifest. Validation and metrics
are recomputed from the raw travel artifact and the piece lineage, never taken
from solver output.
"""

from __future__ import annotations

import json
import math
import os
import time
import uuid
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from importlib.metadata import version
from types import SimpleNamespace
from typing import Any

import numpy as np

from .allocation import allocate
from .artifact_codec import decode_travel, encode_travel
from .canonical import content_hash
from .clustering import Clusterer, centroid
from .loads import (
    PartitionProblem,
    PartitionTime,
    PartitionVisit,
    monetary_objective,
    solve_partition,
    truck_count_first_penalty,
)
from .model import (
    AllocationSummary,
    ClusteringSummary,
    ClusterSummary,
    Diagnostic,
    LineOnBoard,
    MapLocation,
    ProductReconciliation,
    Repair,
    RunSettings,
    RunSummary,
    ScenarioDocument,
    TimeSummary,
    Totals,
    TravelSummary,
    TruckSummary,
    TruckVisit,
    UnplannedLine,
)
from .preflight import preflight_checks
from .timeplan import (
    TimeContext,
    duration_leg_reader,
    estimated_seconds,
    time_context,
)
from .timewin import Finding, VisitTime, recompute_route
from .travel import distance_matrix_m, haversine_m, reachable

PRODUCER_VERSION = "fillrate-pipeline/3"
ADAPTER_VERSION = "pyvrp-partition/1"


class PipelineError(ValueError):
    """Invalid input: a permanent failure, never retried."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Limits:
    max_orders: int = 5_000
    max_order_lines: int = 25_000
    max_visits: int = 10_000
    run_wall_limit_s: float = 600

    @classmethod
    def from_env(cls) -> Limits:
        env = os.environ
        return cls(
            max_orders=int(env.get("MAX_ORDERS", 5_000)),
            max_order_lines=int(env.get("MAX_ORDER_LINES", 25_000)),
            max_visits=int(env.get("MAX_VISITS", 10_000)),
            run_wall_limit_s=float(env.get("RUN_WALL_LIMIT_SECONDS", 600)),
        )


@dataclass
class Artifact:
    stage: str
    manifest: dict[str, Any]
    payload: dict[str, Any]


@dataclass
class PipelineOutput:
    artifacts: list[Artifact]
    summary: RunSummary


Progress = Callable[[str, dict[str, Any]], None]


class Stages:
    """Records artifacts with manifests chained by parent output hashes."""

    def __init__(self, settings, execution_id, now_ms, scenario_hash, cache=None, checkpoint=None):
        self.settings = settings
        self.execution_id = execution_id
        self.now_ms = now_ms
        self.scenario_hash = scenario_hash
        self.cache = cache
        self.checkpoint = checkpoint
        self.artifacts: list[Artifact] = []
        self.hashes: dict[str, str] = {}
        self.hits: dict[str, dict] = {}

    def identity(self, stage, parents, keys):
        settings_json = self.settings.model_dump(mode="json")
        effective = {k: settings_json[k] for k in keys}
        parent_hashes = [self.hashes[p] for p in parents]
        input_hash = content_hash(
            {
                "stage": stage,
                "parents": parent_hashes,
                "scenario": self.scenario_hash if stage == "preflight" else None,
                "settings": effective,
                "producer": PRODUCER_VERSION,
                "versions": versions(),
            }
        )
        return input_hash, parent_hashes, effective

    def lookup(self, stage, parents, keys):
        if not self.cache:
            return None
        identity, _, _ = self.identity(stage, parents, keys)
        hit = self.cache(identity)
        if hit is None:
            return None
        manifest, payload = hit["manifest"], hit["payload"]
        if (
            manifest["input_hash"] != identity
            or manifest["stage_type"] != stage
            or content_hash(payload) != manifest["output_hash"]
        ):
            raise PipelineError("cache_corrupt", "Cached stage failed identity/hash validation.")
        self.hits[stage] = manifest
        return decode_travel(payload) if stage == "travel" else payload

    def add(self, stage: str, payload: dict[str, Any], parents: list[str], keys: list[str]):
        input_hash, parent_hashes, effective = self.identity(stage, parents, keys)
        stored_payload = encode_travel(payload) if stage == "travel" else payload
        output_hash = content_hash(stored_payload)
        hit = self.hits.pop(stage, None)
        if hit and hit["output_hash"] != output_hash:
            raise PipelineError("cache_corrupt", "Reused stage output changed.")
        self.hashes[stage] = output_hash
        manifest = {
            "schema_version": 1,
            "stage_type": stage,
            "input_hash": input_hash,
            "output_hash": output_hash,
            "producer_version": PRODUCER_VERSION,
            "adapter_version": ADAPTER_VERSION if stage in ("problem", "solve") else "none",
            "parent_hashes": parent_hashes,
            "effective_settings": effective,
            "created_at_ms": self.now_ms(),
            "execution_id": self.execution_id,
            "reused_from": hit["execution_id"] if hit else None,
        }
        artifact = Artifact(stage, manifest, stored_payload)
        self.artifacts.append(artifact)
        if self.checkpoint:
            self.checkpoint(artifact)


def versions() -> dict[str, str]:
    return {name: version(name) for name in ("pyvrp", "scikit-learn", "numpy", "h3")} | {
        "pipeline": PRODUCER_VERSION,
        "adapter": ADAPTER_VERSION,
    }


def run_pipeline(
    scenario: ScenarioDocument,
    settings: RunSettings,
    *,
    limits: Limits | None = None,
    progress: Progress | None = None,
    execution_id: str | None = None,
    cache: Callable | None = None,
    checkpoint: Callable | None = None,
    cluster_task: Callable | None = None,
    clock: Callable[[], float] = time.monotonic,
    now_ms: Callable[[], int] = lambda: int(time.time() * 1000),
) -> PipelineOutput:
    limits = limits or Limits()
    report = progress or (lambda stage, detail: None)
    travel_keys = ["travel_circuity"]
    deadline = clock() + limits.run_wall_limit_s
    stages = Stages(
        settings,
        execution_id or str(uuid.uuid4()),
        now_ms,
        content_hash(scenario.model_dump(mode="json")),
        cache,
        checkpoint,
    )
    # Splitting, the oversize checks and capacity lower bounds use the trailer capacity.
    cap = settings.trailer_capacity
    cap_keys = ["trailer_capacity"]
    tctx = time_context(scenario)  # None: the time-window adapter is off and nothing changes
    diagnostics: list[Diagnostic] = []
    unplanned: list[UnplannedLine] = []

    # ---- 1. Preflight ------------------------------------------------------------------------
    report("preflight", {})
    products = {p.id: p for p in scenario.products}
    locations = {loc.id: loc for loc in scenario.locations}
    if len(products) != len(scenario.products) or len(locations) != len(scenario.locations):
        raise PipelineError("duplicate_id", "Duplicate product or location IDs.")
    if len(scenario.orders) > limits.max_orders:
        raise PipelineError(
            "too_many_orders",
            f"{len(scenario.orders)} orders exceed MAX_ORDERS={limits.max_orders}.",
        )
    lines: dict[str, dict[str, Any]] = {}
    for order in scenario.orders:
        if order.location_id not in locations:
            raise PipelineError("unknown_location", f"Order {order.id}: unknown location.")
        for line in order.lines:
            if line.product_id not in products:
                raise PipelineError("unknown_product", f"Line {line.id}: unknown product.")
            if line.id in lines:
                raise PipelineError("duplicate_id", f"Duplicate order line ID {line.id}.")
            lines[line.id] = line_record(order, line, products)
    if len(lines) > limits.max_order_lines:
        raise PipelineError("too_many_lines", f"{len(lines)} order lines exceed MAX_ORDER_LINES.")
    try:
        findings = preflight_checks(scenario, settings)
    except ValueError as error:
        raise PipelineError(
            "unknown_line", f"Excluded line IDs not in the scenario: {error}"
        ) from error
    blocked = [finding for finding in findings if finding.action == "block"]
    if blocked:
        raise PipelineError(
            "preflight_blocked",
            "; ".join(
                {
                    "missing_coordinates": "Location has no coordinates",
                    "far_from_depot": "Location is too far from the depot",
                    "oversize_stop": f"Stop orders more than one {cap / 100:g} ft trailer",
                }.get(finding.check, finding.message)
                for finding in blocked
            ),
        )
    stock_start: dict[str, int] = defaultdict(int)
    for item in scenario.inventory:
        if item.product_id not in products:
            raise PipelineError(
                "unknown_product", f"Inventory for unknown product {item.product_id}."
            )
        stock_start[item.product_id] += item.available_pieces * settings.inventory_percent // 100

    user_excluded = set(settings.excluded_line_ids)
    excluded: dict[str, str] = {}
    for line in lines.values():
        if reason := exclusion_reason(line, locations[line["location_id"]], cap, user_excluded):
            excluded[line["line_id"]] = reason
    if settings.fulfillment_policy == "whole_order":
        excluded |= whole_order_exclusions(lines.values(), excluded)
    for line_id, reason in sorted(excluded.items()):
        line = lines[line_id]
        if line["ordered"] == 0:
            continue
        evidence = (
            "Excluded by the user before this run."
            if reason == "excluded_by_user"
            else "Whole-order policy: another line of this order was excluded, so the order is "
            "excluded as a whole."
            if reason == "excluded_with_order"
            else f"Location {line['location_id']} has no resolved coordinates."
            if reason == "excluded_unresolved_coordinates"
            else f"One piece is {line['lf'] / 100:g} ft; a trailer holds {cap / 100:g} ft."
        )
        unplanned.append(unplanned_line(line, line["ordered"], reason, "preflight", evidence))
    stages.add(
        "preflight",
        {
            "eligible_line_ids": sorted(set(lines) - set(excluded)),
            "excluded": [{"line_id": k, "reason": v} for k, v in sorted(excluded.items())],
            "checks": [f.model_dump(mode="json") for f in findings],
            "stock": dict(sorted(stock_start.items())),
        },
        [],
        [
            *cap_keys,
            "max_leg_m",
            *travel_keys,
            "preflight",
            "excluded_line_ids",
            "inventory_percent",
            "fulfillment_policy",
        ],
    )

    # ---- 2. Allocate (§8): the chosen strategy and fulfillment policy -------------------------
    report("allocation", {})
    allocation_keys = [
        "allocation_strategy",
        "fulfillment_policy",
    ]
    eligible = [ln for ln in lines.values() if ln["line_id"] not in excluded]
    allocation_hit = stages.lookup("allocation", ["preflight"], allocation_keys)
    allocation_started = time.perf_counter()
    if allocation_hit:
        allocation_payload = allocation_hit
    else:
        result = run_allocation(eligible, stock_start, settings)
        allocation_payload = {
            "strategy": settings.allocation_strategy,
            "fulfillment_policy": settings.fulfillment_policy,
            "sequence": result.sequence,
            "allocated": dict(sorted(result.allocated.items())),
            "residual": dict(sorted(result.residual.items())),
            "shortages": dict(sorted(result.shortages.items())),
        }
    allocated: dict[str, int] = dict(allocation_payload["allocated"])
    stock = dict(allocation_payload["residual"])
    for line in eligible:
        short = line["ordered"] - allocated[line["line_id"]]
        if short:
            unplanned.append(
                unplanned_line(
                    line,
                    short,
                    "stock_shortage",
                    "allocation",
                    allocation_payload["shortages"][line["line_id"]],
                )
            )
    allocation_summary = AllocationSummary(
        strategy=allocation_payload["strategy"],
        fulfillment_policy=allocation_payload["fulfillment_policy"],
        runtime_s=round(time.perf_counter() - allocation_started, 4),
    )
    stages.add("allocation", allocation_payload, ["preflight"], allocation_keys)
    # Aggregation splits oversize stops in this order, so whole pieces fill the same way for
    # every strategy.
    order = sorted(eligible, key=allocation_key)

    # ---- 3. Aggregate same-customer, same-location whole-piece visits (§5) --------------------
    report("aggregation", {})
    by_location: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for line in order:  # allocation order, so splits fill whole pieces in the same order
        if allocated[line["line_id"]] > 0:
            by_location[(line["location_id"], line["customer_id"])].append(line)
    aggregation_hit = stages.lookup("aggregation", ["allocation"], cap_keys)
    if aggregation_hit:
        visits = {v["visit_id"]: v for v in aggregation_hit["visits"]}
    else:
        visits: dict[str, dict[str, Any]] = {}
        for loc_id, customer_id in sorted(by_location):
            bundles: list[list[tuple[str, int]]] = [[]]
            room = cap
            for line in by_location[(loc_id, customer_id)]:
                pieces = allocated[line["line_id"]]
                while pieces:
                    fit = min(pieces, room // line["lf"])
                    if fit == 0:
                        bundles.append([])
                        room = cap
                        continue
                    bundles[-1].append((line["line_id"], fit))
                    room -= fit * line["lf"]
                    pieces -= fit
            for n, bundle in enumerate(bundles, start=1):
                # JSON escaping makes the pair unambiguous even when IDs contain '#'.
                visit_id = f"{json.dumps([loc_id, customer_id], separators=(',', ':'))}#{n}"
                visits[visit_id] = {
                    "visit_id": visit_id,
                    "location_id": loc_id,
                    "lines": [{"line_id": lid, "pieces": p} for lid, p in bundle],
                    "load": sum(p * lines[lid]["lf"] for lid, p in bundle),
                }
    if len(visits) > limits.max_visits:
        raise PipelineError("too_many_visits", f"{len(visits)} visits exceed MAX_VISITS.")
    split_locations = sorted(
        {v["location_id"] for v in visits.values() if not v["visit_id"].endswith("#1")}
    )
    if split_locations:
        diagnostics.append(
            Diagnostic(
                code="greedy_split",
                severity="info",
                message=(
                    f"{len(split_locations)} location(s) exceed one trailer and were split "
                    "greedily "
                    "into whole-piece visits before solving; the solver cannot repack them."
                ),
            )
        )
    stages.add("aggregation", {"visits": list(visits.values())}, ["allocation"], cap_keys)

    # ---- 4. Cluster and repair (§8a) --------------------------------------------------------
    report("clustering", {})
    loc_ids = sorted({loc_id for loc_id, _customer_id in by_location})
    lat_lon = np.array([[locations[i].lat, locations[i].lon] for i in loc_ids], dtype=float)
    clustering_hit = stages.lookup(
        "clustering",
        ["aggregation"],
        [
            "k",
            "auto_k_cap",
            "kmeans_seed",
            "kmeans_n_init",
            "cluster_circuity",
            "max_cluster_diameter_m",
            "max_stops",
            "cluster_strategy",
            "h3_resolution",
        ],
    )
    if clustering_hit:
        clusters_meta = clustering_hit["clusters"]
        repairs = [Repair.model_validate(r) for r in clustering_hit["repairs"]]
        clustered = SimpleNamespace(
            **{
                k: clustering_hit[k]
                for k in ("raw", "requested_k", "selected_k", "fits", "auto_limit_reached")
            }
        )
    else:
        visit_count = defaultdict(int)
        for v in visits.values():
            visit_count[v["location_id"]] += 1
        clusterer = Clusterer(
            loc_ids,
            lat_lon,
            dict(visit_count),
            circuity=settings.cluster_circuity,
            max_diameter_m=settings.max_cluster_diameter_m,
            max_stops=settings.max_stops,
            seed=settings.kmeans_seed,
            n_init=settings.kmeans_n_init,
        )
        if settings.cluster_strategy == "h3":
            clustered = clusterer.run_h3(settings.h3_resolution)
        elif settings.cluster_strategy == "none":
            clustered = clusterer.run_none()
            if loc_ids:
                baseline_ineligible(clusterer, loc_ids, settings)
        else:
            try:
                clustered = clusterer.run(settings.k, settings.auto_k_cap)
            except ValueError as error:
                raise PipelineError("invalid_k", str(error)) from error
        # Visit partitions: all visits of a location stay together unless one location alone
        # exceeds MAX_STOPS, which is chunked by stable visit order (recorded as size repair).
        repairs = [Repair(reason=s.reason, detail=s.detail) for s in clustered.repairs]  # type: ignore[arg-type]
        partitions: list[dict[str, Any]] = []
        for group in clustered.partitions:
            members = sorted(
                (v for v in visits.values() if v["location_id"] in set(group)),
                key=lambda v: (v["location_id"], int(v["visit_id"].rsplit("#", 1)[1])),
            )
            chunks = [
                members[i : i + settings.max_stops]
                for i in range(0, len(members), settings.max_stops)
            ]
            if len(chunks) > 1:
                repairs.append(
                    Repair(
                        reason="degenerate_size",
                        detail=f"{len(members)} visits at one location chunked into "
                        f"{len(chunks)} solves.",
                    )
                )
            for chunk in chunks:
                partitions.append(
                    {
                        "locations": sorted({v["location_id"] for v in chunk}),
                        "visits": [v["visit_id"] for v in chunk],
                    }
                )
        clusters_meta = []
        for i, part in enumerate(partitions):
            cid = f"C{i + 1}"
            diameter = clusterer.diameter(part["locations"]) if part["locations"] else 0
            clusters_meta.append({"id": cid, **part, "diameter_m": diameter})
        if clustered.auto_limit_reached:
            diagnostics.append(
                Diagnostic(
                    code="auto_limit_reached",
                    severity="warning",
                    message=(
                        f"No k up to {clustered.selected_k} passed the "
                        + ("diameter and size" if settings.max_cluster_diameter_m else "solve-size")
                        + " limits; repaired."
                    ),
                )
            )
    if tctx:
        diagnostics.append(
            Diagnostic(
                code="clustering_ignores_windows",
                severity="info",
                message=(
                    "Clustering ignores time windows and service durations; they are enforced "
                    "per cluster when solving, so a window can leave a stop unplanned."
                ),
            )
        )
    stages.add(
        "clustering",
        {
            "strategy": settings.cluster_strategy,
            "raw": clustered.raw,
            "fits": clustered.fits,
            "auto_limit_reached": clustered.auto_limit_reached,
            "clusters": clusters_meta,
            "requested_k": clustered.requested_k,
            "selected_k": clustered.selected_k,
            "repairs": [r.model_dump() for r in repairs],
        },
        ["aggregation"],
        [
            "k",
            "auto_k_cap",
            "kmeans_seed",
            "kmeans_n_init",
            "cluster_circuity",
            "max_cluster_diameter_m",
            "max_stops",
            "cluster_strategy",
            "h3_resolution",
        ],
    )

    # ---- 5. Travel and reachability (§7) -----------------------------------------------------
    report("travel", {"clusters": len(clusters_meta)})
    depot = scenario.depot
    global_nodes = [(depot.lat, depot.lon)] + [tuple(r) for r in lat_lon]
    travel_stage_keys = [*travel_keys, "max_leg_m"]
    travel_hit = stages.lookup("travel", ["clustering"], travel_stage_keys)
    # A compact global reachability graph is computed once. On a cache hit it is
    # recovered with the exact matrices, not silently recalculated.
    global_matrix = (
        None if travel_hit else distance_matrix_m(np.array(global_nodes), settings.travel_circuity)
    )
    if travel_hit:
        globally_reachable = set(travel_hit["globally_reachable"])
    else:
        reachable_global = reachable(global_matrix, settings.max_leg_m)
        globally_reachable = {loc_ids[i - 1] for i in reachable_global if i > 0}
    position = {loc: i for i, loc in enumerate(loc_ids)}
    leg_seconds = duration_leg_reader(
        loc_ids,
        depot,
        {i: (locations[i].lat, locations[i].lon) for i in loc_ids},
        settings.travel_circuity,
    )

    def seconds_matrix(idx: list[int]) -> np.ndarray:
        return estimated_seconds(np.array(global_nodes)[idx], settings.travel_circuity)

    travel = []
    problems = []
    for meta in clusters_meta:
        nodes = meta["locations"]
        idx = [0] + [position[n] + 1 for n in nodes]
        matrix = (
            np.array(travel_hit["clusters"][len(travel)]["matrix"], dtype=np.int64)
            if travel_hit
            else global_matrix[np.ix_(idx, idx)]
        )
        reach = reachable(matrix, settings.max_leg_m)
        reachable_locs = {nodes[i - 1] for i in reach if i > 0}
        solve_visits, blocked = [], []
        for vid in meta["visits"]:
            v = visits[vid]
            if v["location_id"] in reachable_locs:
                solve_visits.append(vid)
            else:
                code = (
                    "unreachable_in_partition"
                    if v["location_id"] in globally_reachable
                    else "unreachable"
                )
                blocked.append({"visit_id": vid, "reason": code})
        travel.append(
            {
                "cluster_id": meta["id"],
                "provider": "haversine",
                "circuity": settings.travel_circuity,
                "units": "meters",
                "nodes": ["depot", *nodes],
                "matrix": matrix.tolist(),
            }
        )
        n = len(solve_visits)
        distance_cost = 1
        monetary = None
        if settings.objective == "trucks_then_distance":
            penalty, bound = truck_count_first_penalty(n, settings.max_leg_m)
        elif settings.objective == "cost":
            monetary = monetary_objective(
                settings.cost_per_truck_cents, settings.cost_per_mile_cents
            )
            penalty, bound = monetary.truck_penalty, None
            distance_cost = monetary.distance_cost
        else:
            penalty, bound = settings.weighted_truck_penalty_m or 0, None
        problems.append(
            {
                "cluster_id": meta["id"],
                "visits": solve_visits,
                "blocked": blocked,
                "objective": settings.objective,
                "truck_penalty": penalty,
                "distance_cost": distance_cost,
                "monetary": (
                    {
                        "cost_per_truck_cents": settings.cost_per_truck_cents,
                        "cost_per_mile_cents": settings.cost_per_mile_cents,
                        "cents_numerator": monetary.cents_numerator,
                        "cents_denominator": monetary.cents_denominator,
                    }
                    if monetary
                    else None
                ),
                "distance_bound_m": bound,
                "vehicles_available": n,
                **(
                    {"time": time_payload(tctx, visits, solve_visits, seconds_matrix(idx))}
                    if tctx
                    else {}
                ),
            }
        )
    if settings.objective == "weighted_distance" and settings.weighted_truck_penalty_m is None:
        raise PipelineError("missing_penalty", "weighted_distance needs weighted_truck_penalty_m.")
    travel_payload: dict[str, Any] = {
        "clusters": travel,
        "globally_reachable": sorted(globally_reachable),
    }
    stages.add("travel", travel_payload, ["clustering"], travel_stage_keys)
    stages.add(
        "problem",
        {"clusters": problems},
        ["travel", "aggregation"],
        [
            "max_leg_m",
            *cap_keys,
            "objective",
            "weighted_truck_penalty_m",
            "cost_per_truck_cents",
            "cost_per_mile_cents",
        ],
    )

    # ---- 6. Solve one PyVRP problem per cluster (§8b) -----------------------------------------
    solves = []
    for i, (meta, prob, trav) in enumerate(zip(clusters_meta, problems, travel, strict=True)):
        report("solve", {"cluster": meta["id"], "index": i + 1, "of": len(problems)})
        task_hash = content_hash(
            {
                "problem": prob,
                "travel": trav,
                "visits": visits,
                "settings": settings.model_dump(mode="json"),
                "versions": versions(),
            }
        )
        task = cluster_task("claim", meta["id"], task_hash, None) if cluster_task else None
        if task and task["status"] in ("succeeded", "failed"):
            solves.append(
                task["result"] or {"cluster_id": meta["id"], "status": "failed", "routes": []}
            )
            continue
        node_of = {loc: k for k, loc in enumerate(trav["nodes"])}
        pvisits = [
            PartitionVisit(vid, node_of[visits[vid]["location_id"]], visits[vid]["load"])
            for vid in prob["visits"]
        ]
        remaining = deadline - clock()
        if not pvisits:
            solves.append({"cluster_id": meta["id"], "status": "empty", "routes": []})
            if cluster_task:
                cluster_task("complete", meta["id"], task_hash, solves[-1])
            continue
        if remaining <= 0.5:
            solves.append({"cluster_id": meta["id"], "status": "budget_exhausted", "routes": []})
            if cluster_task:
                cluster_task("complete", meta["id"], task_hash, solves[-1])
            continue
        partition = PartitionProblem(
            distance=np.array(trav["matrix"], dtype=np.int64),
            visits=pvisits,
            capacity=cap,
            max_leg_m=settings.max_leg_m,
            truck_penalty=prob["truck_penalty"],
            distance_cost=prob["distance_cost"],
            seed=settings.solver_seed,
            max_iterations=settings.solver_max_iterations,
            max_runtime_s=min(settings.solver_time_limit_s, remaining - 0.5),
            time=partition_time(prob, pvisits),
        )
        try:
            result = solve_partition(partition)
        except Exception as error:  # noqa: BLE001 - one cluster's failure must not hide the others
            # Spec §9: a failed cluster invalidates the plan; other clusters stay inspectable.
            # Not checkpointed, so a retried attempt solves this cluster again.
            solves.append(
                {
                    "cluster_id": meta["id"],
                    "status": "solver_error",
                    "error": f"{type(error).__name__}: {error}"[:500],
                    "routes": [],
                }
            )
            continue
        solves.append(
            {
                "cluster_id": meta["id"],
                "status": "solved",
                "solver_feasible": result.solver_feasible,
                "routes": [[prob["visits"][k] for k in route] for route in result.routes],
                "iterations": result.iterations,
                "runtime_s": round(result.runtime_s, 3),
                "cost": result.cost,
            }
        )
        if cluster_task:
            cluster_task("complete", meta["id"], task_hash, solves[-1])
    stages.add(
        "solve",
        {"clusters": solves},
        ["problem"],
        ["solver_seed", "solver_max_iterations", "solver_time_limit_s"],
    )

    # ---- 7. Validate independently from raw travel and lineage (§16) ---------------------------
    report("validation", {})
    lineage_total: dict[str, int] = defaultdict(int)
    for v in visits.values():
        for part in v["lines"]:
            lineage_total[part["line_id"]] += part["pieces"]
    lineage_ok = all(lineage_total.get(k, 0) == a for k, a in allocated.items())
    if not lineage_ok:
        diagnostics.append(
            Diagnostic(
                code="lineage_mismatch", severity="error", message="Visit pieces ≠ allocation."
            )
        )
    validations = []
    for meta, prob, trav, solve in zip(clusters_meta, problems, travel, solves, strict=True):
        validations.append(
            validate_cluster(meta, prob, trav, solve, visits, lines, settings, leg_seconds)
        )
    stages.add(
        "validation",
        {
            "lineage_ok": lineage_ok,
            "clusters": validations,
        },
        ["solve", "travel", "aggregation"],
        ["max_leg_m", *cap_keys, "max_cluster_diameter_m"],
    )

    # ---- 8. Summarize and reconcile (§10) ----------------------------------------------------
    report("summary", {})
    planned_pieces: dict[str, int] = defaultdict(int)
    trucks_out: list[TruckSummary] = []
    cluster_out: list[ClusterSummary] = []
    for i, (meta, prob, solve, check) in enumerate(
        zip(clusters_meta, problems, solves, validations, strict=True)
    ):
        valid = check["valid"]
        cluster_trucks: list[TruckSummary] = (
            truck_summaries(meta["id"], check["trucks"], visits, lines, cap) if valid else []
        )
        for truck in cluster_trucks:
            for tv in truck.visits:
                for lob in tv.lines:
                    planned_pieces[lob.line_id] += lob.pieces
        # Unplanned visits in this cluster, by reason.
        for b in prob["blocked"]:
            add_visit_unplanned(
                unplanned,
                visits[b["visit_id"]],
                lines,
                b["reason"],
                "problem",
                "No chain of legs ≤ the leg limit reaches this location from the depot"
                + (
                    " inside its cluster; try a different k."
                    if b["reason"] == "unreachable_in_partition"
                    else "."
                ),
            )
        if not valid and solve["status"] != "empty":
            reason, stage, evidence = (
                (
                    "no_valid_candidate",
                    "solve",
                    "Run budget exhausted before this cluster was solved; "
                    "not proof of infeasibility.",
                )
                if solve["status"] == "budget_exhausted"
                else (
                    "no_valid_candidate",
                    "solve",
                    "The solver raised an error for this cluster: " + solve.get("error", ""),
                )
                if solve["status"] == "solver_error"
                else (
                    "no_valid_candidate",
                    "solve",
                    "PyVRP returned no feasible candidate within its budget"
                    + (" under the time windows and service durations" if prob.get("time") else "")
                    + "; not proof of infeasibility.",
                )
                if not solve.get("solver_feasible")
                else (
                    "candidate_invalid",
                    "validation",
                    "Validator rejected the candidate: " + "; ".join(check["violations"][:5]),
                )
            )
            for vid in prob["visits"]:
                add_visit_unplanned(unplanned, visits[vid], lines, reason, stage, evidence)
        fills = [t.fill for t in cluster_trucks]
        load = sum(visits[v]["load"] for v in meta["visits"])
        cl_latlon = np.array([[locations[x].lat, locations[x].lon] for x in meta["locations"]])
        cluster_out.append(
            ClusterSummary(
                id=meta["id"],
                index=i,
                location_ids=meta["locations"],
                visit_count=len(meta["visits"]),
                planned_visit_count=sum(len(t.visits) for t in cluster_trucks),
                status=(
                    "nothing_to_solve"
                    if solve["status"] == "empty"
                    else "validated"
                    if valid
                    else "no_candidate"
                    if solve["status"] in ("budget_exhausted", "solver_error")
                    or not solve.get("solver_feasible")
                    else "invalid_candidate"
                ),
                trucks=len(cluster_trucks),
                load=load,
                capacity_lower_bound=math.ceil(load / cap),
                avg_fill=sum(fills) / len(fills) if fills else None,
                min_fill=min(fills) if fills else None,
                diameter_m=meta["diameter_m"],
                mean_centroid_distance_m=mean_centroid_distance(
                    cl_latlon, settings.cluster_circuity
                ),
                loaded_distance_m=sum(t.distance_m for t in cluster_trucks),
                planned_amount_cents=sum(t.amount_cents for t in cluster_trucks),
                objective_mode=prob["objective"],
                truck_penalty=prob["truck_penalty"],
                distance_bound_m=prob["distance_bound_m"],
                solver_feasible=solve.get("solver_feasible"),
                iterations=solve.get("iterations", 0),
                runtime_s=solve.get("runtime_s", 0.0),
                violations=check["violations"],
            )
        )
        trucks_out.extend(cluster_trucks)

    products_out = []
    for pid, product in products.items():
        pl = [ln for ln in lines.values() if ln["product_id"] == pid]
        ordered = sum(ln["ordered"] for ln in pl)
        excl = sum(ln["ordered"] for ln in pl if ln["line_id"] in excluded)
        alloc = sum(allocated.get(ln["line_id"], 0) for ln in pl)
        planned = sum(planned_pieces.get(ln["line_id"], 0) for ln in pl)
        products_out.append(
            ProductReconciliation(
                product_id=pid,
                label=product.label,
                starting_inventory=stock_start.get(pid, 0),
                residual=stock.get(pid, 0),
                ordered=ordered,
                excluded=excl,
                eligible=ordered - excl,
                allocated=alloc,
                unselected=ordered - excl - alloc,
                planned=planned,
                allocated_unplanned=alloc - planned,
                ordered_cents=sum(ln["ordered"] * ln["value"] for ln in pl),
                allocated_cents=sum(allocated.get(ln["line_id"], 0) * ln["value"] for ln in pl),
                planned_cents=sum(planned_pieces.get(ln["line_id"], 0) * ln["value"] for ln in pl),
            )
        )

    fills = [t.fill for t in trucks_out]
    total_load = sum(v["load"] for v in visits.values())
    planned_load = sum(t.load for t in trucks_out)
    capacity_total = cap * len(trucks_out)
    all_valid = (
        all(c.status in ("validated", "nothing_to_solve") for c in cluster_out) and lineage_ok
    )
    planned_visits = sum(len(t.visits) for t in trucks_out)
    coverage = "empty" if not visits else "complete" if planned_visits == len(visits) else "partial"

    location_state = {}
    for loc in scenario.locations:
        ls = [ln for ln in lines.values() if ln["location_id"] == loc.id and ln["ordered"] > 0]
        alloc = sum(allocated.get(ln["line_id"], 0) for ln in ls)
        plan = sum(planned_pieces.get(ln["line_id"], 0) for ln in ls)
        if not ls:
            state = "no_demand"
        elif all(ln["line_id"] in excluded for ln in ls):
            state = "excluded"
        elif alloc and plan == alloc:
            state = "planned"
        elif plan:
            state = "partial"
        else:
            state = "unplanned"
        location_state[loc.id] = state
    cluster_of = {loc: c["id"] for c in clusters_meta for loc in c["locations"]}

    if not all_valid:
        diagnostics.append(
            Diagnostic(
                code="partial_plan",
                severity="error",
                message="At least one cluster has no validated candidate; "
                "this plan is invalid as a whole. "
                "Validated clusters remain inspectable.",
            )
        )
    summary = RunSummary(
        scenario_name=scenario.name,
        validity="valid" if all_valid else "invalid",
        coverage=coverage,
        settings=settings,
        depot=scenario.depot,
        totals=Totals(
            ordered_cents=sum(p.ordered_cents for p in products_out),
            allocated_cents=sum(p.allocated_cents for p in products_out),
            planned_cents=sum(p.planned_cents for p in products_out),
            trucks=len(trucks_out),
            locations=len(loc_ids),
            visits=len(visits),
            planned_visits=planned_visits,
            load=total_load,
            avg_fill=sum(fills) / len(fills) if fills else None,
            min_fill=min(fills) if fills else None,
            utilization=planned_load / capacity_total if trucks_out else None,
            loaded_distance_m=sum(t.distance_m for t in trucks_out),
            capacity_lower_bound=math.ceil(total_load / cap),
            sum_cluster_lower_bounds=sum(c.capacity_lower_bound for c in cluster_out),
        ),
        clustering=ClusteringSummary(
            strategy=settings.cluster_strategy if loc_ids else "none",
            h3_resolution=settings.h3_resolution if settings.cluster_strategy == "h3" else None,
            requested_k=clustered.requested_k,
            selected_k=clustered.selected_k,
            raw_cluster_count=len(clustered.raw),
            effective_cluster_count=len(clusters_meta),
            fits=clustered.fits,
            auto_limit_reached=clustered.auto_limit_reached,
            repairs=repairs,
        ),
        clusters=cluster_out,
        trucks=trucks_out,
        locations=[
            MapLocation(
                id=loc.id,
                label=loc.label,
                lat=loc.lat,
                lon=loc.lon,
                coordinate_source=loc.coordinate_source,
                cluster_id=cluster_of.get(loc.id),
                state=location_state[loc.id],  # type: ignore[arg-type]
            )
            for loc in scenario.locations
        ],
        products=products_out,
        unplanned=sorted(unplanned, key=lambda u: (u.line_id, u.reason)),
        preflight=findings,
        allocation=allocation_summary,
        travel=travel_summary(settings),
        time=(
            TimeSummary(
                timezone=tctx.timezone,
                planning_date=tctx.planning_date,
                midnight_epoch_s=tctx.midnight_epoch_s,
                depot_open_s=tctx.depot_open_s,
                horizon_end_s=tctx.horizon_end_s,
            )
            if tctx
            else None
        ),
        diagnostics=diagnostics,
        versions=versions(),
    )
    reconcile(summary)
    stages.add(
        "summary",
        summary.model_dump(mode="json"),
        ["validation", "allocation", "clustering"],
        [],
    )
    return PipelineOutput(stages.artifacts, summary)


# ---- helpers ------------------------------------------------------------------------------------


def travel_summary(settings: RunSettings) -> TravelSummary:
    return TravelSummary(
        mode="estimated",
        provider="haversine",
        provider_version="haversine/1",
        dataset_revision="earth-radius-6371008.8m",
        profile="estimated",
        circuity=settings.travel_circuity,
    )


def line_record(order, line, products) -> dict[str, Any]:
    """One order line as the pipeline stages and the validator read it."""
    return {
        "line_id": line.id,
        "order_id": order.id,
        "customer_id": order.customer_id or order.id,
        "product_id": line.product_id,
        "location_id": order.location_id,
        "order_date": order.order_date,
        "priority": order.priority,
        "ordered": line.ordered_pieces,
        "value": line.net_value_per_piece_cents,
        "lf": line.linear_feet_per_piece or products[line.product_id].linear_feet_per_piece,
    }


def exclusion_reason(line, loc, cap: int, user_excluded: set[str]) -> str | None:
    if line["line_id"] in user_excluded:
        return "excluded_by_user"
    if loc.lat is None or loc.lon is None or loc.coordinate_source == "unresolved":
        return "excluded_unresolved_coordinates"
    if line["lf"] > cap:
        return "oversize_piece"
    return None


def allocation_key(line: dict[str, Any]) -> tuple:
    """Order date, then net value per piece (descending), then stable ID (§8)."""
    return (line["order_date"], -line["value"], line["line_id"])


def whole_order_exclusions(lines, excluded: dict[str, str]) -> dict[str, str]:
    """Whole-order mode (§8): an order with an excluded line is excluded as a whole, never
    filled from its eligible subset."""
    hit = {ln["order_id"] for ln in lines if ln["line_id"] in excluded}
    return {
        ln["line_id"]: "excluded_with_order"
        for ln in lines
        if ln["order_id"] in hit and ln["line_id"] not in excluded
    }


def run_allocation(eligible, stock, settings: RunSettings):
    return allocate(eligible, stock, settings.allocation_strategy, settings.fulfillment_policy)


def allocated_locations(scenario: ScenarioDocument, settings: RunSettings) -> list[str]:
    """The location population the cluster stage sees: locations with allocated pieces after
    exclusions and the run's allocation strategy. Shared with the k explorer so both cluster the
    same locations."""
    products = {p.id: p for p in scenario.products}
    locations = {loc.id: loc for loc in scenario.locations}
    stock: dict[str, int] = defaultdict(int)
    for item in scenario.inventory:
        stock[item.product_id] += item.available_pieces * settings.inventory_percent // 100
    user_excluded = set(settings.excluded_line_ids)
    lines = []
    excluded: dict[str, str] = {}
    for order in scenario.orders:
        for ln in order.lines:
            line = {
                "line_id": ln.id,
                "order_id": order.id,
                "customer_id": order.customer_id or order.id,
                "order_date": order.order_date,
                "priority": order.priority,
                "value": ln.net_value_per_piece_cents,
                "product_id": ln.product_id,
                "location_id": order.location_id,
                "ordered": ln.ordered_pieces,
                "lf": ln.linear_feet_per_piece or products[ln.product_id].linear_feet_per_piece,
            }
            lines.append(line)
            loc = locations[order.location_id]
            if reason := exclusion_reason(line, loc, settings.trailer_capacity, user_excluded):
                excluded[ln.id] = reason
    if settings.fulfillment_policy == "whole_order":
        excluded |= whole_order_exclusions(lines, excluded)
    eligible = [ln for ln in lines if ln["line_id"] not in excluded]
    allocated = run_allocation(eligible, stock, settings).allocated
    return sorted({ln["location_id"] for ln in eligible if allocated[ln["line_id"]]})


def baseline_ineligible(clusterer: Clusterer, loc_ids: list[str], settings: RunSettings) -> None:
    """The no-clustering baseline exists only when every visit fits one solve (spec §8a, M4)."""
    size = clusterer.size(loc_ids)
    if size > settings.max_stops:
        raise PipelineError(
            "baseline_ineligible",
            f"No-clustering baseline needs all {size} visits in one solve; MAX_STOPS is "
            f"{settings.max_stops}. Compare the capacity lower bounds instead.",
        )
    diameter = clusterer.diameter(loc_ids)
    if clusterer.too_wide(diameter):
        raise PipelineError(
            "baseline_ineligible",
            f"No-clustering baseline is {diameter / 1609.344:.0f} mi wide, over the enabled "
            "cluster-diameter limit.",
        )


def unplanned_line(line, pieces, reason, stage, evidence) -> UnplannedLine:
    return UnplannedLine(
        line_id=line["line_id"],
        order_id=line["order_id"],
        product_id=line["product_id"],
        location_id=line["location_id"],
        pieces=pieces,
        amount_cents=pieces * line["value"],
        reason=reason,
        stage=stage,
        evidence=evidence,
    )


def add_visit_unplanned(out, visit, lines, reason, stage, evidence) -> None:
    for part in visit["lines"]:
        line = lines[part["line_id"]]
        existing = next(
            (u for u in out if u.line_id == line["line_id"] and u.reason == reason), None
        )
        if existing:
            existing.pieces += part["pieces"]
            existing.amount_cents += part["pieces"] * line["value"]
        else:
            out.append(unplanned_line(line, part["pieces"], reason, stage, evidence))


def mean_centroid_distance(lat_lon: np.ndarray, circuity: float) -> float:
    if len(lat_lon) == 0:
        return 0.0
    c = centroid(lat_lon)
    if c is None:
        return 0.0
    d = haversine_m(np.vstack([np.array([c]), lat_lon]))[0, 1:] * circuity
    return round(float(d.mean()), 1)


def time_payload(tctx: TimeContext, visits, solve_visits, seconds: np.ndarray) -> dict[str, Any]:
    """Time data of one cluster problem: solver durations plus each visit's inherited service
    duration and window (seconds from local midnight; None = open)."""
    rows = {}
    for vid in solve_visits:
        vt = tctx.locations.get(visits[vid]["location_id"], VisitTime())
        rows[vid] = [vt.service_s, vt.earliest_s, vt.latest_s]
    return {
        "depot_open_s": tctx.depot_open_s,
        "horizon_end_s": tctx.horizon_end_s,
        "seconds": seconds.tolist(),
        "visits": rows,
    }


def partition_time(prob: dict[str, Any], pvisits: list[PartitionVisit]) -> PartitionTime | None:
    t = prob.get("time")
    if t is None:
        return None
    return PartitionTime(
        duration=np.array(t["seconds"], dtype=np.int64),
        visits=[VisitTime(*t["visits"][pv.id]) for pv in pvisits],
        depot_open_s=t["depot_open_s"],
        horizon_end_s=t["horizon_end_s"],
    )


def validate_cluster(
    meta, prob, trav, solve, visits, lines, settings, leg_seconds=None
) -> dict[str, Any]:
    """Checks coverage, lineage load, capacity, physical legs, membership and, when the
    optional policy is on, cluster diameter."""
    if solve["status"] == "empty":
        return {"cluster_id": meta["id"], "valid": True, "violations": [], "trucks": []}
    if solve["status"] != "solved":
        return {
            "cluster_id": meta["id"],
            "valid": False,
            "violations": [solve.get("error", "no candidate")],
            "trucks": [],
        }
    violations: list[str] = []
    if not solve["solver_feasible"]:
        violations.append(Finding("solver_infeasible", "solver reported the candidate infeasible"))
    found, trucks = check_routes(
        meta,
        prob,
        trav,
        solve["routes"],
        visits,
        lines,
        settings,
        leg_seconds,
    )
    violations.extend(found)
    return {
        "cluster_id": meta["id"],
        "valid": not violations,
        "violations": violations,
        "trucks": trucks,
    }


def check_routes(
    meta, prob, trav, routes, visits, lines, settings, leg_seconds=None
) -> tuple[list[Finding], list[dict[str, Any]]]:
    """The independent validator for one cluster's routes (ordered visit IDs per truck). Every
    leg, load and time is recomputed from the recorded travel artifact, the visit lineage and the
    estimated durations.

    Returns the violations and one entry per truck, parallel to ``routes``; an entry lists only
    the truck's visits that belong to the cluster problem, so its legs line up with them.
    """
    violations: list[Finding] = []
    trucks = []
    node_of = {loc: k for k, loc in enumerate(trav["nodes"])}
    matrix = trav["matrix"]
    expected = set(prob["visits"])
    blocked = {b["visit_id"] for b in prob.get("blocked", [])}
    seen: dict[str, int] = {}
    for t, route in enumerate(routes):
        if not route:
            violations.append(Finding("empty_truck", f"truck {t + 1} has no visits", t + 1))
            continue
        load = 0
        legs = []
        legs_s = []
        known = []
        prev = 0
        for vid in route:
            if vid not in expected:
                violations.append(
                    Finding(
                        "unreachable_visit",
                        f"{vid} has no chain of legs within the leg limit from the depot in "
                        f"cluster {meta['id']}, so it is not part of the problem",
                        t + 1,
                        vid,
                    )
                    if vid in blocked
                    else Finding(
                        "unknown_visit",
                        f"{vid} does not belong to cluster {meta['id']}",
                        t + 1,
                        vid,
                    )
                )
                continue
            if vid in seen:
                violations.append(
                    Finding("duplicate_visit", f"{vid} is on more than one truck", t + 1, vid)
                )
            seen[vid] = t
            known.append(vid)
            v = visits[vid]
            load += sum(p["pieces"] * lines[p["line_id"]]["lf"] for p in v["lines"])
            node = node_of[v["location_id"]]
            leg = int(matrix[prev][node])
            if leg < 0:
                violations.append(
                    Finding(
                        "leg_missing",
                        f"leg to {v['location_id']} is unreachable in the raw matrix",
                        t + 1,
                        vid,
                    )
                )
            if leg > settings.max_leg_m:
                violations.append(
                    Finding(
                        "leg_over_limit",
                        f"leg to {v['location_id']} is {leg / 1609.344:.0f} mi > "
                        f"{settings.max_leg_m / 1609.344:.0f} mi",
                        t + 1,
                        vid,
                    )
                )
            legs.append(leg)
            if leg_seconds is not None:
                seconds = leg_seconds(trav["nodes"][prev], trav["nodes"][node])
                if seconds < 0:
                    violations.append(
                        Finding(
                            "leg_no_duration",
                            f"leg to {v['location_id']} has no duration in the provider",
                            t + 1,
                            vid,
                        )
                    )
                legs_s.append(seconds)
            prev = node
        capacity = settings.trailer_capacity
        if load > capacity:
            violations.append(
                Finding("over_capacity", f"truck {t + 1} load {load} > capacity {capacity}", t + 1)
            )
        timed = leg_seconds is not None and len(legs_s) == len(legs)
        entry = {
            "visits": known,
            "load": load,
            "legs_m": legs,
            "legs_s": legs_s if timed else [None] * len(legs),
            "distance_m": sum(legs),
            "drive_s": sum(legs_s) if timed else None,
        }
        clock = prob.get("time")
        if clock and known and len(legs) == len(known):
            # Independent recomputation from the estimated durations, never the solver's.
            if not timed or min(legs_s) < 0:
                violations.append(
                    Finding(
                        "leg_no_duration",
                        f"truck {t + 1} has legs without a provider duration",
                        t + 1,
                    )
                )
            else:
                timings, found = recompute_route(
                    legs_s,
                    [VisitTime(*clock["visits"][vid]) for vid in known],
                    [f"truck {t + 1} {visits[vid]['location_id']}" for vid in known],
                    clock["depot_open_s"],
                    clock["horizon_end_s"],
                    known,
                )
                violations.extend(f.at(t + 1) for f in found)
                entry["timing"] = [vars(x) for x in timings]
                entry["shift_start_s"] = clock["depot_open_s"]
        trucks.append(entry)
    for vid in sorted(expected - set(seen)):
        violations.append(Finding("missing_visit", f"{vid} is not on any truck", visit_id=vid))
    limit = settings.max_cluster_diameter_m
    if limit is not None and meta["diameter_m"] > limit:
        violations.append(
            Finding(
                "cluster_diameter",
                f"cluster diameter {meta['diameter_m'] / 1609.344:.0f} mi exceeds the limit",
            )
        )
    return violations, trucks


def truck_summaries(cluster_id, checked, visits, lines, cap) -> list[TruckSummary]:
    """Result rows for checked trucks (``check_routes`` entries): stop sequence, lines on board,
    loads, legs and, with the time-window adapter, the recomputed timing. A truck that uses a leg
    without a recorded distance or duration is an error."""
    out = []
    for t, truck in enumerate(checked):
        if min(truck["legs_m"], default=0) < 0 or any(
            s is not None and s < 0 for s in truck["legs_s"]
        ):
            raise ValueError(f"truck {t + 1} uses a leg without a recorded value")
        tv = []
        for seq, (vid, leg, leg_s) in enumerate(
            zip(truck["visits"], truck["legs_m"], truck["legs_s"], strict=True), 1
        ):
            v = visits[vid]
            on_board = [
                LineOnBoard(
                    line_id=p["line_id"],
                    order_id=lines[p["line_id"]]["order_id"],
                    product_id=lines[p["line_id"]]["product_id"],
                    pieces=p["pieces"],
                    linear_feet=p["pieces"] * lines[p["line_id"]]["lf"],
                    amount_cents=p["pieces"] * lines[p["line_id"]]["value"],
                )
                for p in v["lines"]
            ]
            stop_time = truck["timing"][seq - 1] if "timing" in truck else None
            tv.append(
                TruckVisit(
                    visit_id=vid,
                    location_id=v["location_id"],
                    sequence=seq,
                    leg_m=leg,
                    leg_s=leg_s,
                    load=v["load"],
                    lines=on_board,
                    **(
                        {
                            "arrival_s": stop_time["arrival_s"],
                            "wait_s": stop_time["wait_s"],
                            "service_s": stop_time["service_s"],
                            "start_s": stop_time["start_s"],
                            "departure_s": stop_time["departure_s"],
                            "window_earliest_s": stop_time["earliest_s"],
                            "window_latest_s": stop_time["latest_s"],
                        }
                        if stop_time
                        else {}
                    ),
                )
            )
        out.append(
            TruckSummary(
                id=f"{cluster_id}-T{t + 1}",
                cluster_id=cluster_id,
                load=truck["load"],
                fill=truck["load"] / cap,
                distance_m=truck["distance_m"],
                drive_s=truck["drive_s"],
                amount_cents=sum(lob.amount_cents for x in tv for lob in x.lines),
                visits=tv,
                **(
                    {
                        "shift_start_s": truck["shift_start_s"],
                        "service_s_total": sum(x.service_s for x in tv),
                        "wait_s_total": sum(x.wait_s for x in tv),
                        "end_s": tv[-1].departure_s,
                    }
                    if "timing" in truck
                    else {}
                ),
            )
        )
    return out


def reconcile(summary: RunSummary) -> None:
    """Spec §10 identities; a failure here is a bug, not a user-facing result."""
    by_reason: dict[tuple[str, str], int] = defaultdict(int)
    for u in summary.unplanned:
        by_reason[(u.product_id, u.reason)] += u.pieces
    for p in summary.products:
        assert p.ordered == p.excluded + p.eligible
        assert p.eligible == p.allocated + p.unselected
        assert p.allocated == p.planned + p.allocated_unplanned
        assert p.starting_inventory == p.allocated + p.residual
        excluded = sum(
            n
            for (pid, r), n in by_reason.items()
            if pid == p.product_id
            and r
            in (
                "excluded_by_user",
                "excluded_with_order",
                "excluded_unresolved_coordinates",
                "oversize_piece",
            )
        )
        short = by_reason.get((p.product_id, "stock_shortage"), 0)
        later = sum(
            n
            for (pid, r), n in by_reason.items()
            if pid == p.product_id
            and r
            in (
                "unreachable",
                "unreachable_in_partition",
                "candidate_invalid",
                "no_valid_candidate",
            )
        )
        assert excluded == p.excluded, (p.product_id, excluded, p.excluded)
        assert short == p.unselected, (p.product_id, short, p.unselected)
        assert later == p.allocated_unplanned, (p.product_id, later, p.allocated_unplanned)
