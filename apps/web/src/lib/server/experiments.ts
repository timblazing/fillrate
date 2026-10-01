import "server-only";
import { parseContract, type ExplorerSettings, type RunSettings, type Snapshot } from "@fillrate/contracts";
import type { Store } from "@fillrate/db";
import { canonical } from "@fillrate/db/canonical";
import { changedAssumptions, compareRuns, DEFAULT_COMPARISON, expandSweep, METRICS, parseComparison, SWEEP_AXES, SweepError, type SweepAxes } from "@fillrate/db/experiments";
import { preflightChecks } from "@fillrate/db/preflight";
import { validateScenario } from "@fillrate/db/scenarios";
import { ApiError, assertQueueRoom, authorizeSyntheticRun, exampleForVersion, exampleSettings, exampleVersion, maxSweepRuns, parseExample, runSummary, type Example } from "./runs";
import { assertScenarioAccess } from "./scenarios";

export const isImportedVersion = (store: Store, versionId: string) =>
  Boolean(store.sqlite.prepare("SELECT 1 FROM scenario_sources WHERE versionId=?").get(versionId));

/** Explorer jobs and sweeps on a bundled example default to the lesson scenario (the M1 example never ranks). */
const DEFAULT_EXAMPLE = "lesson";

/**
 * Imported versions need the operator key; bundled synthetic examples go through the run key or
 * the public budget. Returns the version and the base settings the request starts from.
 */
function resolveTarget(store: Store, request: Request, versionId: unknown, base: unknown, cost: number, exampleId: unknown) {
  if (versionId === undefined || versionId === null) {
    const example = parseExample(exampleId, DEFAULT_EXAMPLE);
    const settings = syntheticBase(base, example);
    authorizeSyntheticRun(request, store, cost);
    return { versionId: exampleVersion(store, example), base: settings, imported: false };
  }
  if (exampleId !== undefined && exampleId !== null) throw new ApiError(400, "invalid_request", "Send either versionId or example, not both.", ["example"]);
  if (typeof versionId !== "string" || !isImportedVersion(store, versionId)) throw new ApiError(404, "version_not_found", "No saved imported scenario version.");
  assertScenarioAccess(request);
  return { versionId, base: parseSettings(base ?? {}), imported: true };
}

function parseSettings(input: unknown): RunSettings {
  try { return parseContract("RunSettings", withDefaults(input)); }
  catch (error) { throw new ApiError(400, "invalid_settings", error instanceof Error ? error.message : "Invalid settings.", ["settings"]); }
}
/** Pydantic owns defaults; the JSON Schema does not apply them, so start from the example's. */
function withDefaults(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "invalid_settings", "Settings must be an object.", ["settings"]);
  return { ...exampleSettings, k: null, solver_max_iterations: null, preflight: { missing_coordinates: "block", far_from_depot: "block", oversize_stop: "warn", approximate_coordinates: "warn" }, ...(input as object) };
}

// Synthetic runs keep the example's fixed budget and scenario; only the sweep axes may change.
const SYNTHETIC_OVERRIDES = new Set<string>([...SWEEP_AXES]);
function syntheticBase(input: unknown, example: Example): RunSettings {
  if (input === undefined || input === null) return example.settings;
  if (typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "invalid_settings", "Settings must be an object.", ["settings"]);
  for (const key of Object.keys(input)) if (!SYNTHETIC_OVERRIDES.has(key)) throw new ApiError(400, "invalid_settings", `Setting ${key} cannot be changed for the bundled example.`, [`settings.${key}`]);
  return parseSettings({ ...example.settings, ...(input as object) });
}

function checkSynthetic(settings: RunSettings) {
  if (settings.k !== null && (settings.k ?? 0) > 25) throw new ApiError(400, "invalid_settings", "k must be at most 25 for the bundled example.", ["settings.k"]);
}

// ---- k explorer ------------------------------------------------------------------------------------

export function explorerTasks(settings: { ks?: number[] | null; seeds?: number[]; selected_k?: number | null; h3_resolutions?: number[] }) {
  const ks = settings.ks ?? (settings.selected_k ? [settings.selected_k, settings.selected_k + 1] : [1, 2]);
  return ks.length * (settings.seeds ?? DEFAULT_SEEDS).length + new Set(settings.h3_resolutions ?? [1, 2, 3]).size;
}
const DEFAULT_SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export function createExplorer(store: Store, request: Request, body: { versionId?: unknown; example?: unknown; settings?: unknown; base?: unknown }, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters).", ["Idempotency-Key"]);
  const raw = (body.settings ?? {}) as Record<string, unknown>;
  if (typeof raw !== "object" || Array.isArray(raw) || "base" in raw) throw new ApiError(400, "invalid_settings", "Explorer settings must be an object; send base settings as `base`.", ["settings"]);
  const tasks = explorerTasks(raw as never);
  const limit = maxSweepRuns();
  if (tasks > limit) throw new ApiError(422, "too_many_tasks", `This explorer request is ${tasks} clustering tasks; the limit is ${limit}. Choose fewer k values, seeds or H3 resolutions.`, ["settings"]);
  const target = resolveTarget(store, request, body.versionId, body.base, 1, body.example);
  if (!target.imported) checkSynthetic(target.base);
  let settings: ExplorerSettings;
  try { settings = parseContract("ExplorerSettings", { seeds: DEFAULT_SEEDS, h3_resolutions: [1, 2, 3], reference_seed: 0, ks: null, selected_k: target.base.k ?? null, ...raw, schema_version: 1, kind: "explorer", base: target.base }); }
  catch (error) { throw new ApiError(400, "invalid_settings", error instanceof Error ? error.message : "Invalid explorer settings.", ["settings"]); }
  assertQueueRoom(store, 1);
  try { return store.enqueue(target.versionId, { schema_version: 1, document: settings as unknown as Snapshot["document"] }, idempotencyKey, Date.now(), 3, "explorer"); }
  catch (error) { throw idempotency(error); }
}

// ---- Sweeps ----------------------------------------------------------------------------------------

type SweepBody = { versionId?: unknown; example?: unknown; name?: unknown; base?: unknown; axes?: unknown; comparison?: unknown };

function expand(base: RunSettings, axes: unknown) {
  if (!axes || typeof axes !== "object" || Array.isArray(axes)) throw new ApiError(400, "invalid_axes", "Send axes as an object of setting → values.", ["axes"]);
  try {
    return expandSweep(base, axes as SweepAxes, maxSweepRuns()).map(run => ({ ...run, settings: parseSettings(run.settings) }));
  } catch (error) {
    if (error instanceof SweepError) throw new ApiError(error.code === "too_many_runs" ? 422 : 400, error.code, error.message, ["axes"]);
    throw error;
  }
}

/** Preview: the expanded runs and the upper solver budget, without enqueueing anything. */
export function previewSweep(store: Store, request: Request, body: SweepBody) {
  const imported = typeof body.versionId === "string";
  if (imported) { if (!isImportedVersion(store, body.versionId as string)) throw new ApiError(404, "version_not_found", "No saved imported scenario version."); assertScenarioAccess(request); }
  const base = imported ? parseSettings(body.base ?? {}) : syntheticBase(body.base, parseExample(body.example, DEFAULT_EXAMPLE));
  const runs = expand(base, body.axes);
  const perCluster = base.solver_time_limit_s;
  return { runs: runs.map(r => ({ varied: r.varied, changed: changedAssumptions(base, r.settings) })), count: runs.length, limit: maxSweepRuns(), solver_seconds_per_cluster: perCluster, iterations_per_cluster: base.solver_max_iterations ?? null };
}

export function createSweep(store: Store, request: Request, body: SweepBody, idempotencyKey: string) {
  if (!idempotencyKey || idempotencyKey.length > 180) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–180 characters).", ["Idempotency-Key"]);
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "Sweep";
  // Expand first so an oversized sweep spends no rate budget.
  const imported = typeof body.versionId === "string";
  const preliminary = expand(imported ? parseSettings(body.base ?? {}) : syntheticBase(body.base, parseExample(body.example, DEFAULT_EXAMPLE)), body.axes);
  const target = resolveTarget(store, request, body.versionId, body.base, preliminary.length, body.example);
  const runs = expand(target.base, body.axes);
  if (!target.imported) runs.forEach(r => checkSynthetic(r.settings));
  else {
    const document = validateScenario(store.versionDocument(target.versionId).document);
    const blocked = runs.flatMap(r => preflightChecks(document, r.settings).filter(f => f.action === "block").flatMap(f => f.line_ids));
    if (blocked.length) throw new ApiError(422, "preflight_blocked", "Resolve blocking checks, exclude affected lines, or change the check to a warning before sweeping.", [...new Set(blocked)]);
  }
  const comparison = parseCompare(body.comparison ?? DEFAULT_COMPARISON);
  assertQueueRoom(store, runs.length);
  try {
    return store.createExperiment({
      versionId: target.versionId, name,
      spec: { base: target.base, axes: body.axes, metrics_version: "fillrate-metrics/1" },
      comparison,
      runs: runs.map(r => ({ settings: { schema_version: 1, document: r.settings as unknown as Snapshot["document"] }, varied: r.varied })),
    }, idempotencyKey);
  } catch (error) { throw idempotency(error); }
}

function parseCompare(input: unknown) {
  try { return parseComparison(input); }
  catch (error) { throw new ApiError(400, "invalid_comparison", error instanceof Error ? error.message : "Invalid comparison.", ["comparison"]); }
}

export function saveExperimentComparison(store: Store, request: Request, id: string, input: unknown) {
  const experiment = store.experiment(id);
  if (!experiment) throw new ApiError(404, "experiment_not_found", "No experiment with this ID.");
  assertExperimentWrite(store, request, experiment.versionId);
  store.saveComparison(id, parseCompare(input));
  return experimentDetail(store, id);
}

export function assertExperimentRead(store: Store, request: Request, versionId: string) {
  if (isImportedVersion(store, versionId)) assertScenarioAccess(request);
}
function assertExperimentWrite(store: Store, request: Request, versionId: string) {
  if (isImportedVersion(store, versionId)) assertScenarioAccess(request);
  else authorizeSyntheticRun(request, store, 1);
}

export function experimentDetail(store: Store, id: string) {
  const experiment = store.experiment(id);
  if (!experiment) throw new ApiError(404, "experiment_not_found", "No experiment with this ID.");
  const comparison = parseComparison(experiment.comparison);
  const base = (experiment.spec as { base: RunSettings }).base;
  const members = experiment.runs.map(run => {
    const settings = run.settings as unknown as RunSettings;
    const summary = run.status === "succeeded" ? runSummary(store, run.runId) : null;
    const solve = store.runView(run.runId)?.artifacts.find(a => a.stage_type === "solve");
    return { run, settings, summary, solveReused: Boolean(solve?.reused_from) };
  });
  const compared = compareRuns(members.map(m => ({ id: m.run.runId, status: m.run.status, versionId: experiment.versionId, settings: m.settings, summary: m.summary, solveReused: m.solveReused })), comparison);
  return {
    schema_version: 1,
    id: experiment.id, name: experiment.name, version_id: experiment.versionId, created_at: experiment.createdAt,
    example: exampleForVersion(store, experiment.versionId),
    spec: experiment.spec,
    comparison: compared.comparison,
    metrics: METRICS,
    cohorts: compared.cohorts,
    cohort: compared.cohort,
    runs: members.map((m, i) => {
      const row = compared.rows[i];
      return {
        id: m.run.runId, position: m.run.position, status: m.run.status, varied: m.run.varied,
        changed: changedAssumptions(base, m.settings),
        k: m.summary?.clustering.selected_k ?? m.settings.k ?? null,
        strategy: m.settings.cluster_strategy,
        validity: m.summary?.validity ?? null, coverage: m.summary?.coverage ?? null,
        capacity_lower_bound: m.summary?.totals.capacity_lower_bound ?? null,
        sum_cluster_lower_bounds: m.summary?.totals.sum_cluster_lower_bounds ?? null,
        allocated_cents: m.summary?.totals.allocated_cents ?? null,
        avg_fill: m.summary?.totals.avg_fill ?? null,
        signature: row.signature, metrics: row.metrics, eligible: row.eligible, reason: row.reason,
        non_dominated: row.nonDominated, rank: row.rank, label: row.label,
      };
    }),
  };
}
export type ExperimentDetail = ReturnType<typeof experimentDetail>;

export function experimentCsv(detail: ExperimentDetail) {
  const keys = Object.keys(METRICS) as (keyof typeof METRICS)[];
  const header = ["# Fillrate sweep comparison. Shipments = trucks; ranking order: " + detail.comparison.order.join(" > ") + "; Pareto vector: " + detail.comparison.vector.map(k => `${k} (${METRICS[k].direction})`).join(", "),
    ["run_id", "position", "status", "varied", "changed_assumptions", "label", "rank", "non_dominated", "eligible", "reason", ...keys].join(",")];
  const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : typeof v === "object" ? canonical(v) : String(v); return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return [...header, ...detail.runs.map(r => [r.id, r.position, r.status, r.varied, r.changed.join("; "), r.label, r.rank, r.non_dominated, r.eligible, r.reason, ...keys.map(k => r.metrics?.[k] ?? null)].map(cell).join(","))].join("\n") + "\n";
}

export function publicExperiments(store: Store, operator: boolean) {
  return store.listExperiments(100).filter(e => operator || !isImportedVersion(store, e.versionId)).slice(0, 50);
}

function idempotency(error: unknown) {
  if (error instanceof Error && error.message === "idempotency_conflict") return new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
  return error;
}
