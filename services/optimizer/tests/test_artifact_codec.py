import pytest

from fillrate_optimizer.artifact_codec import decode_travel, encode_travel
from fillrate_optimizer.canonical import content_hash


def test_large_travel_matrix_uses_bounded_binary_encoding_and_round_trips():
    matrix = [[(i * 1103515245 + j * 12345) % 9000000 for j in range(500)] for i in range(500)]
    payload = {"clusters": [{"nodes": list(range(500)), "matrix": matrix}]}
    encoded = encode_travel(payload)
    assert encoded["encoding"] == "zlib-json-v1"
    assert len(encoded["data"]) < 8 * 1024 * 1024
    digest = content_hash(encoded)
    assert decode_travel(encoded) == payload
    assert content_hash(encoded) == digest


def test_small_travel_stays_plain_and_corrupt_binary_fails():
    assert decode_travel(encode_travel({"clusters": []})) == {"clusters": []}
    with pytest.raises(ValueError, match="corrupted"):
        decode_travel({"encoding": "zlib-json-v1", "raw_length": 2, "data": "eJwDAAAAAAE="})


def test_pipeline_stage_hashes_encoded_travel_and_reuses_decoded_matrix():
    import time
    import uuid

    from fillrate_optimizer.model import RunSettings
    from fillrate_optimizer.pipeline import Stages

    payload = {"clusters": [{"matrix": [[i * 500 + j for j in range(500)] for i in range(500)]}]}
    stages = Stages(RunSettings(), str(uuid.uuid4()), lambda: int(time.time() * 1000), "a" * 64)
    stages.add("travel", payload, [], [])
    artifact = stages.artifacts[0]
    assert artifact.payload["encoding"] == "zlib-json-v1"
    assert artifact.manifest["output_hash"] == content_hash(artifact.payload)
    reused = Stages(
        RunSettings(),
        str(uuid.uuid4()),
        lambda: int(time.time() * 1000),
        "a" * 64,
        cache=lambda _hash: {"manifest": artifact.manifest, "payload": artifact.payload},
    )
    assert reused.lookup("travel", [], []) == payload
