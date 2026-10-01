"""Bounded static Valhalla matrices; endpoints come only from deployment config.

Implements the verbose sources_to_targets response described at
https://valhalla.github.io/valhalla/api/matrix/ . Requests run sequentially,
and no snapshot is returned unless every source/target block is complete.
"""

from __future__ import annotations

import json
import math
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

import numpy as np

from .canonical import content_hash
from .travel import haversine_m
from .travel_provider import MAX_TRAVEL_VALUE, TravelNode, TravelSnapshot, validate_nodes

MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class ProviderError(ValueError):
    """Request failure, never a claim that a physical edge is unreachable."""


class ProviderCancelled(Exception):
    pass


class TransientProviderError(ProviderError):
    pass


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ProviderError("Valhalla redirects are not allowed")


def post_json(endpoint: str, body: dict, timeout: float) -> dict:
    request = Request(
        endpoint,
        data=json.dumps(body, allow_nan=False).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with build_opener(NoRedirects).open(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as error:
        kind = (
            TransientProviderError
            if error.code in (408, 429, 500, 502, 503, 504)
            else ProviderError
        )
        raise kind(f"Valhalla rejected matrix request (HTTP {error.code})") from error
    except (URLError, OSError, HTTPException) as error:
        raise TransientProviderError("Valhalla matrix request failed") from error
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ProviderError("Valhalla response exceeds the byte limit")
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as error:
        raise ProviderError("Valhalla returned invalid JSON") from error
    if not isinstance(result, dict):
        raise ProviderError("Valhalla returned a non-object response")
    return result


@dataclass(frozen=True)
class ValhallaConfig:
    url: str
    provider_version: str
    dataset_revision: str
    graph_config_hash: str
    # Resolved defaults from the pinned deployment, not defaults guessed by this client.
    costing_options: dict
    costing: str = "truck"
    block_size: int = 50
    max_pairs: int = 2500
    max_locations: int = 100
    max_matrix_distance_m: float = 400_000
    timeout_s: float = 15
    total_timeout_s: float = 300
    retries: int = 2

    def __post_init__(self):
        parsed = urlsplit(self.url)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "VALHALLA_URL must be an HTTP(S) deployment endpoint without credentials"
            )
        if any(
            not isinstance(value, str) or not 1 <= len(value) <= 200
            for value in (
                self.provider_version,
                self.dataset_revision,
                self.graph_config_hash,
                self.costing,
            )
        ):
            raise ValueError("Valhalla requires version, dataset, graph/config hash and costing")
        for name in ("block_size", "max_pairs", "max_locations"):
            value = getattr(self, name)
            if type(value) is not int or value < 1:
                raise ValueError(f"{name} must be a positive integer")
        if self.max_locations < 2 or type(self.retries) is not int or not 0 <= self.retries <= 5:
            raise ValueError("invalid Valhalla location/retry limits")
        for value in (self.timeout_s, self.total_timeout_s, self.max_matrix_distance_m):
            if not math.isfinite(value) or value <= 0:
                raise ValueError("Valhalla time and distance limits must be finite and positive")
        if self.timeout_s > 60 or self.total_timeout_s > 600:
            raise ValueError("Valhalla timeout exceeds the pipeline hard limit")
        if not isinstance(self.costing_options, dict):
            raise ValueError("Valhalla costing options must be an object")
        content_hash(self.costing_options)

    @classmethod
    def from_env(cls) -> ValhallaConfig:
        url = os.environ.get("VALHALLA_URL")
        if not url:
            raise ProviderError("Valhalla is unconfigured: set VALHALLA_URL")
        try:
            return cls(
                url=url,
                provider_version=os.environ["VALHALLA_VERSION"],
                dataset_revision=os.environ["VALHALLA_DATASET_REVISION"],
                graph_config_hash=os.environ["VALHALLA_GRAPH_CONFIG_HASH"],
                costing_options=json.loads(os.environ["VALHALLA_COSTING_OPTIONS"]),
                block_size=int(os.environ.get("VALHALLA_BLOCK_SIZE", "50")),
                max_pairs=int(os.environ.get("VALHALLA_MAX_MATRIX_PAIRS", "2500")),
                max_locations=int(os.environ.get("VALHALLA_MAX_MATRIX_LOCATIONS", "100")),
                max_matrix_distance_m=float(
                    os.environ.get("VALHALLA_MAX_MATRIX_DISTANCE_M", "400000")
                ),
            )
        except (KeyError, ValueError) as error:
            raise ProviderError(
                "Valhalla deployment metadata or limits are missing/invalid"
            ) from error


class ValhallaTravel:
    def __init__(
        self,
        config: ValhallaConfig,
        *,
        transport: Callable = post_json,
        clock: Callable = time.monotonic,
        sleep: Callable = time.sleep,
    ):
        self.config = config
        self.transport = transport
        self.clock = clock
        self.sleep = sleep

    def matrix(self, nodes: list[TravelNode], *, progress=None, check_cancelled=None):
        validate_nodes(nodes)
        config = self.config
        deadline = self.clock() + config.total_timeout_s

        def check():
            if check_cancelled:
                check_cancelled()
            if self.clock() >= deadline:
                raise ProviderError("Valhalla matrix exceeded its total time limit")

        check()
        spatial = haversine_m(np.array([(node.lat, node.lon) for node in nodes]))
        if spatial.max() > config.max_matrix_distance_m:
            raise ProviderError(
                "Point extent exceeds deployed max_matrix_distance; raise the provider limit. "
                "This request limit does not prove route unreachability."
            )
        size = min(config.block_size, math.isqrt(config.max_pairs), config.max_locations // 2)
        n = len(nodes)
        starts = range(0, n, size)
        total = len(starts) ** 2
        distances = [[None] * n for _ in nodes]
        durations = [[None] * n for _ in nodes]
        warnings = []
        algorithms = set()
        completed = 0
        if progress:
            progress(0, total)
        for source in starts:
            sources = nodes[source : source + size]
            for target in starts:
                targets = nodes[target : target + size]
                body = {
                    "sources": [{"lat": node.lat, "lon": node.lon} for node in sources],
                    "targets": [{"lat": node.lat, "lon": node.lon} for node in targets],
                    "costing": config.costing,
                    "costing_options": {config.costing: config.costing_options},
                    "units": "kilometers",
                    "verbose": True,
                }
                for attempt in range(config.retries + 1):
                    check()
                    try:
                        result = self.transport(
                            config.url.rstrip("/") + "/sources_to_targets",
                            body,
                            min(config.timeout_s, deadline - self.clock()),
                        )
                        break
                    except TransientProviderError:
                        if attempt == config.retries:
                            raise
                        # Short intervals let cooperative cancellation interrupt retry backoff.
                        for _ in range(2**attempt):
                            check()
                            self.sleep(min(0.25, max(0, deadline - self.clock())))
                check()
                if result.get("error") or result.get("error_code"):
                    raise ProviderError("Valhalla rejected matrix request")
                if result.get("units") != "kilometers":
                    raise ProviderError("Valhalla response units differ from requested kilometers")
                rows = result.get("sources_to_targets")
                if not isinstance(rows, list):
                    raise ProviderError("Valhalla matrix has no verbose source/target rows")
                pairs = set()
                for row in rows:
                    if not isinstance(row, list):
                        raise ProviderError("Valhalla matrix row is invalid")
                    for entry in row:
                        if not isinstance(entry, dict):
                            raise ProviderError("Valhalla matrix entry is invalid")
                        i, j = entry.get("from_index"), entry.get("to_index")
                        if (
                            type(i) is not int
                            or type(j) is not int
                            or not 0 <= i < len(sources)
                            or not 0 <= j < len(targets)
                            or (i, j) in pairs
                        ):
                            raise ProviderError(
                                "Valhalla matrix contains invalid/duplicate indices"
                            )
                        pairs.add((i, j))
                        if "distance" not in entry or "time" not in entry:
                            raise ProviderError("Valhalla matrix entry lacks distance/time")
                        d, t = entry["distance"], entry["time"]
                        if (d is None) != (t is None) or any(
                            value is not None
                            and (
                                type(value) not in (int, float)
                                or not math.isfinite(value)
                                or not 0 <= value <= MAX_TRAVEL_VALUE
                            )
                            for value in (d, t)
                        ):
                            raise ProviderError("Valhalla matrix distance/time is invalid")
                        if source + i == target + j and (d != 0 or t != 0):
                            raise ProviderError("Valhalla matrix diagonal must be zero")
                        distances[source + i][target + j] = entry["distance"]
                        durations[source + i][target + j] = entry["time"]
                if len(pairs) != len(sources) * len(targets):
                    raise ProviderError("Valhalla matrix block is incomplete")
                algorithm = result.get("algorithm")
                if not isinstance(algorithm, str) or not algorithm:
                    raise ProviderError("Valhalla matrix algorithm is missing")
                algorithms.add(algorithm)
                block_warnings = result.get("warnings", [])
                if not isinstance(block_warnings, list) or any(
                    not isinstance(warning, dict) for warning in block_warnings
                ):
                    raise ProviderError("Valhalla matrix warnings are malformed")
                warnings.extend(block_warnings)
                completed += 1
                if progress:
                    progress(completed, total)
        check()
        try:
            return TravelSnapshot(
                nodes=nodes,
                provider="valhalla",
                provider_version=config.provider_version,
                dataset_revision=config.dataset_revision,
                profile=config.costing,
                options={
                    "costing_options": config.costing_options,
                    "graph_config_hash": config.graph_config_hash,
                    "algorithms": sorted(algorithms),
                },
                distance_units="kilometers",
                duration_units="seconds",
                distances=distances,
                durations=durations,
                warnings=warnings,
            )
        except ValueError as error:
            raise ProviderError("Valhalla returned an invalid travel matrix") from error
