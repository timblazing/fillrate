import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from fillrate_optimizer.contracts import ContractBundle, Snapshot

FIXTURE = Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/envelopes.json"


def test_shared_fixture_round_trip():
    document = json.loads(FIXTURE.read_text())
    assert json.loads(ContractBundle.model_validate(document).model_dump_json()) == document


def test_reject_unknown_schema_version():
    document = json.loads(FIXTURE.read_text())
    with pytest.raises(ValidationError):
        Snapshot.model_validate({**document["snapshot"], "schema_version": 2})
