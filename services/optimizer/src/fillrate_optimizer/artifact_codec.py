"""Bounded binary encoding for large deterministic travel artifacts.

The stage manifest hashes the encoded payload, so Node verifies the exact
bytes it persists. Decoding happens only after the manifest hash is checked.
"""

from __future__ import annotations

import base64
import json
import zlib
from typing import Any

from .canonical import canonical

TRAVEL_ENCODE_AT = 1_000_000
TRAVEL_MAX_DECODED = 64 * 1024 * 1024
ENCODING = "zlib-json-v1"


def encode_travel(payload: dict[str, Any]) -> dict[str, Any]:
    raw = canonical(payload).encode("utf-8")
    if len(raw) <= TRAVEL_ENCODE_AT:
        return payload
    if len(raw) > TRAVEL_MAX_DECODED:
        raise ValueError("travel artifact exceeds the 64 MiB decoded limit")
    return {
        "encoding": ENCODING,
        "raw_length": len(raw),
        "data": base64.b64encode(zlib.compress(raw, level=6)).decode("ascii"),
    }


def decode_travel(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("encoding") != ENCODING:
        return payload
    if set(payload) != {"encoding", "raw_length", "data"}:
        raise ValueError("invalid encoded travel artifact")
    length = payload["raw_length"]
    if not isinstance(length, int) or not 0 < length <= TRAVEL_MAX_DECODED:
        raise ValueError("invalid encoded travel length")
    compressed = base64.b64decode(payload["data"], validate=True)
    decoder = zlib.decompressobj()
    raw = decoder.decompress(compressed, TRAVEL_MAX_DECODED + 1)
    if len(raw) != length or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError("travel artifact corrupted or too large")
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("invalid travel artifact payload")
    return result
