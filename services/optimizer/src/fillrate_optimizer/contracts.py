"""The versioned snapshot envelope that scenarios and run settings are stored in."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, JsonValue


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Snapshot(Contract):
    schema_version: Literal[1] = 1
    document: dict[str, JsonValue]


class ContractBundle(Contract):
    snapshot: Snapshot
