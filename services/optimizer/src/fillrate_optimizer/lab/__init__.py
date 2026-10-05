"""Solver Lab: generic normalized routing instances solved by pinned PyVRP (spec §4, M6).

See docs/solver-lab.md for the schema, the builder/validator split and how later capabilities
(multiple depots, reloads, optional clients, client groups, paired shipments) plug in.
"""

from .schema import LabInstance, LabResult, PlannedCapabilityError
from .solve import LabError, problem_fingerprint, run_lab
from .validate import CandidateRoute, validate_plan

__all__ = [
    "CandidateRoute",
    "LabError",
    "LabInstance",
    "LabResult",
    "PlannedCapabilityError",
    "problem_fingerprint",
    "run_lab",
    "validate_plan",
]
