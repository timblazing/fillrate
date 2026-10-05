"""Offline replay of an exported k explorer job (spec §8a, §9, §13; M7).

`replay.py` in an explorer bundle calls `main()` here, so the rules the bundle README states are
ordinary tested code. The bundle holds the scenario version, the recorded `ExplorerSettings` and
`expected.json` with the recorded explorer artifact; nothing here needs the network.

Semantics (see the bundle README):

* The explorer is recomputed from the scenario and settings with the recorded task allowance:
  the same location population, k range, seeds, reference seed and H3 resolutions.
* Every count, label and identifier must match exactly: the population and its coordinates, the
  k range and selection, task and fit counts, raw/effective cluster counts, diameter-repair
  counts, H3 cluster counts and each location's reference cluster.
* The floating-point statistics (inertia per seed and its mean, raw/repaired stability ARI,
  per-location seed agreement, H3 inertia) must match within `FLOAT_REL_TOL` / `FLOAT_ABS_TOL`.
  k-means with explicit seeds and `n_init` is bit-reproducible on the pinned versions and the
  same platform; across CPUs/BLAS builds the sums of squares may differ in the last bits. ARI and
  agreement are functions of the labels alone, so a real difference in any partition shows up as
  a changed count, cluster label or a statistic far outside the tolerance and fails the replay.
  The output says whether the replay is bit-identical to the recorded artifact or only within
  tolerance.
* The explorer clusters on the symmetric spatial metric (haversine × cluster circuity) and never
  reads a travel matrix: the web app refuses a travel snapshot for it. A bundle that declares any
  other travel provider, or settings naming a snapshot, is refused before anything is rerun.
* Version drift is reported; differences are still failures (the README says to replay on the
  pinned lock).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .canonical import content_hash
from .model import ExplorerSettings, ExplorerSummary, ScenarioDocument
from .pipeline import versions
from .replay import ESTIMATED_TRAVEL

FLOAT_REL_TOL = 1e-9
FLOAT_ABS_TOL = 1e-12
# Statistics computed in floating point; every other value is compared exactly.
FLOAT_FIELDS = frozenset(
    {
        "inertia_by_seed",
        "inertia_mean",
        "inertia",
        "stability_raw",
        "stability_repaired",
        "agreement_raw",
        "agreement_repaired",
    }
)
# Report sections, in output order, and the summary fields each one checks.
SECTIONS: dict[str, tuple[str, ...]] = {
    "population": ("scenario_name", "locations_clustered", "depot"),
    "selection": ("ks", "seeds", "reference_seed", "selected_k", "tasks", "max_tasks", "fits"),
    "settings": ("schema_version", "kind", "settings"),
    "per_k": ("per_k",),
    "h3": ("h3",),
    "locations": ("locations",),
}
# Provenance, not a result: drift is reported separately.
NOT_COMPARED = frozenset({"versions"})
SPATIAL_METRIC = "spatial"
SHOWN_DIFFERENCES = 5


def travel_record(settings: ExplorerSettings) -> dict[str, Any]:
    """The explorer's travel declaration: the spatial metric, never a matrix."""
    return {
        "provider": ESTIMATED_TRAVEL,
        "metric": SPATIAL_METRIC,
        "circuity": settings.base.cluster_circuity,
    }


def expected_record(
    run_id: str, summary: ExplorerSummary, output_hash: str | None = None
) -> dict[str, Any]:
    """The `expected.json` of a finished explorer job; the web export writes the same shape."""
    payload = summary.model_dump(mode="json")
    return {
        "kind": "explorer",
        "run_id": run_id,
        "output_hash": output_hash or content_hash(payload),
        "versions": summary.versions,
        "max_tasks": summary.max_tasks,
        "travel": travel_record(summary.settings),
        "summary": payload,
    }


def label(path: str, item: Any) -> str:
    """List entries are named by their key (k, resolution or location id), not their index."""
    if isinstance(item, dict):
        for key, name in (("k", "k"), ("resolution", "resolution"), ("id", "id")):
            if key in item and not isinstance(item[key], dict):
                return f"{path}[{name}={item[key]}]"
    return path


def differences(
    recorded: Any, replayed: Any, path: str, floating: bool = False
) -> list[tuple[str, Any, Any]]:
    """(path, recorded, replay) for every value that differs under the module's rules."""
    if isinstance(recorded, dict) and isinstance(replayed, dict):
        out = []
        for key in sorted(set(recorded) | set(replayed)):
            if key not in recorded or key not in replayed:
                out.append((f"{path}.{key}", recorded.get(key), replayed.get(key)))
                continue
            out += differences(recorded[key], replayed[key], f"{path}.{key}", key in FLOAT_FIELDS)
        return out
    if isinstance(recorded, list) and isinstance(replayed, list):
        if len(recorded) != len(replayed):
            return [(f"{path} length", len(recorded), len(replayed))]
        out = []
        for i, (a, b) in enumerate(zip(recorded, replayed, strict=True)):
            name = label(path, a)
            out += differences(a, b, name if name != path else f"{path}[{i}]", floating)
        return out
    numbers = all(
        isinstance(v, int | float) and not isinstance(v, bool) for v in (recorded, replayed)
    )
    if floating and numbers:
        same = math.isclose(recorded, replayed, rel_tol=FLOAT_REL_TOL, abs_tol=FLOAT_ABS_TOL)
    else:
        same = type(recorded) is type(replayed) or numbers
        same = same and recorded == replayed
    return [] if same else [(path, recorded, replayed)]


def recompute(
    scenario: ScenarioDocument, settings: ExplorerSettings, max_tasks: int
) -> ExplorerSummary:
    from .explorer import run_explorer

    return run_explorer(scenario, settings, max_tasks=max_tasks)


def replay(root: Path, *, out: Callable[[str], None] = print) -> list[str]:
    """Replay the explorer bundle in `root`; returns the failed checks (empty means REPLAY OK)."""
    expected = json.loads((root / "expected.json").read_text())
    if expected.get("kind") != "explorer":
        out("expected.json does not record a k explorer job")
        return ["kind"]
    travel = expected.get("travel") or {}
    provider, metric = travel.get("provider"), travel.get("metric")
    if provider != ESTIMATED_TRAVEL or metric != SPATIAL_METRIC:
        out(
            f"travel provider {provider!r} (metric {metric!r}) cannot be replayed by the k "
            "explorer; it clusters on the spatial metric only"
        )
        return ["travel_provider"]
    scenario = ScenarioDocument.model_validate(json.loads((root / "scenario.json").read_text()))
    settings = ExplorerSettings.model_validate(json.loads((root / "settings.json").read_text()))
    if settings.base.travel_snapshot_id:
        out("the settings select a travel snapshot; the k explorer never reads one")
        return ["travel_provider"]
    out(
        f"{'travel':<12} spatial metric (haversine × cluster circuity "
        f"{settings.base.cluster_circuity}); no matrix needed"
    )
    local = versions()
    drift = {
        k: (v, local.get(k)) for k, v in expected.get("versions", {}).items() if local.get(k) != v
    }
    if drift:
        out(f"note: versions differ from the recording: {drift}")

    recorded = expected["summary"]
    replayed = recompute(scenario, settings, int(expected["max_tasks"])).model_dump(mode="json")
    failures: list[str] = []
    for section, keys in SECTIONS.items():
        found = [d for key in keys for d in differences(recorded.get(key), replayed.get(key), key)]
        if section == "population":
            ids = [loc["id"] for loc in recorded.get("locations", [])]
            now = [loc["id"] for loc in replayed["locations"]]
            if ids != now:
                found.append(("location ids", f"{len(ids)} ids", f"{len(now)} ids, different"))
        if not found:
            out(f"{section:<12} reproduced")
            continue
        failures.append(section)
        for path, before, after in found[:SHOWN_DIFFERENCES]:
            out(f"{section:<12} DIFFERS: {path} recorded {before!r} replay {after!r}")
        if len(found) > SHOWN_DIFFERENCES:
            out(f"{section:<12} … and {len(found) - SHOWN_DIFFERENCES} more differences")
    unchecked = set(recorded) - NOT_COMPARED - {k for keys in SECTIONS.values() for k in keys}
    for key in sorted(unchecked):
        if differences(recorded[key], replayed.get(key), key):
            out(f"{key:<12} DIFFERS")
            failures.append(key)
    if content_hash(recorded) != expected.get("output_hash"):
        out("note: the recorded summary does not hash to the artifact's output_hash (edited?)")
    if not failures:
        exact = content_hash(replayed) == content_hash(recorded)
        out(
            f"{'explorer':<12} "
            + (
                "bit-identical to the recorded artifact"
                if exact
                else f"within tolerance (relative {FLOAT_REL_TOL:g}), not bit-identical"
            )
        )
    out("REPLAY OK" if not failures else f"REPLAY FAILED: {', '.join(failures)}")
    return failures


def main(argv: list[str] | None = None, root: Path | None = None) -> int:
    parser = argparse.ArgumentParser(description="Replay a Fillrate k explorer bundle.")
    parser.parse_args(argv)
    return 1 if replay(root or Path.cwd()) else 0


if __name__ == "__main__":
    sys.exit(main())
