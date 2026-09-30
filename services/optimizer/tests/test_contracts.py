import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from fillrate_optimizer.contracts import ContractBundle, Lease, StageManifest

FIXTURE = Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/envelopes.json"


def test_shared_fixture_round_trip():
    document = json.loads(FIXTURE.read_text())
    assert json.loads(ContractBundle.model_validate(document).model_dump_json()) == document


def test_reject_malformed_manifest_and_fractional_attempt():
    document = json.loads(FIXTURE.read_text())
    with pytest.raises(ValidationError):
        StageManifest.model_validate({**document["manifest"], "output_hash": "bad"})
    with pytest.raises(ValidationError):
        Lease.model_validate({**document["event"]["lease"], "attempt": 1.2})
