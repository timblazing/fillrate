"""Canonical JSON matching `canonical()` in packages/db (sorted keys, array order kept).

Artifact hashes are computed on both sides of the worker boundary, so numbers
must serialize exactly like JavaScript's `JSON.stringify`: integral floats drop
the ".0", and exponents follow ECMAScript Number::toString.
"""

from __future__ import annotations

import hashlib
import json
import math
from decimal import Decimal
from typing import Any

MAX_SAFE_INTEGER = 2**53 - 1


def js_number(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError("invalid_json: non-finite number")
    if value == 0:
        return "0"
    # Fast path for the range where Python's shortest repr and ECMAScript agree (plain decimal
    # notation). Large matrices hash millions of numbers; the Decimal path is exact but slow.
    magnitude = abs(value)
    if 1e-4 <= magnitude < 1e16:
        return str(int(value)) if value.is_integer() else repr(value)
    return js_number_exact(value)


def js_number_exact(value: float) -> str:
    sign, digits, exponent = Decimal(repr(value)).normalize().as_tuple()
    s = "".join(map(str, digits))
    k = len(s)
    n = k + exponent  # decimal point position, as in ECMAScript Number::toString
    if k <= n <= 21:
        text = s + "0" * (n - k)
    elif 0 < n <= 21:
        text = f"{s[:n]}.{s[n:]}"
    elif -6 < n <= 0:
        text = "0." + "0" * -n + s
    else:
        e = n - 1
        mantissa = s if k == 1 else f"{s[0]}.{s[1:]}"
        text = f"{mantissa}e{'+' if e > 0 else '-'}{abs(e)}"
    return ("-" if sign else "") + text


def canonical(value: Any) -> str:
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise ValueError("invalid_json: unsafe integer")
        return str(value)
    if isinstance(value, float):
        if value.is_integer() and abs(value) > MAX_SAFE_INTEGER:
            raise ValueError("invalid_json: unsafe integer")
        return js_number(value)
    if isinstance(value, list | tuple):
        return "[" + ",".join(canonical(v) for v in value) + "]"
    if isinstance(value, dict):
        for key in value:
            if not isinstance(key, str):
                raise ValueError("invalid_json: non-string key")
        # JS sorts by UTF-16 code units; keys here are ASCII identifiers and IDs.
        return (
            "{"
            + ",".join(
                f"{json.dumps(k, ensure_ascii=False)}:{canonical(value[k])}" for k in sorted(value)
            )
            + "}"
        )
    raise ValueError(f"invalid_json: {type(value).__name__}")


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()
