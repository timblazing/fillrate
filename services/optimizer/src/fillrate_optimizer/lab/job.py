"""Durable `lab` run kind (spec §9): the worker solves one lab instance in its child process.

The run's scenario version holds the instance; its settings document is ``{"kind": "lab"}``.
The result is one ``lab`` artifact (a ``LabResult``) committed with the succeeded event. The
instance is validated again here, independently of the web app's TypeScript checks.
"""

from __future__ import annotations

import time
from collections.abc import Callable

from pydantic import ValidationError

from ..canonical import content_hash
from .build import ADAPTER_VERSION
from .schema import LabInstance, PlannedCapabilityError
from .solve import LabError, run_lab

PRODUCER_VERSION = "fillrate-lab/1"


def parse_instance(document: dict) -> LabInstance:
    try:
        return LabInstance.model_validate(document)
    except PlannedCapabilityError as error:
        raise LabError("planned_capability", str(error)) from error
    except ValidationError as error:
        planned = next(
            (e for e in error.errors() if "planned capability" in str(e.get("msg", ""))), None
        )
        if planned:
            raise LabError("planned_capability", str(planned["msg"])) from error
        raise LabError("invalid_lab_instance", str(error)[:2000]) from error


def lab_job(
    document: dict, settings: dict, execution_id: str, progress: Callable[[dict], None]
) -> dict:
    instance = parse_instance(document)
    progress({"stage": "build", "clients": len(instance.clients)})
    result = run_lab(instance, progress=progress)
    payload = result.model_dump(mode="json")
    manifest = {
        "schema_version": 1,
        "stage_type": "lab",
        "input_hash": content_hash({"instance": document, "settings": settings}),
        "output_hash": content_hash(payload),
        "producer_version": PRODUCER_VERSION,
        "adapter_version": ADAPTER_VERSION,
        "parent_hashes": [],
        "effective_settings": instance.solver.model_dump(mode="json"),
        "created_at_ms": int(time.time() * 1000),
        "execution_id": execution_id,
        "reused_from": None,
    }
    return {
        "artifacts": [{"manifest": manifest, "payload": payload}],
        "summary": {
            "kind": "lab",
            "validated_feasible": result.validated_feasible,
            "solver_feasible": result.solver_feasible,
            "routes": result.totals.routes,
            "objective": result.objective.total,
            "problem_fingerprint": result.problem_fingerprint,
        },
    }
