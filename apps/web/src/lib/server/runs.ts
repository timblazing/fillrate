import "server-only";
import { parseContract, type ExplorerSummary, type RunSettings, type RunSummary, type ScenarioDocument, type Snapshot } from "@fillrate/contracts";
import { EXAMPLES_OWNER, type Store } from "@fillrate/db";

import { quotas, syntheticAdmission, type Principal } from "./access";
import { mode } from "./auth";
import { ApiError } from "./errors";

import allocation from "../../../../../examples/lesson-allocation.json";
import lesson from "../../../../../examples/lesson-fulfillment.json";
import m1 from "../../../../../examples/m1-synthetic.json";

// Keyless and run-key submissions execute bundled synthetic scenarios only (spec §14: public
// surfaces stay synthetic). `m1` is the small edge-case example (always partial coverage, so its
// sweeps never rank); `lesson` is the 2,000-order flagship lesson scenario; `allocation` is the small
// scarce-stock scenario for the allocation lesson (spec §13).
export const EXAMPLES = {
  m1: { id: "m1", scenario: m1.scenario as ScenarioDocument, settings: m1.settings as RunSettings, blurb: "Small edge-case example: a shortage, an oversize piece, an unreachable stop" },
  lesson: { id: "lesson", scenario: lesson.scenario as ScenarioDocument, settings: lesson.settings as RunSettings, blurb: "Flagship lesson: 2,000 orders with scarce stock, valid and complete" },
  allocation: { id: "allocation", scenario: allocation.scenario as ScenarioDocument, settings: allocation.settings as RunSettings, blurb: "Allocation lesson: scarce carpet rolls, so strategy and piece or whole-order policy decide who ships" },
} as const;
export type ExampleId = keyof typeof EXAMPLES;
export type Example = (typeof EXAMPLES)[ExampleId];
export const exampleScenario = EXAMPLES.m1.scenario;
export const exampleSettings = EXAMPLES.m1.settings;

/** The example a page's `?example=` names; anything else is the flagship lesson. */
export const pageExample = (param: unknown): Example => (typeof param === "string" && Object.hasOwn(EXAMPLES, param) ? EXAMPLES[param as ExampleId] : EXAMPLES.lesson);

export function parseExample(input: unknown, fallback: ExampleId): Example {
  if (input === undefined || input === null) return EXAMPLES[fallback];
  if (typeof input === "string" && Object.hasOwn(EXAMPLES, input)) return EXAMPLES[input as ExampleId];
  throw new ApiError(400, "unknown_example", `Unknown example; use one of ${Object.keys(EXAMPLES).join(", ")}.`, ["example"]);
}

const EXAMPLE_LABELS: Record<ExampleId, string> = { m1: "Small example", lesson: "Lesson, 2,000 orders", allocation: "Allocation lesson" };

/** Small listing for pages and `GET /api/v1/examples`. */
export function exampleInfo(example: Example) {
  const { scenario, settings } = example;
  return { id: example.id, name: scenario.name, label: EXAMPLE_LABELS[example.id], blurb: example.blurb, orders: scenario.orders.length, lines: scenario.orders.reduce((n, o) => n + o.lines.length, 0), locations: scenario.locations.length, k: settings.k ?? null };
}

export { ApiError, errorResponse } from "./errors";

export const maxSweepRuns = () => quotas().maxSweepRuns;

/**
 * Whether a page offers run controls (the API decides on submission). `key` is a `?key=` run key in the
 * page URL; it is checked when the run is submitted.
 */
export function canStartRuns(who: Principal, key?: unknown) {
  return Boolean(who.ownerId || who.runKey || process.env.PUBLIC_SYNTHETIC_RUNS === "1" || (typeof key === "string" && process.env.RUN_KEY));
}

/** What a page says instead of run controls. */
export const runsClosedNote = () =>
  mode().mode === "hosted" ? "Sign in to start runs. Existing runs stay viewable." : "Starting runs is disabled on this server. Existing runs stay viewable.";

const exampleSnapshot = (example: Example): Snapshot => ({ schema_version: 1, document: example.scenario as unknown as Snapshot["document"] });
const versionCache = new WeakMap<Store, Map<ExampleId, string>>();

export function exampleVersion(store: Store, example: Example = EXAMPLES.m1) {
  const cache = versionCache.get(store) ?? new Map<ExampleId, string>();
  versionCache.set(store, cache);
  let id = cache.get(example.id);
  if (!id || !store.sqlite.prepare("SELECT 1 FROM scenario_versions WHERE id=?").get(id)) {
    const snapshot = exampleSnapshot(example);
    id = store.findVersion(snapshot)?.id ?? store.createScenario(example.scenario.name, snapshot, "Fillrate examples", Date.now(), EXAMPLES_OWNER).versionId;
    cache.set(example.id, id);
  }
  return id;
}

/** Which bundled example a saved version is, if any (synthetic jobs carry no example field). */
export function exampleForVersion(store: Store, versionId: string): ExampleId | null {
  for (const example of Object.values(EXAMPLES)) if (exampleVersion(store, example) === versionId) return example.id;
  return null;
}

const ALLOCATION_STRATEGIES = ["order_date_then_value", "first_come", "priority", "proportional", "optimized"] as const;
const FULFILLMENT_POLICIES = ["piece", "whole_order"] as const;

/** Only these settings are overridable on `/api/v1/runs`; the rest come from the bundled example. */
export function parseOverrides(input: unknown): Partial<RunSettings> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw new ApiError(400, "invalid_settings", "Settings must be an object.");
  const out: Partial<RunSettings> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "k") {
      if (value !== null && !(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 25))
        throw new ApiError(400, "invalid_settings", "k must be null (auto) or an integer from 1 to 25.", ["settings.k"]);
      out.k = value as number | null;
    } else if (key === "kmeans_seed" || key === "solver_seed") {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1_000_000)
        throw new ApiError(400, "invalid_settings", `${key} must be an integer from 0 to 1,000,000.`, [`settings.${key}`]);
      out[key] = value as number;
    } else if (key === "inventory_percent") {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 100)
        throw new ApiError(400, "invalid_settings", "inventory_percent must be an integer from 0 to 100.", ["settings.inventory_percent"]);
      out.inventory_percent = value as number;
    } else if (key === "allocation_strategy") {
      if (!ALLOCATION_STRATEGIES.includes(value as never))
        throw new ApiError(400, "invalid_settings", `allocation_strategy must be one of ${ALLOCATION_STRATEGIES.join(", ")}.`, ["settings.allocation_strategy"]);
      out.allocation_strategy = value as RunSettings["allocation_strategy"];
    } else if (key === "fulfillment_policy") {
      if (!FULFILLMENT_POLICIES.includes(value as never))
        throw new ApiError(400, "invalid_settings", `fulfillment_policy must be one of ${FULFILLMENT_POLICIES.join(", ")}.`, ["settings.fulfillment_policy"]);
      out.fulfillment_policy = value as RunSettings["fulfillment_policy"];
    } else {
      throw new ApiError(400, "invalid_settings", `Setting ${key} cannot be changed in this version.`, [`settings.${key}`]);
    }
  }
  return out;
}

export function createRun(store: Store, who: Principal, idempotencyKey: string, overrides: Partial<RunSettings>, example: Example = EXAMPLES.m1) {
  if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters).", ["Idempotency-Key"]);
  const settings = parseContract("RunSettings", { ...example.settings, ...overrides });
  const snapshot: Snapshot = { schema_version: 1, document: settings as unknown as Snapshot["document"] };
  const { ownerId, admission } = syntheticAdmission(who);
  try {
    return store.enqueue(exampleVersion(store, example), snapshot, idempotencyKey, Date.now(), 3, "pipeline", { ownerId, admission });
  } catch (error) {
    if (error instanceof Error && error.message === "idempotency_conflict")
      throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used with different settings.");
    throw error;
  }
}

export function runSummary(store: Store, runId: string): RunSummary | null {
  const view = store.runView(runId);
  const manifest = view?.artifacts.find(a => a.stage_type === "summary");
  return manifest ? (store.readArtifact(manifest.output_hash) as RunSummary) : null;
}

export function explorerSummary(store: Store, runId: string): ExplorerSummary | null {
  const manifest = store.runView(runId)?.artifacts.find(a => a.stage_type === "explorer");
  return manifest ? (store.readArtifact(manifest.output_hash) as ExplorerSummary) : null;
}

export function runDetail(store: Store, runId: string) {
  const view = store.runView(runId);
  if (!view) throw new ApiError(404, "run_not_found", "No run with this ID.");
  if (view.kind === "explorer") return { ...baseDetail(view), kind: "explorer" as const, explorer_settings: view.settings.document, settings: null, summary: null, explorer: view.status === "succeeded" ? explorerSummary(store, runId) : null };
  return { ...baseDetail(view), kind: "pipeline" as const, explorer_settings: null, settings: view.settings.document as unknown as RunSettings, summary: view.status === "succeeded" ? runSummary(store, runId) : null, explorer: null };
}

function baseDetail(view: NonNullable<ReturnType<Store["runView"]>>) {
  const failure = view.events.find(e => e.kind === "failed")?.payload ?? null;
  const progress = [...view.events].reverse().find(e => e.kind === "progress")?.payload ?? null;
  return {
    schema_version: 1,
    id: view.id,
    status: view.status,
    created_at: view.createdAt,
    attempt: view.attempt,
    max_attempts: view.maxAttempts,
    cancel_requested: view.cancelRequested,
    attempts: view.attempts,
    progress,
    failure,
    stages: view.artifacts.map(a => ({ stage: a.stage_type, output_hash: a.output_hash, input_hash: a.input_hash, parent_hashes: a.parent_hashes, producer: a.producer_version, adapter: a.adapter_version, reused_from: a.reused_from ?? null })),
  };
}

export type RunDetail = ReturnType<typeof runDetail>;
