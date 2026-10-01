"""Versioned M1 persistence/worker envelopes; mathematical payloads evolve separately."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, JsonValue

Hash = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
PositiveInt = Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StageManifest(Contract):
    schema_version: Literal[1] = 1
    stage_type: Literal[
        "preflight",
        "allocation",
        "aggregation",
        "clustering",
        "travel",
        "problem",
        "solve",
        "validation",
        "summary",
        "explorer",
    ]
    input_hash: Hash
    output_hash: Hash
    producer_version: str = Field(min_length=1, max_length=200)
    adapter_version: str = Field(min_length=1, max_length=200)
    parent_hashes: list[Hash] = Field(max_length=1000)
    effective_settings: dict[str, JsonValue]
    created_at_ms: PositiveInt
    execution_id: UUID
    reused_from: UUID | None = None


class Lease(Contract):
    job_id: UUID
    worker_id: str = Field(min_length=1, max_length=200)
    lease_token: UUID
    attempt: PositiveInt


class WorkerEvent(Contract):
    lease: Lease
    sequence: PositiveInt
    kind: Literal["progress", "succeeded", "failed", "cancelled"]
    payload: dict[str, JsonValue]


class Snapshot(Contract):
    schema_version: Literal[1] = 1
    document: dict[str, JsonValue]


class ContractBundle(Contract):
    manifest: StageManifest
    event: WorkerEvent
    snapshot: Snapshot
