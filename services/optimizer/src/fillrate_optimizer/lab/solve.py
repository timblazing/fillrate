"""Solve one lab instance with PyVRP and validate it independently (spec §9, §10).

The result keeps PyVRP's view (``solver_feasible``, its nominal cost and excess quantities) apart
from Fillrate's recomputation (``validated_feasible``, violations, objective breakdown). A solver
route whose reported distance, duration or load differs from the recomputation is flagged as a
violation: semantics must agree before any number is trusted.
"""

from __future__ import annotations

from collections.abc import Callable
from importlib.metadata import version

from pyvrp.stop import MaxIterations, MaxRuntime, MultipleCriteria

from ..canonical import content_hash
from .build import ADAPTER_VERSION, LabBuildError, build_lab_model
from .schema import LabInstance, LabResult, LabSolverInfo, LabUnits, LabViolation
from .travel import LabMatrices, lab_matrices
from .validate import CandidateRoute, preflight, validate_plan

OBJECTIVE_DEFINITION = (
    "pyvrp-0.14 nominal: sum over used vehicles of fixed_cost + unit_distance_cost × distance "
    "+ unit_duration_cost × duration; closed routes"
)


class LabError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def problem_fingerprint(instance: LabInstance, matrices: LabMatrices | None = None) -> str:
    """Identity of the mathematical problem (spec §10): visits, demands, fleet, raw matrices and
    objective definition. Names, labels, descriptions and solver settings are excluded."""
    matrices = matrices or lab_matrices(instance)
    return content_hash(
        {
            "schema": "fillrate.lab.problem/1",
            "coordinates": instance.coordinates,
            "dimensions": [{"id": d.id, "unit": d.unit} for d in instance.dimensions],
            "depots": [d.id for d in instance.depots],
            "clients": [
                {
                    "id": c.id,
                    "delivery": instance.delivery_vector(c),
                    "service_duration": c.service_duration,
                }
                for c in instance.clients
            ],
            "fleet": [
                {
                    # Depot assignment only enters with several depots, so single-depot
                    # fingerprints from before multiple depots stay valid.
                    **(
                        {
                            "start_depot": instance.start_depot_of(v),
                            "end_depot": instance.end_depot_of(v),
                        }
                        if len(instance.depots) > 1
                        else {}
                    ),
                    # Same for reloads: only types that reload add to the hashed document.
                    **(
                        {"reload_depots": v.reload_depots, "max_reloads": v.max_reloads or 0}
                        if v.reload_depots
                        else {}
                    ),
                    "id": v.id,
                    "count": v.count,
                    "capacity": instance.capacity_vector(v),
                    "fixed_cost": v.fixed_cost,
                    "unit_distance_cost": v.unit_distance_cost,
                    "unit_duration_cost": v.unit_duration_cost,
                    "max_distance": v.max_distance,
                    "shift_duration": v.shift_duration,
                }
                for v in instance.vehicle_types
            ],
            "matrix": matrices.identity(),
            "objective": OBJECTIVE_DEFINITION,
            "cost_unit": instance.cost_unit,
        }
    )


def run_lab(instance: LabInstance, progress: Callable[[dict], None] | None = None) -> LabResult:
    report = progress or (lambda _detail: None)
    matrices = lab_matrices(instance)
    findings = preflight(instance, matrices)
    if findings:
        raise LabError("preflight_blocked", "; ".join(findings[:10]))
    try:
        built = build_lab_model(instance, matrices)
    except LabBuildError as error:
        raise LabError(error.code, str(error)) from error

    settings = instance.solver
    stop = MaxRuntime(settings.max_runtime_s)
    if settings.max_iterations is not None:
        stop = MultipleCriteria([MaxIterations(settings.max_iterations), stop])
    report({"stage": "solve", "clients": len(instance.clients)})
    result = built.model.solve(stop, seed=settings.seed, display=False, collect_stats=False)
    best = result.best

    report({"stage": "validate"})
    dims = instance.dimension_ids()
    candidate, reported = [], []
    for route in best.routes():
        type_id = instance.vehicle_types[route.vehicle_type()].id
        # Trips are split at PyVRP's depot activities: the first and last are the route's start and
        # end depots, any in between are reloads.
        trips: list[list[str]] = [[]]
        reload_ids: list[str] = []
        activities = list(route)
        for position, a in enumerate(activities):
            if a.is_client():
                trips[-1].append(instance.clients[a.idx].id)
            elif 0 < position < len(activities) - 1:
                reload_ids.append(instance.depots[a.idx].id)
                trips.append([])
        # The depots PyVRP actually used, so a mismatch with the type's depots is caught.
        candidate.append(
            CandidateRoute(
                type_id,
                [],
                instance.depots[route.start_depot()].id,
                instance.depots[route.end_depot()].id,
                trips=trips,
                reload_depots=reload_ids,
            )
        )
        reported.append(route)
    plan = validate_plan(instance, matrices, candidate)

    # Cross-check the adapter: PyVRP's own route numbers must equal the recomputation.
    mismatches: list[LabViolation] = []
    for built_route, route in zip(plan.routes, reported, strict=True):
        pairs = [
            ("trips", len(built_route.trips), int(route.num_trips())),
            ("distance", built_route.distance, int(route.distance())),
            ("duration", built_route.duration, int(route.duration())),
            (
                "cost",
                built_route.cost,
                int(route.fixed_vehicle_cost() + route.distance_cost() + route.duration_cost()),
            ),
        ] + [
            (f"load {d}", built_route.load[d], int(route.delivery()[k])) for k, d in enumerate(dims)
        ]
        for what, ours, theirs in pairs:
            if ours != theirs:
                mismatches.append(
                    LabViolation(
                        code="solver_mismatch",
                        message=f"PyVRP reports {what} {theirs}; recomputed {ours}.",
                        route=built_route.index,
                        vehicle_type=built_route.vehicle_type,
                    )
                )

    iterations = int(result.num_iterations)
    stopped = (
        "iterations"
        if settings.max_iterations is not None and iterations >= settings.max_iterations
        else "runtime"
    )
    violations = plan.violations + mismatches
    return LabResult(
        instance_name=instance.name,
        coordinates=instance.coordinates,
        problem_fingerprint=problem_fingerprint(instance, matrices),
        units=LabUnits(
            distance=matrices.distance_unit,
            duration=matrices.duration_unit,
            cost=instance.cost_unit,
            dimensions={d.id: d.unit for d in instance.dimensions},
        ),
        solver_feasible=bool(result.is_feasible()),
        validated_feasible=not violations,
        violations=violations,
        objective=plan.objective,
        totals=plan.totals,
        fleet=plan.fleet,
        routes=plan.routes,
        solver=LabSolverInfo(
            version=version("pyvrp"),
            adapter_version=ADAPTER_VERSION,
            seed=settings.seed,
            max_iterations=settings.max_iterations,
            max_runtime_s=settings.max_runtime_s,
            iterations=iterations,
            runtime_s=round(float(result.runtime), 4),
            stopped_by=stopped,
            nominal_cost=int(
                best.fixed_vehicle_cost() + best.distance_cost() + best.duration_cost()
            ),
            excess_load={d: int(best.excess_load()[k]) for k, d in enumerate(dims)},
            excess_distance=int(best.excess_distance()),
            time_warp=int(best.time_warp()),
        ),
    )
