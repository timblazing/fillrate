import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { and, eq, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { parseContract, type Lease, type StageManifest, type Snapshot, type WorkerEvent } from "@fillrate/contracts";
import * as s from "./schema";

export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_COMPLETION_BYTES = 16 * 1024 * 1024;
export const MAX_REVIEW_BYTES = 64 * 1024;
const DETERMINISTIC = new Set(["preflight", "allocation", "aggregation", "clustering", "travel", "problem"]);
const active = new Set(["claimed", "running"]);
const terminal = new Set(["succeeded", "failed", "cancelled", "interrupted"]);

// Restricted to JSON; sort keys recursively, retain array order, reject lossy values.
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  throw new Error("invalid_json");
}
export const contentHash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export type ArtifactInput = { manifest: StageManifest; payload: unknown };

export function openDatabase(path: string, migrationsFolder = process.env.DB_MIGRATIONS_DIR ?? join(process.cwd(), "packages/db/migrations")) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  try {
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("synchronous = NORMAL");
    const db = drizzle(sqlite, { schema: s });
    migrate(db, { migrationsFolder });
    return new Store(db, sqlite);
  } catch (error) { sqlite.close(); throw error; }
}

type DB = ReturnType<typeof drizzle<typeof s>>;
export class Store {
  constructor(readonly db: DB, readonly sqlite: Database.Database) {}
  close() { this.sqlite.close(); }

  createScenario(name: string, snapshot: Snapshot, author: string, now = Date.now()) {
    parseContract("Snapshot", snapshot);
    const scenarioId = randomUUID(), versionId = randomUUID();
    this.db.transaction(tx => {
      tx.insert(s.scenarios).values({ id: scenarioId, name, createdAt: now }).run();
      tx.insert(s.versions).values({ id: versionId, scenarioId, revision: 1, document: canonical(snapshot), author, createdAt: now }).run();
    }, { behavior: "immediate" });
    return { scenarioId, versionId };
  }

  saveVersion(scenarioId: string, expectedVersionId: string, snapshot: Snapshot, author: string, now = Date.now()) {
    parseContract("Snapshot", snapshot);
    return this.db.transaction(tx => {
      const previous = tx.select().from(s.versions).where(eq(s.versions.scenarioId, scenarioId)).orderBy(sql`${s.versions.revision} desc`).get();
      if (!previous || previous.id !== expectedVersionId) throw new Error("version_conflict");
      const id = randomUUID();
      tx.insert(s.versions).values({ id, scenarioId, revision: previous.revision + 1, parentVersionId: previous.id, document: canonical(snapshot), author, createdAt: now }).run();
      return id;
    }, { behavior: "immediate" });
  }

  enqueue(versionId: string, settings: Snapshot, idempotencyKey: string, now = Date.now(), maxAttempts = 3) {
    parseContract("Snapshot", settings);
    if (!idempotencyKey || idempotencyKey.length > 200) throw new Error("invalid_idempotency_key");
    const requestHash = contentHash(canonical({ versionId, settings }));
    return this.db.transaction(tx => {
      const existing = tx.select().from(s.runs).where(eq(s.runs.idempotencyKey, idempotencyKey)).get();
      if (existing) {
        if (existing.requestHash !== requestHash) throw new Error("idempotency_conflict");
        return existing.id;
      }
      const id = randomUUID();
      tx.insert(s.runs).values({ id, versionId, settings: canonical(settings), idempotencyKey, requestHash, createdAt: now }).run();
      tx.insert(s.jobs).values({ id: randomUUID(), runId: id, createdAt: now, maxAttempts }).run();
      return id;
    }, { behavior: "immediate" });
  }

  claim(workerId: string, now = Date.now(), leaseMs = 60_000) {
    if (!workerId || workerId.length > 200 || !Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw new Error("invalid_claim");
    return this.db.transaction(tx => {
      // Recover expired attempts, including cancellations and exhausted retries.
      const expired = tx.select().from(s.jobs).where(sql`${s.jobs.status} IN ('claimed','running') AND ${s.jobs.leaseExpiresAt} <= ${now}`).all();
      for (const job of expired) {
        const status = job.cancelRequested ? "cancelled" : job.attempt >= job.maxAttempts ? "interrupted" : "queued";
        tx.update(s.jobs).set({ status, leaseToken: null, leaseExpiresAt: null }).where(eq(s.jobs.id, job.id)).run();
        tx.update(s.runs).set({ status }).where(eq(s.runs.id, job.runId)).run();
        tx.update(s.attempts).set({ endedAt: now, reason: "lease_expired" }).where(and(eq(s.attempts.jobId, job.id), eq(s.attempts.attempt, job.attempt))).run();
      }
      const job = tx.select().from(s.jobs).where(eq(s.jobs.status, "queued")).orderBy(asc(s.jobs.createdAt), asc(s.jobs.id)).get();
      if (!job) return null;
      const leaseToken = randomUUID();
      const claimed = tx.update(s.jobs).set({ status: "claimed", attempt: job.attempt + 1, workerId, leaseToken, heartbeatAt: now, leaseExpiresAt: now + leaseMs }).where(eq(s.jobs.id, job.id)).returning().get()!;
      tx.update(s.runs).set({ status: "claimed" }).where(eq(s.runs.id, job.runId)).run();
      tx.insert(s.attempts).values({ id: randomUUID(), jobId: job.id, attempt: claimed.attempt, workerId, startedAt: now }).run();
      return { lease: { job_id: job.id, worker_id: workerId, lease_token: leaseToken, attempt: claimed.attempt } satisfies Lease, run: tx.select().from(s.runs).where(eq(s.runs.id, job.runId)).get()!, expiresAt: now + leaseMs };
    }, { behavior: "immediate" });
  }

  heartbeat(lease: Lease, now = Date.now(), leaseMs = 60_000) {
    parseContract("Lease", lease);
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) throw new Error("invalid_lease_duration");
    return this.db.transaction(tx => {
      const job = tx.select().from(s.jobs).where(eq(s.jobs.id, lease.job_id)).get();
      assertLease(job, lease, now);
      tx.update(s.jobs).set({ status: "running", heartbeatAt: now, leaseExpiresAt: now + leaseMs }).where(eq(s.jobs.id, job!.id)).run();
      tx.update(s.runs).set({ status: "running" }).where(eq(s.runs.id, job!.runId)).run();
      return { cancelRequested: job!.cancelRequested, expiresAt: now + leaseMs };
    }, { behavior: "immediate" });
  }

  cancel(runId: string) {
    return this.db.transaction(tx => {
      const job = tx.select().from(s.jobs).where(eq(s.jobs.runId, runId)).get();
      if (!job) throw new Error("run_not_found");
      if (terminal.has(job.status)) return;
      tx.update(s.clusterJobs).set({ status: "cancelled" }).where(and(eq(s.clusterJobs.runId, runId), sql`${s.clusterJobs.status} IN ('queued','running')`)).run();
      tx.update(s.jobs).set({ cancelRequested: true, ...(job.status === "queued" ? { status: "cancelled" } : {}) }).where(eq(s.jobs.id, job.id)).run();
      if (job.status === "queued") tx.update(s.runs).set({ status: "cancelled" }).where(eq(s.runs.id, runId)).run();
    }, { behavior: "immediate" });
  }

  record(event: WorkerEvent, inputs: ArtifactInput[] = [], now = Date.now()) {
    parseContract("WorkerEvent", event);
    if (inputs.length > 100 || (inputs.length && event.kind !== "succeeded")) throw new Error("invalid_artifacts");
    const payload = canonical(event.payload);
    if (Buffer.byteLength(payload) > 64 * 1024) throw new Error("event_too_large");
    // Bound and hash outside the write transaction. All references commit together.
    let total = 0;
    const prepared = inputs.map(({ manifest, payload }) => {
      parseContract("StageManifest", manifest);
      const bytes = Buffer.from(canonical(payload));
      total += bytes.length;
      if (bytes.length > MAX_ARTIFACT_BYTES || total > MAX_COMPLETION_BYTES) throw new Error("artifact_too_large");
      if (contentHash(bytes) !== manifest.output_hash) throw new Error("artifact_hash_mismatch");
      return { manifest, bytes, compressed: gzipSync(bytes) };
    });
    const requestHash = contentHash(canonical({ event, manifests: inputs.map(x => x.manifest) }));
    return this.db.transaction(tx => {
      const job = tx.select().from(s.jobs).where(eq(s.jobs.id, event.lease.job_id)).get();
      // Exact terminal callback replay is harmless; a replaced lease is never accepted.
      if (!job || job.leaseToken !== event.lease.lease_token || job.attempt !== event.lease.attempt || job.workerId !== event.lease.worker_id) throw new Error("stale_lease");
      const duplicate = tx.select().from(s.events).where(and(eq(s.events.jobId, job.id), eq(s.events.attempt, job.attempt), eq(s.events.sequence, event.sequence))).get();
      if (duplicate) {
        if (duplicate.requestHash !== requestHash) throw new Error("event_conflict");
        return { duplicate: true };
      }
      assertLease(job, event.lease, now);
      const last = tx.select().from(s.events).where(and(eq(s.events.jobId, job.id), eq(s.events.attempt, job.attempt))).orderBy(sql`${s.events.sequence} desc`).get();
      if (event.sequence !== (last?.sequence ?? 0) + 1) throw new Error("event_out_of_order");
      if (job.cancelRequested && event.kind === "succeeded") throw new Error("cancel_requested");
      for (const item of prepared) {
        tx.insert(s.artifacts).values({ hash: item.manifest.output_hash, compressed: item.compressed, byteLength: item.bytes.length }).onConflictDoNothing().run();
        tx.insert(s.runArtifacts).values({ id: randomUUID(), runId: job.runId, artifactHash: item.manifest.output_hash, manifest: canonical(item.manifest) }).run();
      }
      tx.insert(s.events).values({ id: randomUUID(), jobId: job.id, attempt: job.attempt, sequence: event.sequence, kind: event.kind, payload, requestHash, createdAt: now }).run();
      const status = event.kind === "progress" ? "running" : event.kind;
      tx.update(s.jobs).set({ status }).where(eq(s.jobs.id, job.id)).run();
      tx.update(s.runs).set({ status }).where(eq(s.runs.id, job.runId)).run();
      if (terminal.has(status)) tx.update(s.attempts).set({ endedAt: now, reason: status }).where(and(eq(s.attempts.jobId, job.id), eq(s.attempts.attempt, job.attempt))).run();
      return { duplicate: false };
    }, { behavior: "immediate" });
  }

  // Upsert by the reviewer's browser id. Answers are a small JSON object of question id → answer.
  saveReview(id: string, reviewer: string, answers: Record<string, unknown>, submit: boolean, now = Date.now()) {
    if (!/^[0-9a-f-]{36}$/.test(id) || reviewer.length > 200) throw new Error("invalid_review");
    const document = canonical(answers);
    if (Buffer.byteLength(document) > MAX_REVIEW_BYTES) throw new Error("review_too_large");
    return this.db.transaction(tx => {
      const existing = tx.select().from(s.designReviews).where(eq(s.designReviews.id, id)).get();
      const submittedAt = submit ? now : existing?.submittedAt ?? null;
      if (existing) tx.update(s.designReviews).set({ reviewer, answers: document, submittedAt, updatedAt: now }).where(eq(s.designReviews.id, id)).run();
      else tx.insert(s.designReviews).values({ id, reviewer, answers: document, submittedAt, createdAt: now, updatedAt: now }).run();
      return { savedAt: now, submittedAt };
    }, { behavior: "immediate" });
  }

  deleteReview(id: string) {
    return this.db.delete(s.designReviews).where(eq(s.designReviews.id, id)).run().changes > 0;
  }

  listReviews() {
    return this.db.select().from(s.designReviews).orderBy(sql`${s.designReviews.updatedAt} desc`).all()
      .map(r => ({ ...r, answers: JSON.parse(r.answers) as Record<string, unknown> }));
  }

  checkpoint(lease: Lease, input: ArtifactInput, now = Date.now()) {
    parseContract("Lease", lease);
    parseContract("StageManifest", input.manifest);
    const bytes = Buffer.from(canonical(input.payload));
    if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error("artifact_too_large");
    if (contentHash(bytes) !== input.manifest.output_hash) throw new Error("artifact_hash_mismatch");
    const compressed = gzipSync(bytes);
    return this.db.transaction(tx => {
      const job = tx.select().from(s.jobs).where(eq(s.jobs.id, lease.job_id)).get();
      assertLease(job, lease, now);
      if (job!.cancelRequested) throw new Error("cancel_requested");
      if (input.manifest.execution_id !== lease.lease_token) throw new Error("stale_lease");
      tx.insert(s.artifacts).values({ hash: input.manifest.output_hash, compressed, byteLength: bytes.length }).onConflictDoNothing().run();
      const existing = tx.select().from(s.runArtifacts).where(and(eq(s.runArtifacts.runId, job!.runId), eq(s.runArtifacts.manifest, canonical(input.manifest)))).get();
      if (!existing) tx.insert(s.runArtifacts).values({ id: randomUUID(), runId: job!.runId, artifactHash: input.manifest.output_hash, manifest: canonical(input.manifest) }).run();
      if (DETERMINISTIC.has(input.manifest.stage_type)) {
        tx.insert(s.stageCache).values({ inputHash: input.manifest.input_hash, artifactHash: input.manifest.output_hash, manifest: canonical(input.manifest), runId: job!.runId }).onConflictDoNothing().run();
      }
      return { stored: true };
    }, { behavior: "immediate" });
  }

  cachedStage(lease: Lease, inputHash: string, now = Date.now()) {
    parseContract("Lease", lease);
    assertLease(this.db.select().from(s.jobs).where(eq(s.jobs.id, lease.job_id)).get(), lease, now);
    if (!/^[a-f0-9]{64}$/.test(inputHash)) throw new Error("invalid_hash");
    const cached = this.db.select().from(s.stageCache).where(eq(s.stageCache.inputHash, inputHash)).get();
    if (!cached) return null;
    const manifest = parseContract("StageManifest", JSON.parse(cached.manifest));
    return { manifest, payload: this.readArtifact(cached.artifactHash) };
  }

  clusterTask(lease: Lease, action: string, clusterId: string, inputHash: string, result?: unknown, now = Date.now()) {
    parseContract("Lease", lease);
    if (!clusterId || clusterId.length > 200 || !/^[a-f0-9]{64}$/.test(inputHash)) throw new Error("invalid_cluster");
    const resultJson = result === undefined ? null : canonical(result);
    if (resultJson && Buffer.byteLength(resultJson) > MAX_ARTIFACT_BYTES) throw new Error("artifact_too_large");
    return this.db.transaction(tx => {
      const job = tx.select().from(s.jobs).where(eq(s.jobs.id, lease.job_id)).get();
      assertLease(job, lease, now);
      if (job!.cancelRequested) throw new Error("cancel_requested");
      let task = tx.select().from(s.clusterJobs).where(and(eq(s.clusterJobs.runId, job!.runId), eq(s.clusterJobs.clusterId, clusterId))).get();
      if (!task) {
        if (action !== "claim") throw new Error("cluster_not_found");
        task = tx.insert(s.clusterJobs).values({ id: randomUUID(), runId: job!.runId, clusterId, inputHash, maxAttempts: job!.maxAttempts }).returning().get()!;
      }
      if (task.inputHash !== inputHash) throw new Error("cluster_input_conflict");
      if (task.status === "succeeded" || task.status === "failed") return { status: task.status, attempt: task.attempt, result: task.result ? JSON.parse(task.result) : null };
      if (action === "claim") {
        if (task.status === "running" && task.coordinatorToken === lease.lease_token) throw new Error("cluster_already_claimed");
        if (task.attempt >= task.maxAttempts) {
          tx.update(s.clusterJobs).set({ status: "failed", endedAt: now, error: "attempts_exhausted" }).where(eq(s.clusterJobs.id, task.id)).run();
          return { status: "failed", attempt: task.attempt, result: null };
        }
        tx.update(s.clusterJobs).set({ status: "running", attempt: task.attempt + 1, coordinatorToken: lease.lease_token, startedAt: now, endedAt: null, error: task.attempt ? "prior_coordinator_expired" : null }).where(eq(s.clusterJobs.id, task.id)).run();
        return { status: "running", attempt: task.attempt + 1, result: null };
      }
      if (action !== "complete" || !resultJson || task.coordinatorToken !== lease.lease_token) throw new Error("stale_lease");
      tx.update(s.clusterJobs).set({ status: "succeeded", result: resultJson, endedAt: now }).where(eq(s.clusterJobs.id, task.id)).run();
      return { status: "succeeded", attempt: task.attempt, result };
    }, { behavior: "immediate" });
  }

  findVersion(snapshot: Snapshot) {
    return this.db.select().from(s.versions).where(eq(s.versions.document, canonical(snapshot))).orderBy(asc(s.versions.createdAt)).get() ?? null;
  }

  versionDocument(versionId: string): Snapshot {
    const version = this.db.select().from(s.versions).where(eq(s.versions.id, versionId)).get();
    if (!version) throw new Error("version_not_found");
    return JSON.parse(version.document) as Snapshot;
  }

  listRuns(limit = 50) {
    return this.db.select({ id: s.runs.id, status: s.runs.status, createdAt: s.runs.createdAt, versionId: s.runs.versionId })
      .from(s.runs).orderBy(sql`${s.runs.createdAt} desc`, sql`${s.runs.id} desc`).limit(limit).all();
  }

  // Status, current attempt, latest-attempt events and artifact manifests for one run.
  runView(runId: string) {
    const run = this.db.select().from(s.runs).where(eq(s.runs.id, runId)).get();
    if (!run) return null;
    const job = this.db.select().from(s.jobs).where(eq(s.jobs.runId, runId)).get()!;
    const events = this.db.select().from(s.events).where(and(eq(s.events.jobId, job.id), eq(s.events.attempt, job.attempt))).orderBy(asc(s.events.sequence)).all()
      .map(e => ({ sequence: e.sequence, kind: e.kind, payload: JSON.parse(e.payload) as Record<string, unknown>, createdAt: e.createdAt }));
    const attempts = this.db.select().from(s.attempts).where(eq(s.attempts.jobId, job.id)).orderBy(asc(s.attempts.attempt)).all()
      .map(a => ({ attempt: a.attempt, workerId: a.workerId, startedAt: a.startedAt, endedAt: a.endedAt, reason: a.reason }));
    const artifacts = this.db.select().from(s.runArtifacts).where(eq(s.runArtifacts.runId, runId)).all()
      .map(a => JSON.parse(a.manifest) as StageManifest);
    return {
      id: run.id, versionId: run.versionId, status: run.status, createdAt: run.createdAt,
      settings: JSON.parse(run.settings) as Snapshot,
      attempt: job.attempt, maxAttempts: job.maxAttempts, cancelRequested: job.cancelRequested,
      events, attempts, artifacts,
      clusters: this.db.select().from(s.clusterJobs).where(eq(s.clusterJobs.runId, runId)).all().map(({ result: _result, coordinatorToken: _token, ...task }) => task),
    };
  }

  queueStats() {
    const rows = this.sqlite.prepare("SELECT status, count(*) AS n FROM jobs GROUP BY status").all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map(r => [r.status, r.n])) as Record<string, number>;
  }

  readArtifact(hash: string): unknown {
    const artifact = this.db.select().from(s.artifacts).where(eq(s.artifacts.hash, hash)).get();
    if (!artifact) throw new Error("artifact_not_found");
    const bytes = gunzipSync(artifact.compressed, { maxOutputLength: MAX_ARTIFACT_BYTES });
    if (bytes.length !== artifact.byteLength || contentHash(bytes) !== hash) throw new Error("artifact_corrupt");
    return JSON.parse(bytes.toString("utf8"));
  }
}
function assertLease(job: typeof s.jobs.$inferSelect | undefined, lease: Lease, now: number) {
  if (!job || !active.has(job.status) || job.leaseToken !== lease.lease_token || job.workerId !== lease.worker_id || job.attempt !== lease.attempt || (job.leaseExpiresAt ?? 0) <= now) throw new Error("stale_lease");
}

export function defaultDatabasePath(root = process.cwd()) {
  return process.env.DATA_DIR ? join(process.env.DATA_DIR, "fillrate.sqlite") : join(root, "data/dev.sqlite");
}
