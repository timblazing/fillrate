import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { and, eq, asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { parseContract, type ExplorerSummary, type RunSummary, type Snapshot } from "@fillrate/contracts";
import * as s from "./schema";

export { canonical } from "./canonical";
import { canonical } from "./canonical";
export const contentHash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

const ACTIVE = ["queued", "running"];
const FINISHED = ["succeeded", "failed", "cancelled", "interrupted"];
const quoted = (items: string[]) => items.map(x => `'${x}'`).join(",");

/** What the optimizer returned for a finished run. Pipeline runs carry a summary and the stages a replay bundle needs. */
export type RunResult = {
  summary?: RunSummary;
  stages?: { stage: string; output_hash: string; payload: unknown }[];
  explorer?: ExplorerSummary;
  output_hash?: string;
};
export type RunFailure = { code: string; message: string };

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

  /** Inserts one run. `ownerId` is the submitter; it must own the version's scenario unless that is a bundled example. */
  createRun(versionId: string, settings: Snapshot, kind: RunKind = "pipeline", options: { ownerId?: string; status?: "queued" | "running"; now?: number } = {}) {
    parseContract("Snapshot", settings);
    const ownerId = options.ownerId ?? OPERATOR;
    this.assertSubmitter(versionId, ownerId);
    return insertRun(this.db, versionId, settings, options.now ?? Date.now(), kind, ownerId, options.status ?? "queued");
  }

  /** One sweep: the experiment and all of its runs (queued) commit together, or nothing does (no partial sweep). */
  createExperiment(input: { versionId: string; name: string; spec: unknown; comparison: unknown; runs: { settings: Snapshot; varied: unknown }[]; ownerId?: string }, now = Date.now()) {
    if (!input.runs.length) throw new Error("empty_sweep");
    const ownerId = input.ownerId ?? OPERATOR;
    this.assertSubmitter(input.versionId, ownerId);
    for (const run of input.runs) parseContract("Snapshot", run.settings);
    return this.db.transaction(tx => {
      const id = randomUUID();
      tx.insert(s.experiments).values({ id, versionId: input.versionId, name: input.name, spec: canonical(input.spec), comparison: canonical(input.comparison), createdAt: now, ownerId }).run();
      const runIds = input.runs.map((run, position) => {
        const runId = insertRun(tx, input.versionId, run.settings, now + position, "pipeline", ownerId, "queued");
        tx.insert(s.experimentRuns).values({ id: randomUUID(), experimentId: id, runId, position, varied: canonical(run.varied) }).run();
        return runId;
      });
      return { id, runIds };
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
      sum(CASE WHEN r.status IN (${quoted(FINISHED)}) THEN 1 ELSE 0 END) AS finished
      FROM experiments e JOIN scenario_versions v ON v.id=e.versionId JOIN scenarios sc ON sc.id=v.scenarioId
      LEFT JOIN experiment_runs er ON er.experimentId=e.id LEFT JOIN runs r ON r.id=er.runId
      WHERE sc.ownerId='examples' OR sc.ownerId=?
      GROUP BY e.id ORDER BY e.createdAt DESC, e.id DESC LIMIT ?`).all(ownerId ?? "", limit) as { id: string; name: string; versionId: string; createdAt: number; runs: number; finished: number }[];
  }

  /** The owner of a version's scenario ("examples" for the bundled synthetic scenarios). */
  versionOwner(versionId: string) {
    const row = this.db.select({ ownerId: s.scenarios.ownerId }).from(s.versions).innerJoin(s.scenarios, eq(s.scenarios.id, s.versions.scenarioId)).where(eq(s.versions.id, versionId)).get();
    if (!row) throw new Error("version_not_found");
    return row.ownerId;
  }

  /** The scenario a version belongs to, with its owner, or null for an unknown version. */
  versionScenario(versionId: string) {
    return this.db.select({ scenarioId: s.versions.scenarioId, ownerId: s.scenarios.ownerId }).from(s.versions).innerJoin(s.scenarios, eq(s.scenarios.id, s.versions.scenarioId)).where(eq(s.versions.id, versionId)).get() ?? null;
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
      const busy = this.sqlite.prepare(`SELECT count(*) AS n FROM runs WHERE id IN (${marks(runs)}) AND status IN (${quoted(ACTIVE)})`).get(...runs) as { n: number };
      const geocoding = this.sqlite.prepare(`SELECT count(*) AS n FROM geocode_jobs WHERE (versionId IN (${marks(versions)}) OR resultVersionId IN (${marks(versions)})) AND status IN ('queued','running')`).get(...versions, ...versions) as { n: number };
      if (busy.n || geocoding.n) throw new Error("active_work");
      this.deleteRuns(runs);
      const experiments = list(this.sqlite.prepare(`SELECT id FROM experiments WHERE versionId IN (${marks(versions)})`).all(...versions) as { id: string }[]);
      this.sqlite.prepare(`DELETE FROM experiment_runs WHERE experimentId IN (${marks(experiments)})`).run(...experiments);
      this.sqlite.prepare(`DELETE FROM experiments WHERE id IN (${marks(experiments)})`).run(...experiments);
      this.sqlite.prepare(`DELETE FROM geocode_jobs WHERE versionId IN (${marks(versions)}) OR resultVersionId IN (${marks(versions)})`).run(...versions, ...versions);
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

  private deleteRuns(runs: string[]) {
    for (const runId of runs) {
      this.sqlite.prepare("DELETE FROM experiment_runs WHERE runId=?").run(runId);
      this.sqlite.prepare("DELETE FROM run_artifacts WHERE runId=?").run(runId);
      this.sqlite.prepare("DELETE FROM runs WHERE id=?").run(runId);
    }
  }

  /** Stored blobs that no older run or geocoding answer references any more. */
  private purgeUnreferenced() {
    this.sqlite.prepare(`DELETE FROM artifacts WHERE hash NOT IN (SELECT artifactHash FROM run_artifacts)
      AND hash NOT IN (SELECT responseRef FROM geocode_cache WHERE responseRef IS NOT NULL)`).run();
  }

  /** Moves a queued run to running. False when it was cancelled (or otherwise ended) while it waited. */
  startRun(runId: string) {
    return this.sqlite.prepare("UPDATE runs SET status='running' WHERE id=? AND status IN ('queued','running')").run(runId).changes > 0;
  }

  /** Records the outcome of an active run. False when it already ended (for example, it was cancelled). */
  finishRun(runId: string, outcome: { status: "succeeded"; result: RunResult } | { status: "failed"; error: RunFailure } | { status: "cancelled" }, now = Date.now()) {
    const result = outcome.status === "succeeded" ? JSON.stringify(outcome.result) : null;
    const error = outcome.status === "failed" ? JSON.stringify(outcome.error) : null;
    return this.sqlite.prepare(`UPDATE runs SET status=?, result=?, error=?, finishedAt=? WHERE id=? AND status IN ('queued','running')`).run(outcome.status, result, error, now, runId).changes > 0;
  }

  /** Marks a queued or running run cancelled; returns the status it had, or null if it had already ended. */
  cancelRun(runId: string, now = Date.now()) {
    const row = this.sqlite.prepare("SELECT status FROM runs WHERE id=?").get(runId) as { status: string } | undefined;
    if (!row) throw new Error("run_not_found");
    return this.finishRun(runId, { status: "cancelled" }, now) ? row.status : null;
  }

  /** On startup: no solve survives a restart, so any unfinished run is failed. */
  failInterruptedRuns(now = Date.now()) {
    const error = JSON.stringify({ code: "interrupted", message: "interrupted (server restarted)" } satisfies RunFailure);
    return this.sqlite.prepare(`UPDATE runs SET status='failed', error=?, finishedAt=? WHERE status IN (${quoted(ACTIVE)})`).run(error, now).changes;
  }

  /** The payload the optimizer's `/solve` takes for a run. */
  solveInput(runId: string) {
    const run = this.db.select().from(s.runs).where(eq(s.runs.id, runId)).get();
    if (!run) throw new Error("run_not_found");
    return { kind: run.kind as RunKind, scenario: this.versionDocument(run.versionId).document, settings: (JSON.parse(run.settings) as Snapshot).document };
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

  /** A run's identity, settings and status; the result is read separately with `runResult`. */
  runView(runId: string) {
    const run = this.db.select({ id: s.runs.id, versionId: s.runs.versionId, status: s.runs.status, createdAt: s.runs.createdAt, finishedAt: s.runs.finishedAt, kind: s.runs.kind, ownerId: s.runs.ownerId, settings: s.runs.settings, error: s.runs.error })
      .from(s.runs).where(eq(s.runs.id, runId)).get();
    if (!run) return null;
    return {
      id: run.id, versionId: run.versionId, status: run.status, createdAt: run.createdAt, finishedAt: run.finishedAt, kind: run.kind as RunKind, ownerId: run.ownerId,
      settings: JSON.parse(run.settings) as Snapshot,
      error: run.error ? JSON.parse(run.error) as RunFailure : null,
    };
  }

  /** The stored result of a succeeded run; runs made before direct solves are rebuilt from their stored artifacts. */
  runResult(runId: string): RunResult | null {
    const row = this.db.select({ result: s.runs.result, status: s.runs.status }).from(s.runs).where(eq(s.runs.id, runId)).get();
    if (!row) return null;
    if (row.result) return JSON.parse(row.result) as RunResult;
    if (row.status !== "succeeded") return null;
    const legacy = this.db.select({ manifest: s.runArtifacts.manifest, hash: s.runArtifacts.artifactHash }).from(s.runArtifacts).where(eq(s.runArtifacts.runId, runId)).all()
      .map(a => ({ stage: (JSON.parse(a.manifest) as { stage_type: string }).stage_type, hash: a.hash }));
    if (!legacy.length) return null;
    const read = (stage: string) => { const hit = legacy.find(a => a.stage === stage); return hit ? this.readArtifact(hit.hash) : undefined; };
    if (legacy.some(a => a.stage === "explorer")) return { explorer: read("explorer") as ExplorerSummary, output_hash: legacy.find(a => a.stage === "explorer")!.hash };
    return {
      summary: read("summary") as RunSummary,
      stages: ["preflight", "allocation", "aggregation", "clustering"].flatMap(stage => { const hit = legacy.find(a => a.stage === stage); return hit ? [{ stage, output_hash: hit.hash, payload: this.readArtifact(hit.hash) }] : []; }),
    };
  }

  runCounts() {
    const rows = this.sqlite.prepare("SELECT status, count(*) AS n FROM runs GROUP BY status").all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map(r => [r.status, r.n])) as Record<string, number>;
  }

  /** Reads a stored blob (an older run's stage output). */
  readArtifact(hash: string): unknown {
    const artifact = this.db.select().from(s.artifacts).where(eq(s.artifacts.hash, hash)).get();
    if (!artifact) throw new Error("artifact_not_found");
    const bytes = gunzipSync(artifact.compressed, { maxOutputLength: 64 * 1024 * 1024 });
    if (bytes.length !== artifact.byteLength || contentHash(bytes) !== hash) throw new Error("artifact_corrupt");
    return JSON.parse(bytes.toString("utf8"));
  }
}
export type RunKind = "pipeline" | "explorer";
export const OPERATOR = "operator", EXAMPLES_OWNER = "examples";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0] | DB;

function insertRun(tx: Tx, versionId: string, settings: Snapshot, now: number, kind: RunKind, ownerId: string, status: string) {
  const id = randomUUID();
  tx.insert(s.runs).values({ id, versionId, settings: canonical(settings), status, createdAt: now, kind, ownerId }).run();
  return id;
}

export function defaultDatabasePath(root = process.cwd()) {
  return process.env.DATA_DIR ? join(process.env.DATA_DIR, "fillrate.sqlite") : join(root, "data/dev.sqlite");
}
