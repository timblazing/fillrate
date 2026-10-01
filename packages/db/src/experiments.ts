// M4 experiments (spec §8a "Iterations are experiments", §10): bounded sweep expansion, comparison
// signatures, Pareto marking and ranked options. Pure functions shared by the API, the screens and tests.
import { createHash } from "node:crypto";
import type { RunSettings, RunSummary } from "@fillrate/contracts";
import { canonical } from "./canonical";

export const METRICS_VERSION = "fillrate-metrics/1";
export const DEFAULT_MAX_SWEEP_RUNS = 25;

// ---- Sweeps ----------------------------------------------------------------------------------------

/** Sweep axes, the four the primary user varies first (k, seed, inventory, mileage), then "More" (spec §8a). */
export const SWEEP_AXES = ["k", "kmeans_seed", "inventory_percent", "travel_circuity", "max_leg_m", "solver_seed", "cluster_strategy", "h3_resolution", "allocation_strategy", "fulfillment_policy"] as const;
export type SweepAxis = (typeof SWEEP_AXES)[number];
export type SweepAxes = Partial<{ [A in SweepAxis]: RunSettings[A][] }>;
export type SweepRun = { settings: RunSettings; varied: Partial<RunSettings> };

export class SweepError extends Error {
  constructor(readonly code: "too_many_runs" | "invalid_axis" | "empty_sweep", message: string, readonly runs = 0) { super(message); }
}

/**
 * Cartesian product of the axes over `base`. Settings that do not apply to a clustering method are
 * normalized (k only for k-means, H3 resolution only for H3, neither for the no-clustering baseline)
 * and identical expansions are merged, so the preview count is the number of distinct runs. Never
 * truncates: more than `limit` runs is an error naming the count.
 */
export function expandSweep(base: RunSettings, axes: SweepAxes, limit = DEFAULT_MAX_SWEEP_RUNS): SweepRun[] {
  const used = SWEEP_AXES.filter(axis => axes[axis] !== undefined);
  for (const axis of Object.keys(axes)) if (!(SWEEP_AXES as readonly string[]).includes(axis)) throw new SweepError("invalid_axis", `Unknown sweep axis ${axis}.`);
  for (const axis of used) {
    const values = axes[axis]!;
    if (!Array.isArray(values) || values.length === 0 || values.length > 100) throw new SweepError("invalid_axis", `Axis ${axis} needs 1–100 values.`);
    if (new Set(values.map(v => canonical(v))).size !== values.length) throw new SweepError("invalid_axis", `Axis ${axis} repeats a value.`);
  }
  if (base.travel_snapshot_id && axes.travel_circuity !== undefined) throw new SweepError("invalid_axis", "Travel circuity does not apply when a travel snapshot is selected; its recorded legs are used.");
  const product = used.reduce((n, axis) => n * axes[axis]!.length, 1);
  if (product > 100_000) throw new SweepError("too_many_runs", `This sweep expands to ${product} runs; the limit is ${limit}.`, product);
  let combos: Partial<RunSettings>[] = [{}];
  for (const axis of used) combos = combos.flatMap(combo => axes[axis]!.map(value => ({ ...combo, [axis]: value })));
  const seen = new Map<string, SweepRun>();
  for (const varied of combos) {
    const settings = normalize({ ...base, ...varied } as RunSettings);
    const shown = Object.fromEntries(Object.entries(varied).filter(([axis]) => applies(axis as SweepAxis, settings))) as Partial<RunSettings>;
    const key = canonical(settings);
    if (!seen.has(key)) seen.set(key, { settings, varied: shown });
  }
  const runs = [...seen.values()];
  if (!runs.length) throw new SweepError("empty_sweep", "The sweep has no runs.");
  if (runs.length > limit) throw new SweepError("too_many_runs", `This sweep expands to ${runs.length} runs; the limit is ${limit}. Choose fewer values.`, runs.length);
  return runs;
}

function applies(axis: SweepAxis, settings: RunSettings) {
  if (axis === "k") return settings.cluster_strategy === "kmeans";
  if (axis === "h3_resolution") return settings.cluster_strategy === "h3";
  if (axis === "kmeans_seed") return settings.cluster_strategy !== "none";
  return true;
}

function normalize(settings: RunSettings): RunSettings {
  const out = { ...settings };
  if (out.cluster_strategy !== "kmeans") out.k = null;
  if (out.cluster_strategy !== "h3") out.h3_resolution = 2;
  if (out.cluster_strategy === "none") out.kmeans_seed = 0;
  // CP-SAT options mean nothing to the greedy strategies; reset them so equivalent runs merge.
  if (out.allocation_strategy !== "optimized") { out.allocation_objective = "revenue"; out.respect_order_date = false; out.allocation_time_limit_s = 10; }
  return out;
}

// ---- Comparison signature and cohorts --------------------------------------------------------------

/**
 * Runs compare automatically only within one cohort: same scenario version (demand), inventory
 * assumption, eligibility policy, units and metric definitions, and validation rules (leg limit,
 * capacity, circuity used to measure miles and tightness) and fulfillment policy. k, seeds, clustering
 * method and allocation strategy may vary.
 */
export function comparisonSignature(versionId: string, settings: RunSettings, versions: Record<string, string>) {
  const definition = {
    demand: versionId,
    inventory_percent: settings.inventory_percent,
    eligibility: { preflight: eligibilityPolicy(settings.preflight), excluded_line_ids: [...(settings.excluded_line_ids ?? [])].sort() },
    // Whole-order fulfillment is a business rule, so it forms its own cohort; the allocation strategy is
    // a decision method compared within one (like k). Added only when set, so piece-level signatures
    // from before M5 are unchanged.
    ...(settings.fulfillment_policy === "whole_order" ? { fulfillment: "whole_order" } : {}),
    units: { capacity: settings.trailer_capacity, distance: "m", money: "cents" },
    // A selected travel snapshot replaces the estimating circuity: its identity (a hash of its coordinates,
    // provider, dataset, profile, options and every raw value) is the travel assumption. Added only when
    // set, so signatures of estimated runs are unchanged.
    metrics: { version: METRICS_VERSION, travel_circuity: settings.travel_snapshot_id ? null : settings.travel_circuity, cluster_circuity: settings.cluster_circuity },
    ...(settings.travel_snapshot_id ? { travel: { snapshot: settings.travel_snapshot_id } } : {}),
    validation: { max_leg_m: settings.max_leg_m, max_cluster_diameter_m: settings.max_cluster_diameter_m, pipeline: versions.pipeline ?? null },
  };
  return { signature: createHash("sha256").update(canonical(definition)).digest("hex"), definition };
}

/** The approximate-coordinates policy (M5) appears only when it blocks, so earlier signatures are unchanged. */
function eligibilityPolicy(preflight: RunSettings["preflight"]) {
  const { approximate_coordinates, ...rest } = preflight ?? ({} as NonNullable<RunSettings["preflight"]>);
  return approximate_coordinates === "block" ? { ...rest, approximate_coordinates } : rest;
}

/** Which cohort-defining assumptions differ from `base` (shown as changed-assumption chips). */
export function changedAssumptions(base: RunSettings, settings: RunSettings) {
  const out: string[] = [];
  if (settings.inventory_percent !== base.inventory_percent) out.push(`Inventory ${settings.inventory_percent}%`);
  if ((settings.travel_snapshot_id ?? null) !== (base.travel_snapshot_id ?? null)) out.push(settings.travel_snapshot_id ? "Road travel snapshot" : "Estimated travel");
  else if (!settings.travel_snapshot_id && settings.travel_circuity !== base.travel_circuity) out.push(`Travel circuity ${settings.travel_circuity}`);
  if (settings.cluster_circuity !== base.cluster_circuity) out.push(`Cluster circuity ${settings.cluster_circuity}`);
  if (settings.max_leg_m !== base.max_leg_m) out.push(`Leg limit ${Math.round(settings.max_leg_m / 1609.344)} mi`);
  if (settings.max_cluster_diameter_m !== base.max_cluster_diameter_m) out.push("Diameter policy");
  if (settings.trailer_capacity !== base.trailer_capacity) out.push("Trailer capacity");
  if ((settings.fulfillment_policy ?? "piece") !== (base.fulfillment_policy ?? "piece")) out.push(settings.fulfillment_policy === "whole_order" ? "Whole orders only" : "Partial lines allowed");
  if (canonical(eligibilityPolicy(settings.preflight)) !== canonical(eligibilityPolicy(base.preflight)) || canonical(settings.excluded_line_ids ?? []) !== canonical(base.excluded_line_ids ?? [])) out.push("Eligibility");
  return out;
}

// ---- Metrics -----------------------------------------------------------------------------------------

export const METRICS = {
  planned_cents: { label: "Planned revenue", direction: "max", decimals: 0 },
  utilization: { label: "Fleet utilization", direction: "max", decimals: 4 },
  mean_centroid_m: { label: "Mean distance to centroid", direction: "min", decimals: 0 },
  trucks: { label: "Shipments", direction: "min", decimals: 0 },
  loaded_distance_m: { label: "Loaded miles", direction: "min", decimals: 0 },
  min_fill: { label: "Minimum trailer fill", direction: "max", decimals: 4 },
  max_diameter_m: { label: "Widest cluster", direction: "min", decimals: 0 },
} as const;
export type MetricKey = keyof typeof METRICS;
export type Metrics = Record<MetricKey, number | null>;
export const DEFAULT_VECTOR: MetricKey[] = ["planned_cents", "utilization", "mean_centroid_m"];

export function runMetrics(summary: RunSummary): Metrics {
  const located = summary.clusters.filter(c => c.location_ids.length > 0);
  const locations = located.reduce((n, c) => n + c.location_ids.length, 0);
  return {
    planned_cents: summary.totals.planned_cents,
    utilization: summary.totals.utilization ?? null,
    // One distance per location group (spec §8a), so split visits are not weighted twice.
    mean_centroid_m: locations ? located.reduce((n, c) => n + c.mean_centroid_distance_m * c.location_ids.length, 0) / locations : null,
    trucks: summary.totals.trucks,
    loaded_distance_m: summary.totals.loaded_distance_m,
    min_fill: summary.totals.min_fill ?? null,
    max_diameter_m: located.length ? Math.max(...located.map(c => c.diameter_m)) : null,
  };
}

const rounded = (key: MetricKey, value: number) => {
  const scale = 10 ** METRICS[key].decimals;
  return Math.round(value * scale) / scale;
};
/** -1 if a is better than b on `key`, 1 if worse, 0 if tied at the declared rounding. */
function better(key: MetricKey, a: number, b: number) {
  const x = rounded(key, a), y = rounded(key, b);
  if (x === y) return 0;
  return (METRICS[key].direction === "max" ? x > y : x < y) ? -1 : 1;
}

export function dominates(a: Metrics, b: Metrics, vector: MetricKey[]) {
  let strictly = false;
  for (const key of vector) {
    const order = better(key, a[key]!, b[key]!);
    if (order === 1) return false;
    if (order === -1) strictly = true;
  }
  return strictly;
}

// ---- Ranking -------------------------------------------------------------------------------------------

export type RankKey = "non_dominated" | MetricKey;
export type Comparison = { vector: MetricKey[]; order: RankKey[]; cohort?: string | null };
export const DEFAULT_COMPARISON: Comparison = { vector: DEFAULT_VECTOR, order: ["non_dominated", "planned_cents", "trucks", "loaded_distance_m"], cohort: null };
export const RANK_LABELS = ["Best option", "2nd best", "3rd"] as const;

export function parseComparison(input: unknown): Comparison {
  const value = (input ?? {}) as Partial<Comparison>;
  const keys = Object.keys(METRICS);
  const vector = value.vector ?? DEFAULT_COMPARISON.vector;
  const order = value.order ?? DEFAULT_COMPARISON.order;
  if (!Array.isArray(vector) || !vector.length || vector.length > keys.length || new Set(vector).size !== vector.length || vector.some(k => !keys.includes(k))) throw new SweepError("invalid_axis", "The comparison vector must list distinct metrics.");
  if (!Array.isArray(order) || !order.length || order.length > keys.length + 1 || new Set(order).size !== order.length || order.some(k => k !== "non_dominated" && !keys.includes(k))) throw new SweepError("invalid_axis", "The ranking order must list distinct metrics.");
  const cohort = value.cohort ?? null;
  if (cohort !== null && !/^[a-f0-9]{64}$/.test(cohort)) throw new SweepError("invalid_axis", "Unknown cohort.");
  return { vector, order, cohort };
}

export type CompareInput = { id: string; status: string; settings: RunSettings; versionId: string; summary: RunSummary | null; solveReused?: boolean };
export type CompareRow = {
  id: string; signature: string | null; metrics: Metrics | null;
  eligible: boolean; reason: string | null; nonDominated: boolean; rank: number | null; label: string | null;
};

/**
 * Marks the non-dominated runs and ranks the top three in one cohort by a visible lexicographic
 * order. Only succeeded, validated, complete plans with every compared metric defined take part;
 * invalid, partial, empty, unfinished, reused-solve and other-cohort runs are listed with a reason.
 * Ties at the declared rounding share a rank (1, 1, 3).
 */
export function compareRuns(inputs: CompareInput[], comparison: Comparison = DEFAULT_COMPARISON) {
  const rows: CompareRow[] = inputs.map(run => {
    const signature = run.summary ? comparisonSignature(run.versionId, run.settings, run.summary.versions).signature : null;
    const metrics = run.summary ? runMetrics(run.summary) : null;
    const reason = run.status !== "succeeded" ? `Run ${run.status}`
      : !run.summary ? "No summary"
      : run.summary.validity !== "valid" ? "Invalid plan"
      : run.summary.coverage !== "complete" ? `${run.summary.coverage === "partial" ? "Partial" : "Empty"} plan`
      : run.solveReused ? "Reused solve (not an independent replicate)"
      : [...comparison.vector, ...comparison.order].some(k => k !== "non_dominated" && metrics![k as MetricKey] === null) ? "Undefined metric"
      : null;
    return { id: run.id, signature, metrics, eligible: reason === null, reason, nonDominated: false, rank: null, label: null };
  });
  const counts = new Map<string, number>();
  for (const row of rows) if (row.eligible && row.signature) counts.set(row.signature, (counts.get(row.signature) ?? 0) + 1);
  const cohorts = [...counts.entries()].map(([signature, runs]) => ({ signature, runs }));
  // Default cohort: the largest eligible one; ties go to the cohort of the earliest listed run.
  const first = (sig: string) => rows.findIndex(r => r.signature === sig);
  const cohort = comparison.cohort && counts.has(comparison.cohort) ? comparison.cohort
    : cohorts.sort((a, b) => b.runs - a.runs || first(a.signature) - first(b.signature))[0]?.signature ?? null;
  const ranked = rows.filter(r => r.eligible && r.signature === cohort);
  for (const row of rows) if (row.eligible && row.signature !== cohort) { row.eligible = false; row.reason = "Different cohort (changed assumptions)"; }
  for (const row of ranked) row.nonDominated = !ranked.some(other => other !== row && dominates(other.metrics!, row.metrics!, comparison.vector));
  const compare = (a: CompareRow, b: CompareRow) => {
    for (const key of comparison.order) {
      const order = key === "non_dominated" ? Number(b.nonDominated) - Number(a.nonDominated) : better(key, a.metrics![key]!, b.metrics![key]!);
      if (order) return order;
    }
    return 0;
  };
  const sorted = [...ranked].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
  sorted.forEach((row, i) => {
    row.rank = i > 0 && compare(sorted[i - 1], row) === 0 ? sorted[i - 1].rank : i + 1;
    row.label = row.rank! <= 3 ? RANK_LABELS[row.rank! - 1] : null;
  });
  return { rows, cohort, cohorts: [...counts.entries()].map(([signature, runs]) => ({ signature, runs })), comparison: { ...comparison, cohort } as Comparison };
}
