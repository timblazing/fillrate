import "server-only";
import { timingSafeEqual } from "node:crypto";

import { parseContract, type ExplorerSummary, type RunSettings, type RunSummary, type ScenarioDocument, type Snapshot } from "@fillrate/contracts";
import type { Store } from "@fillrate/db";

import example from "../../../../../examples/m1-synthetic.json";

// M1 runs execute the bundled synthetic scenario only (spec §14: public surfaces stay synthetic).
export const exampleScenario = example.scenario as ScenarioDocument;
export const exampleSettings = example.settings as RunSettings;

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

export function exampleVersion(store: Store) {
  const snapshot: Snapshot = { schema_version: 1, document: exampleScenario as unknown as Snapshot["document"] };
  return store.findVersion(snapshot)?.id ?? store.createScenario(exampleScenario.name, snapshot, "Fillrate examples").versionId;
}

/** Only these settings are overridable in M1; the rest come from the bundled example. */
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
    } else {
      throw new ApiError(400, "invalid_settings", `Setting ${key} cannot be changed in this version.`, [`settings.${key}`]);
    }
  }
  return out;
}

export function createRun(store: Store, idempotencyKey: string, overrides: Partial<RunSettings>) {
  if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters).", ["Idempotency-Key"]);
  const settings = parseContract("RunSettings", { ...exampleSettings, ...overrides });
  const snapshot: Snapshot = { schema_version: 1, document: settings as unknown as Snapshot["document"] };
  try {
    assertQueueRoom(store, 1);
    return store.enqueue(exampleVersion(store), snapshot, idempotencyKey);
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
