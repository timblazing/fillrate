"""Checks behind a lab run's reproduction script (`GET /api/v1/lab/runs/<id>/export?format=python`).

The problem fingerprint and validated feasibility must always match. A run that stopped on its
iteration budget must also reproduce its objective and routes exactly (same pinned PyVRP, same
seed); a runtime-limited run depends on the machine, so only the first two are compared.
"""

from __future__ import annotations

from .schema import LabInstance
from .solve import run_lab


def differences(instance: dict, expected: dict) -> list[str]:
    result = run_lab(LabInstance.model_validate(instance))
    found: list[str] = []
    if result.problem_fingerprint != expected["problem_fingerprint"]:
        found.append("problem fingerprint differs: this is not the same problem")
    if result.validated_feasible != expected["validated_feasible"]:
        found.append(
            f"validated feasibility {result.validated_feasible} ≠ {expected['validated_feasible']}"
        )
    if expected.get("stopped_by") == "iterations":
        if result.objective.total != expected["objective_total"]:
            found.append(f"objective {result.objective.total} ≠ {expected['objective_total']}")
        routes = [
            {"vehicle_type": r.vehicle_type, "client_ids": [v.client_id for v in r.visits]}
            for r in result.routes
        ]
        if routes != expected["routes"]:
            found.append("routes differ")
    return found


def replay(instance: dict, expected: dict) -> int:
    found = differences(instance, expected)
    for line in found:
        print(f"DIFFERS: {line}")
    if not found:
        mode = (
            "objective and routes match"
            if expected.get("stopped_by") == "iterations"
            else "runtime-limited run: objective and routes not compared"
        )
        print(f"REPLAY OK ({mode})")
    return 1 if found else 0
