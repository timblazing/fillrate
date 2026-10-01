import "server-only";
import { timingSafeEqual } from "node:crypto";

import { parseContract, type ExplorerSummary, type RunSettings, type RunSummary, type ScenarioDocument, type Snapshot } from "@fillrate/contracts";
import type { Store } from "@fillrate/db";

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

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fields: string[] = [], readonly retryAfterS = 0) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = error.retryAfterS ? { "Retry-After": String(error.retryAfterS) } : {};
    return Response.json({ error: { code: error.code, message: error.message, fields: error.fields } }, { status: error.status, headers });
  }
  const code = error instanceof Error ? error.message.split(":")[0] : "error";
  return Response.json({ error: { code, message: "Request failed.", fields: [] } }, { status: 400 });
}

/**
 * Creating and cancelling runs uses solver CPU, so production requires `RUN_KEY` (sent as the
 * `x-run-key` header or `?key=`) until public quotas and isolation exist. Development is open.
 */
export function assertRunAccess(request: Request) {
  if (process.env.NODE_ENV !== "production") return;
  const expected = process.env.RUN_KEY;
  if (!expected) throw new ApiError(503, "runs_disabled", "Run submission is not enabled on this server.");
  const key = request.headers.get("x-run-key") ?? new URL(request.url).searchParams.get("key") ?? "";
  const a = Buffer.from(key), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(403, "forbidden", "A valid run key is required.");
}

function validRunKey(request: Request) {
  const expected = process.env.RUN_KEY;
  if (!expected) return false;
  const key = request.headers.get("x-run-key") ?? new URL(request.url).searchParams.get("key") ?? "";
  const a = Buffer.from(key), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const envInt = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
};
export const maxSweepRuns = () => envInt("MAX_SWEEP_RUNS", 25);
export const publicSyntheticRuns = () => process.env.PUBLIC_SYNTHETIC_RUNS === "1";

/**
 * Synthetic submissions (spec §14 release gate). Development is open. In production the run key
 * always works; without it, keyless synthetic runs exist only when PUBLIC_SYNTHETIC_RUNS=1 and then
 * spend a global (not per-client) hourly and daily budget measured in runs/tasks. Rate limiting
 * never trusts X-Forwarded-For: one shared budget bounds total solver work whoever sends it.
 */
export function authorizeSyntheticRun(request: Request, store: Store, cost: number) {
  if (process.env.NODE_ENV !== "production" || validRunKey(request)) return;
  if (!publicSyntheticRuns()) return assertRunAccess(request);
  const now = Date.now();
  for (const [bucket, limit, windowMs] of [["public:hour", envInt("PUBLIC_RUNS_PER_HOUR", 60), 3_600_000], ["public:day", envInt("PUBLIC_RUNS_PER_DAY", 300), 86_400_000]] as const) {
    if (cost > limit) throw new ApiError(429, "public_limit", `This request needs ${cost} runs; the public limit is ${limit} per ${bucket.slice(7)}.`);
    const spent = store.spendRate(bucket, cost, limit, windowMs, now);
    if (!spent.ok) throw new ApiError(429, "rate_limited", `The public run budget for this ${bucket.slice(7)} is used up. Try again later.`, [], Math.ceil(spent.retryAfterMs / 1000));
  }
}

/** Bounded queue: a request that would push active jobs past MAX_QUEUED_RUNS is refused whole. */
export function assertQueueRoom(store: Store, adding: number) {
  const stats = store.queueStats();
  if (Object.values(stats).reduce((n, x) => n + x, 0) > 100000) throw new ApiError(429, "run_limit", "Run retention limit reached.");
  const active = (stats.queued ?? 0) + (stats.claimed ?? 0) + (stats.running ?? 0);
  const limit = envInt("MAX_QUEUED_RUNS", 50);
  if (active + adding > limit) throw new ApiError(429, "queue_full", `The solve queue is full (${active} active, limit ${limit}).`, [], 30);
}

export const runsOpen = () => process.env.NODE_ENV !== "production" || Boolean(process.env.RUN_KEY) || publicSyntheticRuns();

const exampleSnapshot = (example: Example): Snapshot => ({ schema_version: 1, document: example.scenario as unknown as Snapshot["document"] });
const versionCache = new WeakMap<Store, Map<ExampleId, string>>();

export function exampleVersion(store: Store, example: Example = EXAMPLES.m1) {
  const cache = versionCache.get(store) ?? new Map<ExampleId, string>();
  versionCache.set(store, cache);
  let id = cache.get(example.id);
  if (!id || !store.sqlite.prepare("SELECT 1 FROM scenario_versions WHERE id=?").get(id)) {
    const snapshot = exampleSnapshot(example);
    id = store.findVersion(snapshot)?.id ?? store.createScenario(example.scenario.name, snapshot, "Fillrate examples").versionId;
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

export function createRun(store: Store, idempotencyKey: string, overrides: Partial<RunSettings>, example: Example = EXAMPLES.m1) {
  if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters).", ["Idempotency-Key"]);
  const settings = parseContract("RunSettings", { ...example.settings, ...overrides });
  const snapshot: Snapshot = { schema_version: 1, document: settings as unknown as Snapshot["document"] };
  try {
    assertQueueRoom(store, 1);
    return store.enqueue(exampleVersion(store, example), snapshot, idempotencyKey);
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
