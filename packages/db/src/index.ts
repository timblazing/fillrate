import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { and, eq, asc, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { parseContract, type Lease, type ScenarioDocument, type StageManifest, type Snapshot, type WorkerEvent } from "@fillrate/contracts";
import { assertSnapshotBinding, demandStops } from "./preflight";
import * as s from "./schema";
import { bindingMessage, bindNodes, MAX_SNAPSHOT_BYTES, normalizeSnapshot, rememberIdentity, stopNodes, type TravelSnapshot } from "./travel";

export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_COMPLETION_BYTES = 16 * 1024 * 1024;
const DETERMINISTIC = new Set(["preflight", "allocation", "aggregation", "clustering", "travel", "problem"]);
const active = new Set(["claimed", "running"]);
const terminal = new Set(["succeeded", "failed", "cancelled", "interrupted"]);

export { canonical } from "./canonical";
import { canonical } from "./canonical";
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

  createScenario(name: string, snapshot: Snapshot, author: string, now = Date.now(), ownerId = OPERATOR) {
    parseContract("Snapshot", snapshot);
    const scenarioId = randomUUID(), versionId = randomUUID();
    this.db.transaction(tx => {
      tx.insert(s.scenarios).values({ id: scenarioId, name, createdAt: now, ownerId }).run();
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

  /**
   * Queues one run. `ownerId` is the submitter; it must own the version's scenario unless that is a bundled
   * example. `admission` (spec §14 quotas) is checked and charged in the same write transaction as the insert,
   * so concurrent requests and restarts cannot overshoot; an idempotent replay is never charged twice.
   */
  enqueue(versionId: string, settings: Snapshot, idempotencyKey: string, now = Date.now(), maxAttempts = 3, kind: RunKind = "pipeline", options: { ownerId?: string; admission?: Admission } = {}) {
    parseContract("Snapshot", settings);
    if (!idempotencyKey || idempotencyKey.length > 300) throw new Error("invalid_idempotency_key");
    const ownerId = options.ownerId ?? OPERATOR;
    this.assertSubmitter(versionId, ownerId);
    this.assertVersionKind(versionId, kind);
    if (kind === "pipeline") this.checkTravel(versionId, settings, new Map());
    const requestHash = contentHash(canonical({ versionId, settings, ...(kind === "pipeline" ? {} : { kind }) }));
    return this.db.transaction(tx => {
      const existing = tx.select().from(s.runs).where(eq(s.runs.idempotencyKey, idempotencyKey)).get();
      if (existing) {
        if (existing.requestHash !== requestHash || existing.ownerId !== ownerId) throw new Error("idempotency_conflict");
        return existing.id;
      }
      if (options.admission) admit(tx, options.admission, 1, now);
      return insertRun(tx, versionId, settings, idempotencyKey, requestHash, now, maxAttempts, kind, ownerId);
    }, { behavior: "immediate" });
  }

  /**
   * Run settings that select a travel snapshot must name a stored one, and every stop with demand must
   * match the snapshot's coordinates, or the run would route over a stale matrix (spec §7).
   */
  private checkTravel(versionId: string, settings: Snapshot, loaded: Map<string, TravelSnapshot>) {
    const document = settings.document as { travel_snapshot_id?: string | null; excluded_line_ids?: string[] };
    if (!document.travel_snapshot_id) return;
    let snapshot = loaded.get(document.travel_snapshot_id);
    if (!snapshot) {
      if (!this.ownsTravelSnapshot(document.travel_snapshot_id, this.versionOwner(versionId))) throw new Error("travel_snapshot_not_found: no stored travel snapshot has this identity");
      snapshot = this.travelSnapshot(document.travel_snapshot_id); loaded.set(document.travel_snapshot_id, snapshot);
    }
    assertSnapshotBinding(this.versionDocument(versionId).document as unknown as ScenarioDocument, document.excluded_line_ids ?? [], snapshot);
  }

  /** Stores a validated snapshot under its content hash. Saving the same document again is a no-op. */
  saveTravelSnapshot(input: unknown, now = Date.now(), ownerId = OPERATOR) {
    const snapshot = normalizeSnapshot(input);
    const bytes = Buffer.from(canonical(snapshot));
    if (bytes.length > MAX_SNAPSHOT_BYTES) throw new Error(`travel_snapshot_too_large: ${bytes.length} bytes exceed ${MAX_SNAPSHOT_BYTES}`);
    const id = contentHash(bytes);
    const created = this.db.insert(s.travelSnapshots).values({ id, compressed: gzipSync(bytes), byteLength: bytes.length, nodeCount: snapshot.nodes.length, provider: snapshot.provider, providerVersion: snapshot.provider_version, datasetRevision: snapshot.dataset_revision, profile: snapshot.profile, createdAt: now }).onConflictDoNothing().run().changes > 0;
    this.db.insert(s.travelSnapshotOwners).values({ snapshotId: id, ownerId, createdAt: now }).onConflictDoNothing().run();
    return { created, ...this.travelSnapshotInfo(id, ownerId)! };
  }

  ownsTravelSnapshot(id: string, ownerId: string) {
    return Boolean(this.db.select().from(s.travelSnapshotOwners).where(and(eq(s.travelSnapshotOwners.snapshotId, id), eq(s.travelSnapshotOwners.ownerId, ownerId))).get());
  }

  /** Metadata for an owner's snapshot; another owner's identity reads as missing. */
  travelSnapshotInfo(id: string, ownerId = OPERATOR) {
    if (!this.ownsTravelSnapshot(id, ownerId)) return null;
    return this.db.select({ id: s.travelSnapshots.id, byteLength: s.travelSnapshots.byteLength, nodeCount: s.travelSnapshots.nodeCount, provider: s.travelSnapshots.provider, providerVersion: s.travelSnapshots.providerVersion, datasetRevision: s.travelSnapshots.datasetRevision, profile: s.travelSnapshots.profile, createdAt: s.travelSnapshots.createdAt })
      .from(s.travelSnapshots).where(eq(s.travelSnapshots.id, id)).get() ?? null;
  }

  /** Recent snapshots visible to one owner. */
  listTravelSnapshots(ownerId = OPERATOR, limit = 50) {
    return this.db.select({ id: s.travelSnapshots.id, byteLength: s.travelSnapshots.byteLength, nodeCount: s.travelSnapshots.nodeCount, provider: s.travelSnapshots.provider, providerVersion: s.travelSnapshots.providerVersion, datasetRevision: s.travelSnapshots.datasetRevision, profile: s.travelSnapshots.profile, createdAt: s.travelSnapshots.createdAt })
      .from(s.travelSnapshots).innerJoin(s.travelSnapshotOwners, eq(s.travelSnapshots.id, s.travelSnapshotOwners.snapshotId))
      .where(eq(s.travelSnapshotOwners.ownerId, ownerId)).orderBy(desc(s.travelSnapshotOwners.createdAt)).limit(Math.max(1, Math.min(100, limit))).all();
  }

  /** The stored snapshot, re-hashed on every read: a row that no longer matches its identity is corrupt. */
  travelSnapshot(id: string): TravelSnapshot {
    const row = this.db.select().from(s.travelSnapshots).where(eq(s.travelSnapshots.id, id)).get();
    if (!row) throw new Error("travel_snapshot_not_found: no stored travel snapshot has this identity");
    const bytes = gunzipSync(row.compressed, { maxOutputLength: MAX_SNAPSHOT_BYTES });
    if (bytes.length !== row.byteLength || contentHash(bytes) !== id) throw new Error("travel_snapshot_corrupt: stored bytes do not match the identity");
    const snapshot = JSON.parse(bytes.toString("utf8")) as TravelSnapshot;
    rememberIdentity(snapshot, id);
    return snapshot;
  }

  /** Nodes a travel snapshot job must cover for this version: the depot and every stop with demand, in pipeline order. */
  travelSnapshotNodes(versionId: string) {
    const document = this.versionDocument(versionId).document as unknown as ScenarioDocument;
    return stopNodes(document.depot, demandStops(document));
  }

  /**
   * Stores the snapshot a leased `travel_snapshot` run built, for the run's owner. The server re-validates and
   * re-hashes it (the claimed identity must match), requires it to bind to the run's version without missing
   * or moved nodes, and refuses once cancellation was requested, all in the write transaction, so a cancelled
   * build never leaves a snapshot behind.
   */
  storeLeaseTravelSnapshot(lease: Lease, input: unknown, claimedId: string, now = Date.now()) {
    parseContract("Lease", lease);
    const snapshot = normalizeSnapshot(input);
    const bytes = Buffer.from(canonical(snapshot));
    if (bytes.length > MAX_SNAPSHOT_BYTES) throw new Error(`travel_snapshot_too_large: ${bytes.length} bytes exceed ${MAX_SNAPSHOT_BYTES}`);
    const id = contentHash(bytes);
    if (id !== claimedId) throw new Error("travel_snapshot_hash_mismatch: the snapshot does not match its claimed identity");
    if (snapshot.provider !== "valhalla") throw new Error("invalid_travel_snapshot: provider must be valhalla");
    return this.db.transaction(tx => {
      const job = tx.select().from(s.jobs).where(eq(s.jobs.id, lease.job_id)).get();
      assertLease(job, lease, now);
      if (job!.cancelRequested) throw new Error("cancel_requested");
      const run = tx.select().from(s.runs).where(eq(s.runs.id, job!.runId)).get()!;
      if (run.kind !== "travel_snapshot") throw new Error("travel_snapshot_not_job: this run does not build a travel snapshot");
      const binding = bindNodes(snapshot, this.travelSnapshotNodes(run.versionId));
      if (binding.missing.length || binding.moved.length) throw new Error(`travel_snapshot_stale: ${bindingMessage(binding)}`);
      const created = tx.insert(s.travelSnapshots).values({ id, compressed: gzipSync(bytes), byteLength: bytes.length, nodeCount: snapshot.nodes.length, provider: snapshot.provider, providerVersion: snapshot.provider_version, datasetRevision: snapshot.dataset_revision, profile: snapshot.profile, createdAt: now }).onConflictDoNothing().run().changes > 0;
      tx.insert(s.travelSnapshotOwners).values({ snapshotId: id, ownerId: run.ownerId, createdAt: now }).onConflictDoNothing().run();
      return { id, created };
    }, { behavior: "immediate" });
  }

  /** The snapshot a leased run selected, for its worker; any other identity is refused. */
  leaseTravelSnapshot(lease: Lease, snapshotId: string, now = Date.now()) {
    parseContract("Lease", lease);
    const job = this.db.select().from(s.jobs).where(eq(s.jobs.id, lease.job_id)).get();
    assertLease(job, lease, now);
    const run = this.db.select().from(s.runs).where(eq(s.runs.id, job!.runId)).get()!;
    if ((JSON.parse(run.settings) as Snapshot).document.travel_snapshot_id !== snapshotId) throw new Error("travel_snapshot_not_selected: this run did not select that snapshot");
    return this.travelSnapshot(snapshotId);
  }

  /** One sweep: the experiment and all of its runs commit together, or nothing does (no partial sweep). */
  createExperiment(input: { versionId: string; name: string; spec: unknown; comparison: unknown; runs: { settings: Snapshot; varied: unknown }[]; ownerId?: string; admission?: Admission }, idempotencyKey: string, now = Date.now()) {
    if (!idempotencyKey || idempotencyKey.length > 280) throw new Error("invalid_idempotency_key");
    if (!input.runs.length) throw new Error("empty_sweep");
    const ownerId = input.ownerId ?? OPERATOR;
    this.assertSubmitter(input.versionId, ownerId);
    this.assertVersionKind(input.versionId, "pipeline");
    for (const run of input.runs) parseContract("Snapshot", run.settings);
    const loaded = new Map<string, TravelSnapshot>();
    for (const run of input.runs) this.checkTravel(input.versionId, run.settings, loaded);
    const requestHash = contentHash(canonical({ versionId: input.versionId, name: input.name, spec: input.spec, runs: input.runs }));
    return this.db.transaction(tx => {
      const existing = tx.select().from(s.experiments).where(eq(s.experiments.idempotencyKey, idempotencyKey)).get();
      if (existing) {
        if (existing.requestHash !== requestHash || existing.ownerId !== ownerId) throw new Error("idempotency_conflict");
        return existing.id;
      }
      // A sweep is one submission for the active limit, but every child run is a solve admission.
      if (input.admission) admit(tx, input.admission, input.runs.length, now);
      const id = randomUUID();
      tx.insert(s.experiments).values({ id, versionId: input.versionId, name: input.name, spec: canonical(input.spec), comparison: canonical(input.comparison), idempotencyKey, requestHash, createdAt: now, ownerId }).run();
      input.runs.forEach((run, position) => {
        const key = `${idempotencyKey}#${position}`;
        const runId = insertRun(tx, input.versionId, run.settings, key, contentHash(canonical({ versionId: input.versionId, settings: run.settings })), now + position, 3, "pipeline", ownerId);
        tx.insert(s.experimentRuns).values({ id: randomUUID(), experimentId: id, runId, position, varied: canonical(run.varied) }).run();
      });
      return id;
    }, { behavior: "immediate" });
  }

  experiment(id: string) {
    const row = this.db.select().from(s.experiments).where(eq(s.experiments.id, id)).get();
    if (!row) return null;
    const ownerId = row.ownerId;
    const members = this.db.select({ runId: s.experimentRuns.runId, position: s.experimentRuns.position, varied: s.experimentRuns.varied, status: s.runs.status, settings: s.runs.settings })
      .from(s.experimentRuns).innerJoin(s.runs, eq(s.runs.id, s.experimentRuns.runId))
      .where(eq(s.experimentRuns.experimentId, id)).orderBy(asc(s.experimentRuns.position)).all();
    return {
      id: row.id, versionId: row.versionId, name: row.name, createdAt: row.createdAt, ownerId,
      spec: JSON.parse(row.spec) as unknown, comparison: JSON.parse(row.comparison) as unknown,
      runs: members.map(m => ({ runId: m.runId, position: m.position, status: m.status, varied: JSON.parse(m.varied) as Record<string, unknown>, settings: (JSON.parse(m.settings) as Snapshot).document })),
    };
  }

  saveComparison(id: string, comparison: unknown) {
    const changed = this.db.update(s.experiments).set({ comparison: canonical(comparison) }).where(eq(s.experiments.id, id)).run();
    if (!changed.changes) throw new Error("experiment_not_found");
  }

  /** Sweeps on bundled examples, plus those on `ownerId`'s scenarios. */
  listExperiments(limit = 50, ownerId: string | null = null) {
    return this.sqlite.prepare(`SELECT e.id, e.name, e.versionId, e.createdAt, count(er.id) AS runs,
      sum(CASE WHEN r.status IN ('succeeded','failed','cancelled','interrupted') THEN 1 ELSE 0 END) AS finished
      FROM experiments e JOIN scenario_versions v ON v.id=e.versionId JOIN scenarios sc ON sc.id=v.scenarioId
      LEFT JOIN experiment_runs er ON er.experimentId=e.id LEFT JOIN runs r ON r.id=er.runId
      WHERE sc.ownerId='examples' OR sc.ownerId=?
      GROUP BY e.id ORDER BY e.createdAt DESC, e.id DESC LIMIT ?`).all(ownerId ?? "", limit) as { id: string; name: string; versionId: string; createdAt: number; runs: number; finished: number }[];
  }

  /** Sliding-window budget shared by every caller of `bucket`; records `cost` only when it fits. */
  spendRate(bucket: string, cost: number, limit: number, windowMs: number, now = Date.now()) {
    if (!Number.isSafeInteger(cost) || cost < 1) throw new Error("invalid_rate_cost");
    return this.db.transaction(tx => spend(tx, bucket, cost, limit, windowMs, now), { behavior: "immediate" });
  }

  /** Admission for work that is not a run (geocoding, uploads): checks and charges in one transaction, then calls `fn`. */
  admitWork<T>(admission: Admission, cost: number, fn: () => T, now = Date.now()): T {
    return this.db.transaction(tx => { admit(tx, admission, cost, now); return fn(); }, { behavior: "immediate" });
  }

  /** How much of each window a bucket has used, for quota displays. */
  rateUsage(bucket: string, windowMs: number, now = Date.now()) {
    const rows = this.db.select({ cost: s.rateEvents.cost, at: s.rateEvents.at }).from(s.rateEvents)
      .where(and(eq(s.rateEvents.bucket, bucket), sql`${s.rateEvents.at} > ${now - windowMs}`)).orderBy(asc(s.rateEvents.at)).all();
    return { used: rows.reduce((n, r) => n + r.cost, 0), resetsAt: rows.length ? rows[0].at + windowMs : null };
  }

  /** Unfinished submissions of one owner: a sweep counts once, as does a geocoding job. */
  activeSubmissions(ownerId: string) { return activeSubmissions(this.db, ownerId); }

  /** The owner of a version's scenario ("examples" for the bundled synthetic scenarios). */
  versionOwner(versionId: string) {
    const row = this.db.select({ ownerId: s.scenarios.ownerId }).from(s.versions).innerJoin(s.scenarios, eq(s.scenarios.id, s.versions.scenarioId)).where(eq(s.versions.id, versionId)).get();
    if (!row) throw new Error("version_not_found");
    return row.ownerId;
  }

  scenarioOwner(scenarioId: string) {
    return this.db.select({ ownerId: s.scenarios.ownerId }).from(s.scenarios).where(eq(s.scenarios.id, scenarioId)).get()?.ownerId ?? null;
  }

  /** Job admission: a run may only be queued on a bundled example or on the submitter's own scenario. */
  private assertSubmitter(versionId: string, ownerId: string) {
    const row = this.db.select({ ownerId: s.scenarios.ownerId }).from(s.versions).innerJoin(s.scenarios, eq(s.scenarios.id, s.versions.scenarioId)).where(eq(s.versions.id, versionId)).get();
    if (!row) return; // the insert's foreign key reports a missing version
    if (row.ownerId !== EXAMPLES_OWNER && row.ownerId !== ownerId) throw new Error("version_not_found");
  }

  /**
   * Solver Lab instances (`kind: "lab_instance"` documents) run only as `lab` runs, and lab runs only on them, so a
   * lab version never reaches the fulfillment pipeline and a scenario never reaches the lab solver.
   */
  private assertVersionKind(versionId: string, kind: RunKind) {
    const row = this.sqlite.prepare("SELECT json_extract(document, '$.document.kind') AS kind FROM scenario_versions WHERE id=?").get(versionId) as { kind: string | null } | undefined;
    if (!row) return; // the insert's foreign key reports a missing version
    const lab = row.kind === "lab_instance";
    if (kind === "lab" && !lab) throw new Error("lab_version_required");
    if (kind !== "lab" && lab) throw new Error("version_not_found");
  }

  /**
   * Deletes scenarios with every version, branch made from them, run, sweep, geocoding job, cache entry and
   * saved request, then content no longer referenced. Refused while any affected run or job is unfinished.
   */
  deleteScenarios(scenarioIds: string[]) {
    return this.sqlite.transaction(() => {
      if (!scenarioIds.length) return { scenarios: 0, runs: 0 };
      const seed = scenarioIds.map(() => "?").join(",");
      const scenarios = (this.sqlite.prepare(`WITH RECURSIVE doomed(id) AS (SELECT id FROM scenarios WHERE id IN (${seed})
        UNION SELECT v2.scenarioId FROM scenario_versions v2 JOIN scenario_versions v1 ON v2.parentVersionId=v1.id JOIN doomed d ON d.id=v1.scenarioId)
        SELECT id FROM doomed`).all(...scenarioIds) as { id: string }[]).map(r => r.id);
      const list = (rows: { id: string }[]) => rows.map(r => r.id);
      const marks = (n: unknown[]) => n.map(() => "?").join(",") || "NULL";
      const versions = list(this.sqlite.prepare(`SELECT id FROM scenario_versions WHERE scenarioId IN (${marks(scenarios)})`).all(...scenarios) as { id: string }[]);
      const runs = list(this.sqlite.prepare(`SELECT id FROM runs WHERE versionId IN (${marks(versions)})`).all(...versions) as { id: string }[]);
      const busy = this.sqlite.prepare(`SELECT count(*) AS n FROM jobs WHERE runId IN (${marks(runs)}) AND status IN ('queued','claimed','running')`).get(...runs) as { n: number };
      const geocoding = this.sqlite.prepare(`SELECT count(*) AS n FROM geocode_jobs WHERE (versionId IN (${marks(versions)}) OR resultVersionId IN (${marks(versions)})) AND status IN ('queued','running')`).get(...versions, ...versions) as { n: number };
      if (busy.n || geocoding.n) throw new Error("active_work");
      this.deleteRuns(runs);
      const experiments = list(this.sqlite.prepare(`SELECT id FROM experiments WHERE versionId IN (${marks(versions)})`).all(...versions) as { id: string }[]);
      this.sqlite.prepare(`DELETE FROM experiment_runs WHERE experimentId IN (${marks(experiments)})`).run(...experiments);
      this.sqlite.prepare(`DELETE FROM experiments WHERE id IN (${marks(experiments)})`).run(...experiments);
      this.sqlite.prepare(`DELETE FROM geocode_jobs WHERE versionId IN (${marks(versions)}) OR resultVersionId IN (${marks(versions)})`).run(...versions, ...versions);
      this.sqlite.prepare(`DELETE FROM scenario_saves WHERE scenarioId IN (${marks(scenarios)})`).run(...scenarios);
      this.sqlite.prepare(`DELETE FROM scenario_sources WHERE versionId IN (${marks(versions)})`).run(...versions);
      // Children before parents: newest revision first, and branches (revision 1 with a parent) last of all.
      const ordered = this.sqlite.prepare(`SELECT id FROM scenario_versions WHERE scenarioId IN (${marks(scenarios)}) ORDER BY (parentVersionId IS NOT NULL AND revision=1) DESC, createdAt DESC, revision DESC`).all(...scenarios) as { id: string }[];
      const remove = this.sqlite.prepare("DELETE FROM scenario_versions WHERE id=?");
      this.sqlite.pragma("defer_foreign_keys = ON");
      for (const v of ordered) remove.run(v.id);
      this.sqlite.prepare(`DELETE FROM scenarios WHERE id IN (${marks(scenarios)})`).run(...scenarios);
      this.purgeUnreferenced();
      return { scenarios: scenarios.length, runs: runs.length };
    }).immediate();
  }

  /** Everything an owner has: scenarios (with their runs), synthetic runs and sweeps they submitted, snapshot links, scoped caches and quota ledger. */
  deleteOwnerData(ownerId: string) {
    if (ownerId === EXAMPLES_OWNER || ownerId === PUBLIC_OWNER) throw new Error("invalid_owner");
    return this.sqlite.transaction(() => {
      const scenarios = (this.sqlite.prepare("SELECT id FROM scenarios WHERE ownerId=?").all(ownerId) as { id: string }[]).map(r => r.id);
      const own = this.sqlite.prepare("SELECT count(*) AS n FROM runs r JOIN jobs j ON j.runId=r.id WHERE r.ownerId=? AND j.status IN ('queued','claimed','running')").get(ownerId) as { n: number };
      if (own.n) throw new Error("active_work");
      const deleted = this.deleteScenarios(scenarios);
      const runs = (this.sqlite.prepare("SELECT id FROM runs WHERE ownerId=?").all(ownerId) as { id: string }[]).map(r => r.id);
      const experiments = (this.sqlite.prepare("SELECT id FROM experiments WHERE ownerId=?").all(ownerId) as { id: string }[]).map(r => r.id);
      for (const id of experiments) this.sqlite.prepare("DELETE FROM experiment_runs WHERE experimentId=?").run(id);
      this.sqlite.prepare("DELETE FROM experiments WHERE ownerId=?").run(ownerId);
      this.deleteRuns(runs);
      this.sqlite.prepare("DELETE FROM travel_snapshot_owners WHERE ownerId=?").run(ownerId);
      this.sqlite.prepare("DELETE FROM travel_snapshots WHERE id NOT IN (SELECT snapshotId FROM travel_snapshot_owners)").run();
      this.sqlite.prepare("DELETE FROM geocode_cache WHERE key LIKE ? ESCAPE '\\'").run(`${ownerId.replace(/[\\%_]/g, c => `\\${c}`)}|%`);
      this.sqlite.prepare("DELETE FROM rate_events WHERE bucket LIKE ? ESCAPE '\\'").run(`%${ownerId.replace(/[\\%_]/g, c => `\\${c}`)}%`);
      this.purgeUnreferenced();
      return { scenarios: deleted.scenarios, runs: deleted.runs + runs.length };
    }).immediate();
  }

  private deleteRuns(runs: string[]) {
    for (const runId of runs) {
      const job = this.sqlite.prepare("SELECT id FROM jobs WHERE runId=?").get(runId) as { id: string } | undefined;
      this.sqlite.prepare("DELETE FROM experiment_runs WHERE runId=?").run(runId);
      this.sqlite.prepare("DELETE FROM stage_cache WHERE runId=?").run(runId);
      this.sqlite.prepare("DELETE FROM run_artifacts WHERE runId=?").run(runId);
      this.sqlite.prepare("DELETE FROM cluster_jobs WHERE runId=?").run(runId);
      if (job) {
        this.sqlite.prepare("DELETE FROM job_events WHERE jobId=?").run(job.id);
        this.sqlite.prepare("DELETE FROM job_attempts WHERE jobId=?").run(job.id);
        this.sqlite.prepare("DELETE FROM jobs WHERE id=?").run(job.id);
      }
      this.sqlite.prepare("DELETE FROM runs WHERE id=?").run(runId);
    }
  }

  /** Content-addressed artifacts that no run, cache entry or geocoding answer references any more. */
  private purgeUnreferenced() {
    this.sqlite.prepare(`DELETE FROM artifacts WHERE hash NOT IN (SELECT artifactHash FROM run_artifacts)
      AND hash NOT IN (SELECT artifactHash FROM stage_cache) AND hash NOT IN (SELECT responseRef FROM geocode_cache WHERE responseRef IS NOT NULL)`).run();
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
        tx.insert(s.stageCache).values({ scope: this.cacheScope(job!.runId), inputHash: input.manifest.input_hash, artifactHash: input.manifest.output_hash, manifest: canonical(input.manifest), runId: job!.runId }).onConflictDoNothing().run();
      }
      return { stored: true };
    }, { behavior: "immediate" });
  }

  cachedStage(lease: Lease, inputHash: string, now = Date.now()) {
    parseContract("Lease", lease);
    const job = this.db.select().from(s.jobs).where(eq(s.jobs.id, lease.job_id)).get();
    assertLease(job, lease, now);
    if (!/^[a-f0-9]{64}$/.test(inputHash)) throw new Error("invalid_hash");
    const cached = this.db.select().from(s.stageCache).where(and(eq(s.stageCache.scope, this.cacheScope(job!.runId)), eq(s.stageCache.inputHash, inputHash))).get();
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

  /** Stage reuse scope of a run: its scenario's owner. */
  private cacheScope(runId: string) {
    return this.db.select({ ownerId: s.scenarios.ownerId }).from(s.runs).innerJoin(s.versions, eq(s.versions.id, s.runs.versionId))
      .innerJoin(s.scenarios, eq(s.scenarios.id, s.versions.scenarioId)).where(eq(s.runs.id, runId)).get()!.ownerId;
  }

  /** A version with this exact document owned by `ownerId` (bundled examples use "examples"). */
  findVersion(snapshot: Snapshot, ownerId = EXAMPLES_OWNER) {
    return this.db.select({ id: s.versions.id }).from(s.versions).innerJoin(s.scenarios, eq(s.scenarios.id, s.versions.scenarioId))
      .where(and(eq(s.versions.document, canonical(snapshot)), eq(s.scenarios.ownerId, ownerId))).orderBy(asc(s.versions.createdAt)).get() ?? null;
  }

  versionDocument(versionId: string): Snapshot {
    const version = this.db.select().from(s.versions).where(eq(s.versions.id, versionId)).get();
    if (!version) throw new Error("version_not_found");
    return JSON.parse(version.document) as Snapshot;
  }

  /** Runs on bundled examples, plus runs on `ownerId`'s scenarios. */
  listRuns(limit = 50, ownerId: string | null = null) {
    return this.db.select({ id: s.runs.id, status: s.runs.status, createdAt: s.runs.createdAt, versionId: s.runs.versionId, kind: s.runs.kind, scenarioOwner: s.scenarios.ownerId })
      .from(s.runs).innerJoin(s.versions, eq(s.versions.id, s.runs.versionId)).innerJoin(s.scenarios, eq(s.scenarios.id, s.versions.scenarioId))
      .where(sql`${s.scenarios.ownerId} = ${EXAMPLES_OWNER} OR ${s.scenarios.ownerId} = ${ownerId ?? ""}`)
      .orderBy(sql`${s.runs.createdAt} desc`, sql`${s.runs.id} desc`).limit(limit).all();
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
      id: run.id, versionId: run.versionId, status: run.status, createdAt: run.createdAt, kind: run.kind as RunKind, ownerId: run.ownerId,
      settings: JSON.parse(run.settings) as Snapshot,
      attempt: job.attempt, maxAttempts: job.maxAttempts, cancelRequested: job.cancelRequested,
      events, attempts, artifacts,
      clusters: this.db.select({
        id: s.clusterJobs.id, runId: s.clusterJobs.runId, clusterId: s.clusterJobs.clusterId,
        inputHash: s.clusterJobs.inputHash, status: s.clusterJobs.status, attempt: s.clusterJobs.attempt,
        maxAttempts: s.clusterJobs.maxAttempts, startedAt: s.clusterJobs.startedAt,
        endedAt: s.clusterJobs.endedAt, error: s.clusterJobs.error,
      }).from(s.clusterJobs).where(eq(s.clusterJobs.runId, runId)).all(),
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
export type RunKind = "pipeline" | "explorer" | "travel_snapshot" | "lab";
export const OPERATOR = "operator", EXAMPLES_OWNER = "examples", PUBLIC_OWNER = "public";

/**
 * Persistent admission control (spec §14). `maxActive` bounds one owner's unfinished submissions, `maxQueued`
 * the global queue, and every bucket a sliding window charged `cost` (solve admissions, per account or IP).
 */
export type Admission = { ownerId: string; maxActive?: number; maxQueued?: number; buckets?: { bucket: string; limit: number; windowMs: number; label: string }[] };
export class AdmissionError extends Error {
  override readonly name = "AdmissionError";
  constructor(readonly code: "active_limit" | "queue_full" | "quota_exceeded", message: string, readonly retryAfterMs: number) { super(message); }
}
/** By name, not `instanceof`: bundlers may load this module more than once. */
export const isAdmissionError = (error: unknown): error is AdmissionError => error instanceof Error && error.name === "AdmissionError";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
function spend(tx: Tx, bucket: string, cost: number, limit: number, windowMs: number, now: number, record = true) {
  tx.delete(s.rateEvents).where(sql`${s.rateEvents.at} <= ${now - 7 * 24 * 3_600_000}`).run();
  const used = tx.select({ n: sql<number>`coalesce(sum(${s.rateEvents.cost}), 0)` }).from(s.rateEvents)
    .where(and(eq(s.rateEvents.bucket, bucket), sql`${s.rateEvents.at} > ${now - windowMs}`)).get()!.n;
  if (used + cost > limit) {
    // The window frees enough room once the oldest events that push it over have aged out.
    const events = tx.select({ at: s.rateEvents.at, cost: s.rateEvents.cost }).from(s.rateEvents).where(and(eq(s.rateEvents.bucket, bucket), sql`${s.rateEvents.at} > ${now - windowMs}`)).orderBy(asc(s.rateEvents.at)).all();
    let free = limit - used, at = now;
    for (const e of events) { if (free >= cost) break; free += e.cost; at = e.at + windowMs; }
    return { ok: false as const, used, retryAfterMs: cost > limit ? windowMs : Math.max(1, at - now) };
  }
  if (record) tx.insert(s.rateEvents).values({ id: randomUUID(), bucket, cost, at: now }).run();
  return { ok: true as const, used: used + cost, retryAfterMs: 0 };
}

const ACTIVE_RUN = sql`status IN ('queued','claimed','running')`;
function activeSubmissions(db: DB | Tx, ownerId: string) {
  const row = db.get<{ n: number }>(sql`SELECT
    (SELECT count(*) FROM runs WHERE ownerId=${ownerId} AND ${ACTIVE_RUN} AND id NOT IN (SELECT runId FROM experiment_runs))
    + (SELECT count(DISTINCT er.experimentId) FROM experiment_runs er JOIN runs r ON r.id=er.runId WHERE r.ownerId=${ownerId} AND r.status IN ('queued','claimed','running'))
    + (SELECT count(*) FROM geocode_jobs WHERE ownerId=${ownerId} AND status IN ('queued','running')) AS n`);
  return row.n;
}

function admit(tx: Tx, admission: Admission, cost: number, now: number) {
  if (admission.maxActive !== undefined) {
    const active = activeSubmissions(tx, admission.ownerId);
    if (active + 1 > admission.maxActive) throw new AdmissionError("active_limit", `You already have ${active} unfinished job${active === 1 ? "" : "s"} (limit ${admission.maxActive}). Wait for it to finish or cancel it.`, 15_000);
  }
  if (admission.maxQueued !== undefined) {
    const active = tx.get<{ n: number }>(sql`SELECT count(*) AS n FROM jobs WHERE ${ACTIVE_RUN}`).n;
    if (active + cost > admission.maxQueued) throw new AdmissionError("queue_full", `The solve queue is full (${active} active, limit ${admission.maxQueued}). Try again shortly.`, 30_000);
  }
  // Check every bucket before charging any, so a refusal charges nothing.
  for (const b of admission.buckets ?? []) {
    const result = spend(tx, b.bucket, cost, b.limit, b.windowMs, now, false);
    if (!result.ok) {
      const reset = new Date(now + result.retryAfterMs).toISOString().replace(/\.\d+Z$/, "Z");
      const need = cost === 1 ? "" : `This request needs ${cost} ${b.label}. `;
      throw new AdmissionError("quota_exceeded", cost > b.limit ? `This request needs ${cost} ${b.label}; the limit is ${b.limit}.` : `${need}${result.used} of ${b.limit} ${b.label} are used. Room frees up at ${reset}.`, result.retryAfterMs);
    }
  }
  for (const b of admission.buckets ?? []) spend(tx, b.bucket, cost, b.limit, b.windowMs, now);
}

function insertRun(tx: Tx, versionId: string, settings: Snapshot, idempotencyKey: string, requestHash: string, now: number, maxAttempts: number, kind: RunKind, ownerId: string) {
  const id = randomUUID();
  tx.insert(s.runs).values({ id, versionId, settings: canonical(settings), idempotencyKey, requestHash, createdAt: now, kind, ownerId }).run();
  tx.insert(s.jobs).values({ id: randomUUID(), runId: id, createdAt: now, maxAttempts }).run();
  return id;
}
function assertLease(job: typeof s.jobs.$inferSelect | undefined, lease: Lease, now: number) {
  if (!job || !active.has(job.status) || job.leaseToken !== lease.lease_token || job.workerId !== lease.worker_id || job.attempt !== lease.attempt || (job.leaseExpiresAt ?? 0) <= now) throw new Error("stale_lease");
}

export function defaultDatabasePath(root = process.cwd()) {
  return process.env.DATA_DIR ? join(process.env.DATA_DIR, "fillrate.sqlite") : join(root, "data/dev.sqlite");
}
