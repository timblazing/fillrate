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

from .artifact_codec import decode_travel, encode_travel
from .canonical import content_hash
from .clustering import Clusterer, centroid
from .loads import (
    PartitionProblem,
    PartitionVisit,
    monetary_objective,
    solve_partition,
    truck_count_first_penalty,
)
from .model import (
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
    Totals,
    TruckSummary,
    TruckVisit,
    UnplannedLine,
)
from .preflight import preflight_checks
from .travel import distance_matrix_m, haversine_m

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
    return {name: version(name) for name in ("pyvrp", "scikit-learn", "numpy")} | {
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
    deadline = clock() + limits.run_wall_limit_s
    stages = Stages(
        settings,
        execution_id or str(uuid.uuid4()),
        now_ms,
        content_hash(scenario.model_dump(mode="json")),
        cache,
        checkpoint,
    )
    cap = settings.trailer_capacity
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
            lf = line.linear_feet_per_piece or products[line.product_id].linear_feet_per_piece
            lines[line.id] = {
                "line_id": line.id,
                "order_id": order.id,
                "customer_id": order.customer_id or order.id,
                "product_id": line.product_id,
                "location_id": order.location_id,
                "order_date": order.order_date,
                "ordered": line.ordered_pieces,
                "value": line.net_value_per_piece_cents,
                "lf": lf,
            }
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
                    "oversize_stop": (
                        f"Stop orders more than one {settings.trailer_capacity / 100:g} ft trailer"
                    ),
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
        stock_start[item.product_id] += item.available_pieces

    user_excluded = set(settings.excluded_line_ids)
    excluded: dict[str, str] = {}
    for line in lines.values():
        loc = locations[line["location_id"]]
        if line["line_id"] in user_excluded:
            excluded[line["line_id"]] = "excluded_by_user"
        elif loc.lat is None or loc.lon is None or loc.coordinate_source == "unresolved":
            excluded[line["line_id"]] = "excluded_unresolved_coordinates"
        elif line["lf"] > cap:
            excluded[line["line_id"]] = "oversize_piece"
    for line_id, reason in sorted(excluded.items()):
        line = lines[line_id]
        if line["ordered"] == 0:
            continue
        evidence = (
            "Excluded by the user before this run."
            if reason == "excluded_by_user"
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
        ["trailer_capacity", "max_leg_m", "travel_circuity", "preflight", "excluded_line_ids"],
    )

    # ---- 2. Allocate: order date, then net value per piece, then stable ID (§8) ----------------
    report("allocation", {})
    stock = dict(stock_start)
    allocated: dict[str, int] = {}
    order = sorted(
        (ln for ln in lines.values() if ln["line_id"] not in excluded),
        key=lambda ln: (ln["order_date"], -ln["value"], ln["line_id"]),
    )
    allocation_hit = stages.lookup("allocation", ["preflight"], [])
    for line in order:
        take = (
            allocation_hit["allocated"][line["line_id"]]
            if allocation_hit
            else min(line["ordered"], stock.get(line["product_id"], 0))
        )
        allocated[line["line_id"]] = take
        stock[line["product_id"]] = stock.get(line["product_id"], 0) - take
        short = line["ordered"] - take
        if short:
            unplanned.append(
                unplanned_line(
                    line,
                    short,
                    "stock_shortage",
                    "allocation",
                    f"{stock_start.get(line['product_id'], 0)} pieces of {line['product_id']} in "
                    "stock were already given to earlier-dated or higher-value lines.",
                )
            )
    stages.add(
        "allocation",
        {
            "strategy": "order_date_then_value",
            "sequence": [ln["line_id"] for ln in order],
            "allocated": dict(sorted(allocated.items())),
            "residual": dict(sorted(stock.items())),
        },
        ["preflight"],
        [],
    )

    # ---- 3. Aggregate same-customer, same-location whole-piece visits (§5) --------------------
    report("aggregation", {})
    by_location: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for line in order:  # allocation order, so splits fill whole pieces in the same order
        if allocated[line["line_id"]] > 0:
            by_location[(line["location_id"], line["customer_id"])].append(line)
    aggregation_hit = stages.lookup("aggregation", ["allocation"], ["trailer_capacity"])
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
    stages.add(
        "aggregation", {"visits": list(visits.values())}, ["allocation"], ["trailer_capacity"]
    )

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
    stages.add(
        "clustering",
        {
            "strategy": "kmeans",
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
        ],
    )

    # ---- 5. Travel and reachability (§7) -----------------------------------------------------
    report("travel", {"clusters": len(clusters_meta)})
    depot = scenario.depot
    global_nodes = [(depot.lat, depot.lon)] + [tuple(r) for r in lat_lon]
    travel_hit = stages.lookup("travel", ["clustering"], ["travel_circuity", "max_leg_m"])
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
            }
        )
    if settings.objective == "weighted_distance" and settings.weighted_truck_penalty_m is None:
        raise PipelineError("missing_penalty", "weighted_distance needs weighted_truck_penalty_m.")
    stages.add(
        "travel",
        {"clusters": travel, "globally_reachable": sorted(globally_reachable)},
        ["clustering"],
        ["travel_circuity", "max_leg_m"],
    )
    stages.add(
        "problem",
        {"clusters": problems},
        ["travel", "aggregation"],
        [
            "max_leg_m",
            "trailer_capacity",
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
        result = solve_partition(
            PartitionProblem(
                distance=np.array(trav["matrix"], dtype=np.int64),
                visits=pvisits,
                capacity=cap,
                max_leg_m=settings.max_leg_m,
                truck_penalty=prob["truck_penalty"],
                distance_cost=prob["distance_cost"],
                seed=settings.solver_seed,
                max_iterations=settings.solver_max_iterations,
                max_runtime_s=min(settings.solver_time_limit_s, remaining - 0.5),
            )
        )
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
        validations.append(validate_cluster(meta, prob, trav, solve, visits, lines, settings))
    stages.add(
        "validation",
        {"lineage_ok": lineage_ok, "clusters": validations},
        ["solve", "travel", "aggregation"],
        ["max_leg_m", "trailer_capacity", "max_cluster_diameter_m"],
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
        cluster_trucks: list[TruckSummary] = []
        if valid:
            for t, truck in enumerate(check["trucks"]):
                tv = []
                for seq, (vid, leg) in enumerate(
                    zip(truck["visits"], truck["legs_m"], strict=True), 1
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
                    for p in v["lines"]:
                        planned_pieces[p["line_id"]] += p["pieces"]
                    tv.append(
                        TruckVisit(
                            visit_id=vid,
                            location_id=v["location_id"],
                            sequence=seq,
                            leg_m=leg,
                            load=v["load"],
                            lines=on_board,
                        )
                    )
                cluster_trucks.append(
                    TruckSummary(
                        id=f"{meta['id']}-T{t + 1}",
                        cluster_id=meta["id"],
                        load=truck["load"],
                        fill=truck["load"] / cap,
                        distance_m=truck["distance_m"],
                        amount_cents=sum(lob.amount_cents for x in tv for lob in x.lines),
                        visits=tv,
                    )
                )
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
                    "PyVRP returned no feasible candidate within its budget; "
                    "not proof of infeasibility.",
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
                    if solve["status"] == "budget_exhausted" or not solve.get("solver_feasible")
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
            utilization=planned_load / (cap * len(trucks_out)) if trucks_out else None,
            loaded_distance_m=sum(t.distance_m for t in trucks_out),
            capacity_lower_bound=math.ceil(total_load / cap),
            sum_cluster_lower_bounds=sum(c.capacity_lower_bound for c in cluster_out),
        ),
        clustering=ClusteringSummary(
            strategy="kmeans" if loc_ids else "none",
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


def reachable(matrix: np.ndarray, max_leg_m: int) -> set[int]:
    """Nodes reachable from node 0 over allowed directed legs (≤ limit)."""
    allowed = matrix <= max_leg_m
    np.fill_diagonal(allowed, False)
    seen, frontier = {0}, [0]
    while frontier:
        node = frontier.pop()
        for nxt in np.nonzero(allowed[node])[0]:
            if int(nxt) not in seen:
                seen.add(int(nxt))
                frontier.append(int(nxt))
    return seen


def mean_centroid_distance(lat_lon: np.ndarray, circuity: float) -> float:
    if len(lat_lon) == 0:
        return 0.0
    c = centroid(lat_lon)
    if c is None:
        return 0.0
    d = haversine_m(np.vstack([np.array([c]), lat_lon]))[0, 1:] * circuity
    return round(float(d.mean()), 1)


def validate_cluster(meta, prob, trav, solve, visits, lines, settings) -> dict[str, Any]:
    """Checks coverage, lineage load, capacity, physical legs, membership and, when the
    optional policy is on, cluster diameter."""
    violations: list[str] = []
    trucks = []
    if solve["status"] == "empty":
        return {"cluster_id": meta["id"], "valid": True, "violations": [], "trucks": []}
    if solve["status"] != "solved":
        return {
            "cluster_id": meta["id"],
            "valid": False,
            "violations": ["no candidate"],
            "trucks": [],
        }
    if not solve["solver_feasible"]:
        violations.append("solver reported the candidate infeasible")
    node_of = {loc: k for k, loc in enumerate(trav["nodes"])}
    matrix = trav["matrix"]
    expected = set(prob["visits"])
    seen: dict[str, int] = {}
    for t, route in enumerate(solve["routes"]):
        if not route:
            violations.append(f"truck {t + 1} has no visits")
            continue
        load = 0
        legs = []
        prev = 0
        for vid in route:
            if vid not in expected:
                violations.append(f"{vid} does not belong to cluster {meta['id']}")
                continue
            if vid in seen:
                violations.append(f"{vid} is on more than one truck")
            seen[vid] = t
            v = visits[vid]
            load += sum(p["pieces"] * lines[p["line_id"]]["lf"] for p in v["lines"])
            node = node_of[v["location_id"]]
            leg = int(matrix[prev][node])
            if leg > settings.max_leg_m:
                violations.append(
                    f"leg to {v['location_id']} is {leg / 1609.344:.0f} mi > "
                    f"{settings.max_leg_m / 1609.344:.0f} mi"
                )
            legs.append(leg)
            prev = node
        if load > settings.trailer_capacity:
            violations.append(f"truck {t + 1} load {load} > capacity {settings.trailer_capacity}")
        trucks.append({"visits": route, "load": load, "legs_m": legs, "distance_m": sum(legs)})
    for vid in sorted(expected - set(seen)):
        violations.append(f"{vid} is not on any truck")
    limit = settings.max_cluster_diameter_m
    if limit is not None and meta["diameter_m"] > limit:
        violations.append(
            f"cluster diameter {meta['diameter_m'] / 1609.344:.0f} mi exceeds the limit"
        )
    return {
        "cluster_id": meta["id"],
        "valid": not violations,
        "violations": violations,
        "trucks": trucks,
    }


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
            and r in ("excluded_by_user", "excluded_unresolved_coordinates", "oversize_piece")
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
