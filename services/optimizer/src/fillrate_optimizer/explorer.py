"""k explorer: clustering-only statistics over a k range and a seed list (spec §8a, §9).

No allocation changes and no PyVRP. For each k it fits every seed and reports the
unweighted feature-space squared-error sum (inertia), raw/effective cluster counts,
diameter-repair counts and stability (mean pairwise adjusted Rand index between
seeds). For the selected k it reports each location's **seed agreement**: its mean
co-assignment with the other locations in its reference-seed cluster. These are
descriptive statistics, not solver objectives or probabilities of correctness.

Statistics are location-level and computed before visit-level size splits; raw
and diameter-repaired variants use the same location population across seeds.
Co-assignment is computed per location against its reference peers, never as a
dense all-pairs matrix.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations

import numpy as np
from sklearn.metrics import adjusted_rand_score

from .clustering import Clusterer

DEFAULT_SEEDS = tuple(range(10))
DEFAULT_MAX_TASKS = 20


class ExplorerError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class KStats:
    k: int
    inertia_by_seed: list[float]
    raw_cluster_count: int  # reference seed
    effective_cluster_count: int  # reference seed, after diameter repair
    diameter_repairs_by_seed: list[int]
    stability_raw: float | None  # mean pairwise ARI; None with fewer than two seeds
    stability_repaired: float | None


@dataclass
class LocationAgreement:
    location_id: str
    reference_cluster: int
    agreement_raw: float | None  # None for a singleton reference cluster (no peers)
    agreement_repaired: float | None


@dataclass
class ExplorerResult:
    ks: list[int]
    seeds: list[int]
    reference_seed: int
    selected_k: int
    tasks: int
    fits: int
    per_k: list[KStats]
    locations: list[LocationAgreement]


def default_ks(selected_k: int | None, distinct: int) -> list[int]:
    """Two valid candidates near the selected k, or 1 and 2 (spec §9)."""
    if selected_k is None:
        return [k for k in (1, 2) if k <= distinct]
    near = [selected_k, selected_k + 1] if selected_k < distinct else [selected_k - 1, selected_k]
    return [k for k in near if 1 <= k <= distinct]


def labels_for(ids: list[str], groups: list[list[str]]) -> np.ndarray:
    index = {id_: i for i, id_ in enumerate(ids)}
    labels = np.empty(len(ids), dtype=np.int64)
    for label, group in enumerate(groups):
        for member in group:
            labels[index[member]] = label
    return labels


def inertia(features: np.ndarray, labels: np.ndarray) -> float:
    total = 0.0
    for label in np.unique(labels):
        rows = features[labels == label]
        total += float(((rows - rows.mean(axis=0)) ** 2).sum())
    return total


def stability(labelings: list[np.ndarray]) -> float | None:
    """Mean pairwise ARI. ARI can be negative; it is not clipped."""
    if len(labelings) < 2:
        return None
    scores = [adjusted_rand_score(a, b) for a, b in combinations(labelings, 2)]
    return float(np.mean(scores))


def agreement(reference: np.ndarray, labelings: list[np.ndarray]) -> list[float | None]:
    """Per location: mean over seeds of the share of its reference peers that share its label."""
    stacked = np.stack(labelings)  # seeds × locations
    out: list[float | None] = []
    for i, label in enumerate(reference):
        peers = np.flatnonzero(reference == label)
        peers = peers[peers != i]
        if peers.size == 0:
            out.append(None)
            continue
        together = stacked[:, peers] == stacked[:, [i]]
        out.append(float(together.mean()))
    return out


def explore(
    ids: list[str],
    lat_lon: np.ndarray,
    *,
    circuity: float,
    max_diameter_m: int | None,
    ks: list[int] | None = None,
    seeds: list[int] | None = None,
    selected_k: int | None = None,
    reference_seed: int = 0,
    n_init: int = 10,
    max_tasks: int = DEFAULT_MAX_TASKS,
    extra_tasks: int = 0,
) -> ExplorerResult:
    seeds = list(DEFAULT_SEEDS if seeds is None else seeds)
    if not ids:
        raise ExplorerError("empty", "No eligible locations to cluster.")
    if not seeds or len(set(seeds)) != len(seeds):
        raise ExplorerError("bad_seeds", "Seeds must be a non-empty list without duplicates.")
    if reference_seed not in seeds:
        raise ExplorerError(
            "bad_seeds", f"Reference seed {reference_seed} is not in the seed list."
        )
    probe = Clusterer(
        ids, lat_lon, {}, circuity=circuity, max_diameter_m=None, max_stops=0, seed=0, n_init=1
    )
    distinct = probe.distinct(list(ids))
    ks = sorted(set(default_ks(selected_k, distinct) if ks is None else ks))
    if not ks:
        raise ExplorerError("bad_k", "No valid k candidates.")
    if ks[0] < 1 or ks[-1] > distinct:
        raise ExplorerError(
            "bad_k", f"k must be between 1 and the {distinct} distinct locations; got {ks}."
        )
    selected = selected_k if selected_k is not None else ks[0]
    if selected not in ks:
        raise ExplorerError("bad_k", f"Selected k={selected} is not in the explored range {ks}.")
    tasks = len(ks) * len(seeds) + extra_tasks
    if tasks > max_tasks:
        extra = f" plus {extra_tasks} H3 resolution(s)" if extra_tasks else ""
        raise ExplorerError(
            "too_many_tasks",
            f"{len(ks)} k values × {len(seeds)} seeds{extra} is {tasks} clustering tasks; the "
            f"limit is {max_tasks}. Choose fewer k values, seeds or resolutions, or raise the "
            "deployment allowance.",
        )

    # Size repair is a separate, visit-level diagnostic: disable it here (max_stops unbounded).
    no_size_limit = len(ids) + 1
    visits = {id_: 1 for id_ in ids}
    per_k: list[KStats] = []
    locations: list[LocationAgreement] = []
    fits = 0
    for k in ks:
        raw_labels: list[np.ndarray] = []
        repaired_labels: list[np.ndarray] = []
        inertias: list[float] = []
        repairs: list[int] = []
        ref_raw = ref_final = None
        for seed in seeds:
            clusterer = Clusterer(
                ids,
                lat_lon,
                visits,
                circuity=circuity,
                max_diameter_m=max_diameter_m,
                max_stops=no_size_limit,
                seed=seed,
                n_init=n_init,
            )
            result = clusterer.run(k, auto_cap=k)
            fits += clusterer.fits
            raw = labels_for(ids, result.raw)
            final = labels_for(ids, result.partitions)
            raw_labels.append(raw)
            repaired_labels.append(final)
            inertias.append(inertia(clusterer.features, raw))
            repairs.append(sum(1 for step in result.repairs if step.reason == "diameter"))
            if seed == reference_seed:
                ref_raw, ref_final = result.raw, result.partitions
        assert ref_raw is not None and ref_final is not None
        per_k.append(
            KStats(
                k=k,
                inertia_by_seed=inertias,
                raw_cluster_count=len(ref_raw),
                effective_cluster_count=len(ref_final),
                diameter_repairs_by_seed=repairs,
                stability_raw=stability(raw_labels),
                stability_repaired=stability(repaired_labels),
            )
        )
        if k == selected:
            ref_index = seeds.index(reference_seed)
            raw_agree = agreement(raw_labels[ref_index], raw_labels)
            rep_agree = agreement(repaired_labels[ref_index], repaired_labels)
            locations = [
                LocationAgreement(id_, int(raw_labels[ref_index][i]), raw_agree[i], rep_agree[i])
                for i, id_ in enumerate(ids)
            ]
    return ExplorerResult(ks, seeds, reference_seed, selected, tasks, fits, per_k, locations)


def h3_rows(
    ids: list[str],
    lat_lon: np.ndarray,
    resolutions: list[int],
    *,
    circuity: float,
    max_diameter_m: int | None,
    seed: int,
) -> list[dict]:
    """H3 resolutions beside the k range: the same feature-space squared-error sum and repair
    counts. Seed stability is not applicable (membership is deterministic)."""
    rows = []
    for resolution in sorted(set(resolutions)):
        clusterer = Clusterer(
            ids,
            lat_lon,
            {id_: 1 for id_ in ids},
            circuity=circuity,
            max_diameter_m=max_diameter_m,
            max_stops=len(ids) + 1,
            seed=seed,
            n_init=1,
        )
        result = clusterer.run_h3(resolution)
        rows.append(
            {
                "resolution": resolution,
                "raw_cluster_count": len(result.raw),
                "effective_cluster_count": len(result.partitions),
                "inertia": inertia(clusterer.features, labels_for(ids, result.raw)),
                "diameter_repairs": sum(1 for s in result.repairs if s.reason == "diameter"),
            }
        )
    return rows


def run_explorer(scenario, settings, *, max_tasks: int = DEFAULT_MAX_TASKS, progress=None):
    """The durable explorer job (spec §8a, §9): clustering only, over the locations a pipeline
    run with `settings.base` would cluster."""
    from .model import (
        ExplorerH3,
        ExplorerK,
        ExplorerLocation,
        ExplorerSummary,
    )
    from .pipeline import allocated_locations, versions

    report = progress or (lambda stage, detail: None)
    base = settings.base
    report("population", {})
    locations = {loc.id: loc for loc in scenario.locations}
    ids = allocated_locations(scenario, base)
    lat_lon = np.array([[locations[i].lat, locations[i].lon] for i in ids], dtype=float)
    report("explore", {"tasks": None})
    result = explore(
        ids,
        lat_lon,
        circuity=base.cluster_circuity,
        max_diameter_m=base.max_cluster_diameter_m,
        ks=settings.ks,
        seeds=settings.seeds,
        selected_k=settings.selected_k,
        reference_seed=settings.reference_seed,
        n_init=base.kmeans_n_init,
        max_tasks=max_tasks,
        extra_tasks=len(set(settings.h3_resolutions)),
    )
    h3 = h3_rows(
        ids,
        lat_lon,
        settings.h3_resolutions,
        circuity=base.cluster_circuity,
        max_diameter_m=base.max_cluster_diameter_m,
        seed=base.kmeans_seed,
    )
    position = {id_: i for i, id_ in enumerate(ids)}
    return ExplorerSummary(
        scenario_name=scenario.name,
        settings=settings,
        ks=result.ks,
        seeds=result.seeds,
        reference_seed=result.reference_seed,
        selected_k=result.selected_k,
        tasks=result.tasks,
        max_tasks=max_tasks,
        fits=result.fits,
        locations_clustered=len(ids),
        per_k=[
            ExplorerK(
                k=row.k,
                inertia_by_seed=row.inertia_by_seed,
                inertia_mean=float(np.mean(row.inertia_by_seed)),
                raw_cluster_count=row.raw_cluster_count,
                effective_cluster_count=row.effective_cluster_count,
                diameter_repairs_by_seed=row.diameter_repairs_by_seed,
                stability_raw=row.stability_raw,
                stability_repaired=row.stability_repaired,
            )
            for row in result.per_k
        ],
        h3=[ExplorerH3(**row) for row in h3],
        locations=[
            ExplorerLocation(
                id=loc.location_id,
                lat=float(lat_lon[position[loc.location_id]][0]),
                lon=float(lat_lon[position[loc.location_id]][1]),
                reference_cluster=loc.reference_cluster,
                agreement_raw=loc.agreement_raw,
                agreement_repaired=loc.agreement_repaired,
            )
            for loc in result.locations
        ],
        depot=scenario.depot,
        versions=versions(),
    )
