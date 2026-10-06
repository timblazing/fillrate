"""Verified warm starts (spec §3, §10, M6).

A warm start maps a source plan onto one cluster of a new run only under an exact compatibility
rule, and only after the independent validator accepts the mapped plan on the new problem:

1. Travel: the source plan was validated on the same travel identity (estimated haversine with the
   same circuity, or the same stored directed snapshot). Otherwise ``travel_changed``.
2. Visits: some validated source cluster planned exactly the new cluster's solve visits (same visit
   IDs). A non-validated source cluster over the same locations gives ``source_invalid``; anything
   else ``visit_set_changed``.
3. Demands: every visit keeps its location and load. Otherwise ``demand_changed``.
4. Validation: the pipeline's independent validator accepts the mapped routes on the new problem
   (legs, capacity, windows, diameter policy). Otherwise ``invalid_on_new_problem``.
5. Solver: PyVRP sees the plan as complete and feasible (`loads.initial_solution`). Otherwise
   ``solver_rejected``.

A cluster that fails any rule is solved cold with the reason recorded. The source interface is the
`WarmStartPlan` document: `plan_from_summary` builds it from a succeeded run's summary and
`plan_from_baseline` from a saved manual baseline (the worker receives either over the loopback
transport after the web's owner checks). Both then go through the same rules.
"""

from __future__ import annotations

from typing import Any

from .model import (
    RunSettings,
    WarmStartCluster,
    WarmStartPlan,
    WarmStartSource,
    WarmStartTravel,
    WarmStartVisit,
)


def travel_identity(settings: RunSettings | dict[str, Any]) -> WarmStartTravel:
    """What travel a plan was (or will be) validated on, from run settings."""
    data = settings.model_dump(mode="json") if isinstance(settings, RunSettings) else settings
    if data.get("travel_snapshot_id"):
        return WarmStartTravel(mode="snapshot", snapshot_id=data["travel_snapshot_id"])
    return WarmStartTravel(mode="estimated", circuity=data.get("travel_circuity", 1.2))


def plan_from_summary(summary: dict[str, Any], source: WarmStartSource) -> WarmStartPlan:
    """The validated plan of a succeeded run. Reads only the fields it needs, so summaries from
    earlier pipeline versions still work. Trucks exist only for validated clusters."""
    routes: dict[str, list[list[WarmStartVisit]]] = {}
    for truck in summary["trucks"]:
        routes.setdefault(truck["cluster_id"], []).append(
            [
                WarmStartVisit(visit_id=v["visit_id"], location_id=v["location_id"], load=v["load"])
                for v in sorted(truck["visits"], key=lambda v: v["sequence"])
            ]
        )
    clusters = [
        WarmStartCluster(
            cluster_id=c["id"],
            status=c["status"],
            location_ids=c["location_ids"],
            routes=routes.get(c["id"], []) if c["status"] == "validated" else [],
        )
        for c in summary["clusters"]
    ]
    return WarmStartPlan(
        source=source, travel=travel_identity(summary["settings"]), clusters=clusters
    )


def match_cluster(
    plan: WarmStartPlan,
    travel: WarmStartTravel,
    solve_visits: list[str],
    locations: list[str],
    visits: dict[str, dict[str, Any]],
) -> tuple[WarmStartCluster | None, list[list[str]] | None, str | None, str | None]:
    """Rules 1–3 for one cluster: (source cluster, routes as visit IDs, skip reason, detail)."""
    if plan.travel != travel:
        return None, None, "travel_changed", "The source plan used different travel data."
    wanted = set(solve_visits)
    for cluster in plan.clusters:
        if cluster.status != "validated":
            continue
        planned = [v for route in cluster.routes for v in route]
        if {v.visit_id for v in planned} != wanted or len(planned) != len(wanted):
            continue
        changed = [
            v.visit_id
            for v in planned
            if v.location_id != visits[v.visit_id]["location_id"]
            or v.load != visits[v.visit_id]["load"]
        ]
        if changed:
            detail = f"{len(changed)} visit(s) changed load or location."
            return cluster, None, "demand_changed", detail
        return cluster, [[v.visit_id for v in route] for route in cluster.routes], None, None
    places = set(locations)
    same_places = next(
        (c for c in plan.clusters if c.status != "validated" and set(c.location_ids) == places),
        None,
    )
    if same_places:
        return same_places, None, "source_invalid", "The source cluster has no validated plan."
    return None, None, "visit_set_changed", "No source cluster planned exactly these visits."


def plan_from_baseline(baseline: dict[str, Any], source: WarmStartSource) -> WarmStartPlan:
    """The plan of a saved manual baseline (spec §10): one cluster of the run it was made on, with
    the routes the author saved and the location and load of each visit as the evaluator recorded
    them. Only a baseline the evaluator found valid becomes a validated source cluster; any other
    is refused here (the web refuses it earlier), never offered as a start. The generic rules and
    the validator gate then judge it on the new problem exactly as they judge a run's plan."""
    if not baseline.get("valid"):
        raise ValueError("the baseline is invalid and cannot be a warm start")
    known = {v["visit_id"]: v for truck in baseline["trucks"] for v in truck["visits"]}
    routes = [
        [
            WarmStartVisit(
                visit_id=vid, location_id=known[vid]["location_id"], load=known[vid]["load"]
            )
            for vid in route
        ]
        for route in baseline["routes"]
    ]
    locations = sorted({v.location_id for route in routes for v in route})
    cluster = WarmStartCluster(
        cluster_id=baseline["cluster_id"],
        status="validated",
        location_ids=locations,
        routes=routes,
    )
    return WarmStartPlan(
        source=source, travel=travel_identity(baseline["settings"]), clusters=[cluster]
    )
