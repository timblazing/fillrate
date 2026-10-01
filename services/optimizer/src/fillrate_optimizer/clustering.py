"""k-means clustering of location groups with solve-size and optional diameter repair (§8a).

Features are 3D unit vectors from latitude/longitude, one equally weighted
observation per location. k-means minimizes squared chord distance in feature
space; it is not spherical k-means or a road-mile objective. Diameter uses the
symmetric spatial metric (haversine × cluster circuity), independent of the
directed travel matrix used for legs.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import h3
import numpy as np
from sklearn.cluster import KMeans

from .travel import haversine_m

MAX_REPAIR_STEPS_PER_LOCATION = 4


def unit_vectors(lat_lon: np.ndarray) -> np.ndarray:
    rad = np.radians(np.asarray(lat_lon, dtype=float).reshape(-1, 2))
    lat, lon = rad[:, 0], rad[:, 1]
    return np.column_stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])


def spatial_matrix_m(lat_lon: np.ndarray, circuity: float) -> np.ndarray:
    return np.rint(haversine_m(lat_lon) * circuity).astype(np.int64)


def centroid(lat_lon: np.ndarray) -> tuple[float, float] | None:
    """Normalized mean unit vector; None when the mean is degenerate (antipodal points)."""
    mean = unit_vectors(lat_lon).mean(axis=0)
    norm = float(np.linalg.norm(mean))
    if norm < 1e-12:
        return None
    x, y, z = mean / norm
    return float(np.degrees(np.arcsin(np.clip(z, -1, 1)))), float(np.degrees(np.arctan2(y, x)))


@dataclass
class RepairStep:
    reason: str  # diameter | solve_size | degenerate_size
    detail: str


@dataclass
class ClusterResult:
    partitions: list[list[str]]  # final location-id groups, canonical order
    raw: list[list[str]]  # before repair, canonical order
    requested_k: int | None
    selected_k: int | None
    fits: int
    auto_limit_reached: bool
    repairs: list[RepairStep] = field(default_factory=list)


def canonical_groups(groups: list[list[str]]) -> list[list[str]]:
    """Labels come from sorted member IDs, not k-means label numbers."""
    return sorted((sorted(g) for g in groups if g), key=lambda g: g[0])


class Clusterer:
    def __init__(
        self,
        ids: list[str],
        lat_lon: np.ndarray,
        visits: dict[str, int],
        *,
        circuity: float,
        max_diameter_m: int | None,
        max_stops: int,
        seed: int,
        n_init: int,
    ):
        self.ids = ids
        self.index = {id_: i for i, id_ in enumerate(ids)}
        self.lat_lon = np.asarray(lat_lon, dtype=float).reshape(-1, 2)
        self.features = unit_vectors(self.lat_lon)
        self.spatial = spatial_matrix_m(self.lat_lon, circuity)
        self.visits = visits
        self.max_diameter_m = max_diameter_m
        self.max_stops = max_stops
        self.seed = seed
        self.n_init = n_init
        self.fits = 0

    def distinct(self, members: list[str]) -> int:
        rows = self.features[[self.index[m] for m in members]]
        return len(np.unique(np.round(rows, 12), axis=0))

    def diameter(self, members: list[str]) -> int:
        idx = [self.index[m] for m in members]
        return int(self.spatial[np.ix_(idx, idx)].max()) if len(idx) > 1 else 0

    def size(self, members: list[str]) -> int:
        return sum(self.visits[m] for m in members)

    def fit(self, members: list[str], k: int) -> list[list[str]]:
        if k == 1 or len(members) == 1:
            return [list(members)]
        self.fits += 1
        model = KMeans(
            n_clusters=k,
            init="k-means++",
            n_init=self.n_init,
            random_state=self.seed,
            algorithm="lloyd",
            max_iter=300,
            tol=1e-4,
        )
        labels = model.fit_predict(self.features[[self.index[m] for m in members]])
        groups: dict[int, list[str]] = {}
        for member, label in zip(members, labels, strict=True):
            groups.setdefault(int(label), []).append(member)
        return list(groups.values())

    def too_wide(self, diameter: int) -> bool:
        """The diameter limit is an optional policy (spec v1.8 §1); None disables it."""
        return self.max_diameter_m is not None and diameter > self.max_diameter_m

    def passes(self, members: list[str]) -> bool:
        return not self.too_wide(self.diameter(members)) and self.size(members) <= self.max_stops

    def repair(self, groups: list[list[str]]) -> tuple[list[list[str]], list[RepairStep]]:
        """Deterministic bisection; every split strictly shrinks a partition."""
        steps: list[RepairStep] = []
        pending = canonical_groups(groups)
        done: list[list[str]] = []
        budget = MAX_REPAIR_STEPS_PER_LOCATION * max(1, len(self.ids))
        while pending:
            group = pending.pop(0)
            diameter, size = self.diameter(group), self.size(group)
            if (not self.too_wide(diameter) and size <= self.max_stops) or len(group) == 1:
                done.append(group)
                continue
            if budget == 0:
                reason = "diameter" if self.too_wide(diameter) else "solve_size"
                steps.append(RepairStep(reason, "Repair step limit reached; group kept."))
                done.append(group)
                continue
            budget -= 1
            reason = "diameter" if self.too_wide(diameter) else "solve_size"
            halves = self.fit(group, 2) if self.distinct(group) > 1 else [group]
            if len(halves) < 2:
                # Duplicate coordinates: stable-ID fallback, size repair only.
                ordered = sorted(group)
                halves = [ordered[: len(ordered) // 2], ordered[len(ordered) // 2 :]]
                reason = "degenerate_size"
            steps.append(
                RepairStep(
                    reason,
                    f"Split {len(group)} locations ({size} visits, widest pair "
                    f"{diameter / 1609.344:.0f} mi) into {len(halves[0])} + {len(halves[1])}.",
                )
            )
            pending = canonical_groups(pending + halves)
        return canonical_groups(done), steps

    def run(self, k: int | None, auto_cap: int) -> ClusterResult:
        members = list(self.ids)
        if not members:
            return ClusterResult([], [], k, None if k is None else 0, 0, False)
        distinct = self.distinct(members)
        if k is not None:
            if k > distinct:
                raise ValueError(
                    f"k={k} exceeds the {distinct} distinct locations; choose k ≤ {distinct}"
                )
            raw = self.fit(members, k)
            final, steps = self.repair(raw)
            return ClusterResult(final, canonical_groups(raw), k, None, self.fits, False, steps)
        cap = max(1, min(auto_cap, distinct))
        raw: list[list[str]] = []
        for candidate in range(1, cap + 1):
            raw = self.fit(members, candidate)
            if all(self.passes(g) for g in raw):
                return ClusterResult(
                    canonical_groups(raw), canonical_groups(raw), None, candidate, self.fits, False
                )
        final, steps = self.repair(raw)
        return ClusterResult(final, canonical_groups(raw), None, cap, self.fits, True, steps)

    def run_h3(self, resolution: int) -> ClusterResult:
        """H3 baseline (spec §8a): each non-empty cell is a cluster, then the same repair with this
        clusterer's seed as the recorded repair seed. Membership is deterministic for fixed
        coordinates, resolution and library version; it guarantees no capacity, connectivity or
        diameter."""
        cells: dict[str, list[str]] = {}
        for id_, (lat, lon) in zip(self.ids, self.lat_lon, strict=True):
            cells.setdefault(h3.latlng_to_cell(float(lat), float(lon), resolution), []).append(id_)
        raw = canonical_groups(list(cells.values()))
        final, steps = self.repair(raw)
        return ClusterResult(final, raw, None, None, self.fits, False, steps)

    def run_none(self) -> ClusterResult:
        """No-clustering baseline: one partition, no repair. The caller checks eligibility."""
        groups = [sorted(self.ids)] if self.ids else []
        return ClusterResult(groups, groups, None, None, 0, False)
