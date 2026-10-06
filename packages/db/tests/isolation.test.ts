// Hosted accounts (spec §14, v1.10): owner isolation for every stored kind, owner-scoped caches, persistent
// admission control under concurrency and restart, deletion semantics and the migration of existing data.
import { afterEach, beforeEach, expect, test } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AdmissionError, canonical, contentHash, openDatabase, type Admission, type ArtifactInput, type Store } from "../src/index";
import { saveScenario, scenarioList, scenarioVersion } from "../src/scenarios";
import { createGeocodeJob, geocodeJob } from "../src/geocode";
import { accessFor, decideAccess, saveAccessNote } from "../src/access-requests";
import type { Lease } from "@fillrate/contracts";
import example from "../../../examples/m1-synthetic.json";

const parity = JSON.parse(readFileSync(resolve("packages/contracts/fixtures/travel-parity.json"), "utf8")) as { scenario: never; snapshot: unknown; identity: string };
const metadata = { timezone: "America/Chicago", planningDate: "2026-09-30", browserId: "test-browser" };
const A = "user:a", B = "user:b", DAY = 86_400_000;
let dir: string, path: string, store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fillrate-isolation-")); path = join(dir, "test.sqlite"); store = openDatabase(path); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const save = (ownerId: string, extra: Record<string, unknown> = {}) => saveScenario(store, { document: structuredClone(example.scenario), author: "Tester", metadata, source: { ordersCsv: "x" }, ownerId, ...extra });
const settings = (n = 0) => ({ schema_version: 1 as const, document: { n } });
const quota = (ownerId: string, extra: Partial<Admission> = {}): Admission => ({ ownerId, maxActive: 1, maxQueued: 10, buckets: [{ bucket: `solves:${ownerId}`, limit: 3, windowMs: DAY, label: "daily solve admissions" }], ...extra });
const enqueue = (versionId: string, ownerId: string, key: string = randomUUID(), now = 1_000_000, admission?: Admission) =>
  store.enqueue(versionId, settings(), key, now, 3, "pipeline", { ownerId, admission });
const admissionCode = (fn: () => unknown) => { try { fn(); return null; } catch (error) { return error instanceof AdmissionError ? error.code : (error as Error).message; } };
function artifact(lease: Lease, inputHash: string): ArtifactInput {
  const payload = { allocated: inputHash.slice(0, 4) };
  return { payload, manifest: { schema_version: 1, stage_type: "allocation", input_hash: inputHash, output_hash: contentHash(canonical(payload)), producer_version: "t/1", adapter_version: "t/1", parent_hashes: [], effective_settings: {}, created_at_ms: 1, execution_id: lease.lease_token, reused_from: null } };
}

test("one account cannot list, read, write, branch or queue work on another's scenarios", () => {
  const a = save(A);
  expect(scenarioList(store, A)).toHaveLength(1);
  expect(scenarioList(store, B)).toHaveLength(0);
  expect(scenarioList(store, "operator")).toHaveLength(0);
  expect(() => scenarioVersion(store, a.scenarioId, a.versionId, B)).toThrow("scenario_not_found");
  expect(() => save(B, { scenarioId: a.scenarioId, expectedVersionId: a.versionId })).toThrow("scenario_not_found");
  expect(() => save(B, { scenarioId: a.scenarioId, expectedVersionId: a.versionId, branch: true })).toThrow("scenario_not_found");
  expect(() => enqueue(a.versionId, B)).toThrow("version_not_found");
  expect(() => store.createExperiment({ versionId: a.versionId, name: "x", spec: {}, comparison: {}, runs: [{ settings: settings(), varied: {} }], ownerId: B }, "sweep-b")).toThrow("version_not_found");
  // A guessed idempotency key replayed by another account is a conflict, never the other account's result.
  const keyed = save(A, { idempotencyKey: "same-key" });
  expect(() => save(B, { idempotencyKey: "same-key" })).toThrow("idempotency_conflict");
  const runId = enqueue(a.versionId, A, "run-key");
  expect(() => store.enqueue(a.versionId, settings(), "run-key", 1, 3, "pipeline", { ownerId: B })).toThrow(/version_not_found|idempotency_conflict/);
  expect(store.listRuns(50, B).map(r => r.id)).not.toContain(runId);
  expect(store.listRuns(50, A).map(r => r.id)).toContain(runId);
  expect(keyed.scenarioId).not.toBe(a.scenarioId);
});

test("bundled examples stay public, and a matching imported document never stands in for the example", () => {
  const mine = save(A);
  expect(store.findVersion({ schema_version: 1, document: example.scenario } as never)).toBeNull();
  const examples = store.createScenario("Example", { schema_version: 1, document: example.scenario } as never, "Fillrate examples", 1, "examples");
  expect(store.findVersion({ schema_version: 1, document: example.scenario } as never)?.id).toBe(examples.versionId);
  const runA = enqueue(examples.versionId, A), runPublic = enqueue(examples.versionId, "public");
  for (const owner of [A, B, null]) expect(store.listRuns(50, owner).map(r => r.id)).toEqual(expect.arrayContaining([runA, runPublic]));
  expect(store.versionOwner(mine.versionId)).toBe(A);
});

test("stage reuse is scoped to the scenario's owner", () => {
  const a = save(A), b = save(B);
  const hash = "c".repeat(64);
  enqueue(a.versionId, A);
  const first = store.claim("w1", 1_000_001)!.lease;
  store.checkpoint(first, artifact(first, hash), 1_000_002);
  enqueue(b.versionId, B, undefined, 1_000_003);
  enqueue(a.versionId, A, undefined, 1_000_004);
  const second = store.claim("w2", 1_000_005)!.lease; // B's run, identical inputs
  expect(store.cachedStage(second, hash, 1_000_006)).toBeNull();
  const third = store.claim("w3", 1_000_007)!.lease; // A's second run
  expect(store.cachedStage(third, hash, 1_000_008)).not.toBeNull();
});

test("travel snapshots and geocoding jobs need their owner; content hashes are not access", () => {
  const a = save(A), b = save(B);
  store.saveTravelSnapshot(parity.snapshot, 1, A);
  expect(store.travelSnapshotInfo(parity.identity, A)).not.toBeNull();
  expect(store.travelSnapshotInfo(parity.identity, B)).toBeNull();
  const roadVersion = store.createScenario("Parity", { schema_version: 1, document: parity.scenario }, "T", 1, B).versionId;
  expect(() => store.enqueue(roadVersion, { schema_version: 1, document: { travel_snapshot_id: parity.identity } }, "b-road", 1, 3, "pipeline", { ownerId: B })).toThrow("travel_snapshot_not_found");
  // Uploading the same content gives B its own link; storage stays deduplicated.
  expect(store.saveTravelSnapshot(parity.snapshot, 2, B)).toMatchObject({ created: false, id: parity.identity });
  expect(() => store.enqueue(roadVersion, { schema_version: 1, document: { travel_snapshot_id: parity.identity } }, "b-road", 1, 3, "pipeline", { ownerId: B })).not.toThrow();

  const job = createGeocodeJob(store, { versionId: a.versionId, options: {}, author: "A", metadata, idempotencyKey: "g1", ownerId: A });
  expect(geocodeJob(store, job.id, A)).not.toBeNull();
  expect(geocodeJob(store, job.id, B)).toBeNull();
  expect(() => createGeocodeJob(store, { versionId: a.versionId, options: {}, author: "B", metadata, idempotencyKey: "g2", ownerId: B })).toThrow("version_not_found");
  expect(() => createGeocodeJob(store, { versionId: b.versionId, options: {}, author: "B", metadata, idempotencyKey: "g1", ownerId: B })).toThrow("idempotency_conflict");
});

test("admission: one unfinished job, daily solves charged at admission, sweeps charged per run", () => {
  const a = save(A);
  const now = 5 * DAY;
  const first = enqueue(a.versionId, A, "k1", now, quota(A));
  expect(admissionCode(() => enqueue(a.versionId, A, "k2", now, quota(A)))).toBe("active_limit");
  // Replaying the admitted request is idempotent and costs nothing.
  expect(enqueue(a.versionId, A, "k1", now, quota(A))).toBe(first);
  expect(store.rateUsage(`solves:${A}`, DAY, now).used).toBe(1);
  // Cancelling frees the active slot but not the admission already charged.
  store.cancel(first);
  store.cancel(enqueue(a.versionId, A, "k2", now + 1, quota(A)));
  store.cancel(enqueue(a.versionId, A, "k3", now + 2, quota(A)));
  expect(store.rateUsage(`solves:${A}`, DAY, now + 2).used).toBe(3);
  try { enqueue(a.versionId, A, "k4", now + 3, quota(A)); expect.unreachable(); }
  catch (error) {
    expect(error).toBeInstanceOf(AdmissionError);
    expect((error as AdmissionError).code).toBe("quota_exceeded");
    expect((error as AdmissionError).retryAfterMs).toBe(DAY - 3); // the first admission ages out
    expect((error as Error).message).toMatch(/3 of 3 daily solve admissions are used. Room frees up at \d{4}-\d\d-\d\dT/);
  }
  // A refused request charges nothing, and the window reopens a day after the first admission.
  expect(store.rateUsage(`solves:${A}`, DAY, now + 3).used).toBe(3);
  expect(admissionCode(() => enqueue(a.versionId, A, "k5", now + DAY + 1, quota(A)))).toBeNull();

  // A sweep is one unfinished job but one admission per child run; an oversized sweep is refused whole.
  const b = save(B);
  const sweep = (key: string, runs: number, at: number) => store.createExperiment({ versionId: b.versionId, name: "s", spec: {}, comparison: {}, ownerId: B, admission: quota(B), runs: Array.from({ length: runs }, (_, i) => ({ settings: settings(i), varied: { i } })) }, key, at);
  expect(admissionCode(() => sweep("too-big", 4, now))).toBe("quota_exceeded");
  expect(store.listExperiments(50, B)).toHaveLength(0);
  sweep("ok", 3, now);
  expect(store.activeSubmissions(B)).toBe(1);
  expect(store.rateUsage(`solves:${B}`, DAY, now).used).toBe(3);
});

test("admission: the global queue bound counts every account", () => {
  const a = save(A), b = save(B);
  enqueue(a.versionId, A, "a1", 1, quota(A, { maxQueued: 2, maxActive: 5 }));
  enqueue(a.versionId, A, "a2", 1, quota(A, { maxQueued: 2, maxActive: 5 }));
  expect(admissionCode(() => enqueue(b.versionId, B, "b1", 1, quota(B, { maxQueued: 2 })))).toBe("queue_full");
});

test("concurrent admissions for one account admit exactly one job, across processes", async () => {
  const a = save(A);
  const runner = resolve("packages/db/tests/admit-worker.ts");
  const outputs = await Promise.all(Array.from({ length: 6 }, (_, i) => promisify(execFile)(process.execPath, ["--import", "tsx", runner, path, a.versionId, `race-${i}`])));
  const results = outputs.map(o => JSON.parse(o.stdout) as { id?: string; error?: string });
  expect(results.filter(r => r.id)).toHaveLength(1);
  expect(results.filter(r => r.error).every(r => /unfinished job/.test(r.error!))).toBe(true);
  expect(store.rateUsage(`solves:${A}`, DAY).used).toBe(1);
});

test("quota usage survives a restart", () => {
  const a = save(A);
  const now = Date.now();
  for (const key of ["r1", "r2", "r3"]) store.cancel(enqueue(a.versionId, A, key, now, quota(A)));
  store.close();
  store = openDatabase(path);
  expect(admissionCode(() => enqueue(a.versionId, A, "r4", now + 1, quota(A)))).toBe("quota_exceeded");
});

test("deleting a scenario or an account removes what it owns and nothing else", () => {
  const a = save(A);
  save(B);
  const branch = save(A, { scenarioId: a.scenarioId, expectedVersionId: a.versionId, branch: true });
  const run = enqueue(a.versionId, A);
  expect(() => store.deleteScenarios([a.scenarioId])).toThrow("active_work");
  const lease = store.claim("w", 1_000_001)!.lease;
  store.checkpoint(lease, artifact(lease, "d".repeat(64)), 1_000_002);
  store.record({ lease, kind: "succeeded", sequence: 1, payload: {} }, [], 1_000_003);
  expect(store.runView(run)).not.toBeNull();
  // The scenario goes with its branch, run, cached stage and artifacts; B is untouched.
  expect(store.deleteScenarios([a.scenarioId])).toEqual({ scenarios: 2, runs: 1 });
  expect(store.runView(run)).toBeNull();
  expect(store.scenarioOwner(branch.scenarioId)).toBeNull();
  expect(store.sqlite.prepare("SELECT count(*) AS n FROM artifacts").get()).toEqual({ n: 0 });
  expect(scenarioList(store, B)).toHaveLength(1);

  save(A);
  store.saveTravelSnapshot(parity.snapshot, 1, A);
  store.saveTravelSnapshot(parity.snapshot, 1, B);
  const removed = store.deleteOwnerData(A);
  expect(removed.scenarios).toBe(1);
  expect(scenarioList(store, A)).toHaveLength(0);
  expect(store.travelSnapshotInfo(parity.identity, B)).not.toBeNull(); // still B's
  store.deleteOwnerData(B);
  expect(store.sqlite.prepare("SELECT count(*) AS n FROM travel_snapshots").get()).toEqual({ n: 0 });
  expect(() => store.deleteOwnerData("examples")).toThrow("invalid_owner");
});

test("migration 0008 keeps existing data operator-owned and the bundled examples public", () => {
  // Build a database at migration 0007, write pre-account data, then apply the real migrations.
  const old = join(dir, "migrations-0007");
  cpSync(resolve("packages/db/migrations"), old, { recursive: true });
  const journalPath = join(old, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 8);
  writeFileSync(journalPath, JSON.stringify(journal));
  rmSync(join(old, "0008_hosted_ownership.sql"));
  const legacyPath = join(dir, "legacy.sqlite");
  const legacy = openDatabase(legacyPath, old);
  // Raw SQL in the 0007 schema: the current store writes owner columns that do not exist yet.
  const insert = (sql: string, ...args: unknown[]) => legacy.sqlite.prepare(sql).run(...args);
  const doc = canonical({ schema_version: 1, document: { n: 1 } });
  for (const [scenario, version] of [["s-ex", "v-ex"], ["s-imp", "v-imp"]]) {
    insert("INSERT INTO scenarios (id,name,createdAt) VALUES (?,?,1)", scenario, scenario);
    insert("INSERT INTO scenario_versions (id,scenarioId,revision,schemaVersion,document,author,createdAt) VALUES (?,?,1,1,?,'x',1)", version, scenario, doc);
  }
  insert("INSERT INTO scenario_sources (versionId,source,metadata) VALUES ('v-imp','{}','{}')");
  for (const [run, version] of [["r-ex", "v-ex"], ["r-imp", "v-imp"]]) {
    insert("INSERT INTO runs (id,versionId,settings,status,idempotencyKey,requestHash,createdAt,kind) VALUES (?,?,'{}','succeeded',?,'h',1,'pipeline')", run, version, run);
    insert("INSERT INTO jobs (id,runId,status,createdAt) VALUES (?,?,'succeeded',1)", `j-${run}`, run);
  }
  insert("INSERT INTO artifacts (hash,compressed,byteLength) VALUES ('h1',x'00',1)");
  insert("INSERT INTO stage_cache (inputHash,artifactHash,manifest,runId) VALUES ('i-ex','h1','{}','r-ex'),('i-imp','h1','{}','r-imp')");
  insert("INSERT INTO travel_snapshots VALUES (?,x'00',1,7,'imported','v','d','truck',1)", parity.identity);
  const ex = { versionId: "v-ex" }, imported = { versionId: "v-imp" }, exampleRun = "r-ex", importedRun = "r-imp";
  legacy.close();

  const migrated = openDatabase(legacyPath);
  try {
    expect(migrated.versionOwner(ex.versionId)).toBe("examples");
    expect(migrated.versionOwner(imported.versionId)).toBe("operator");
    expect(migrated.runView(exampleRun)?.ownerId).toBe("public");
    expect(migrated.runView(importedRun)?.ownerId).toBe("operator");
    expect(migrated.ownsTravelSnapshot(parity.identity, "operator")).toBe(true);
    expect(migrated.sqlite.prepare("SELECT scope, inputHash FROM stage_cache ORDER BY inputHash").all()).toEqual([{ scope: "examples", inputHash: "i-ex" }, { scope: "operator", inputHash: "i-imp" }]);
    expect(scenarioList(migrated, "user:first-signup")).toHaveLength(0);
    for (const table of ["user", "session", "account", "verification"]) expect(migrated.sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get()).toEqual({ n: 0 });
  } finally { migrated.close(); }
});

test("migration 0009 approves existing users, new requests transition, and deletion cascades", () => {
  const old = join(dir, "migrations-0008");
  cpSync(resolve("packages/db/migrations"), old, { recursive: true });
  const journalPath = join(old, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 9);
  writeFileSync(journalPath, JSON.stringify(journal));
  const legacyPath = join(dir, "users.sqlite");
  const legacy = openDatabase(legacyPath, old);
  legacy.sqlite.prepare("INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES ('old','Old','old@example.com',1,1,1)").run();
  legacy.close();
  const migrated = openDatabase(legacyPath);
  try {
    expect(migrated.sqlite.prepare("SELECT status FROM access_requests WHERE user_id='old'").get()).toEqual({ status: "approved" });
    migrated.sqlite.prepare("INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES ('new','New','new@example.com',1,1,1),('admin','Admin','admin@example.com',1,1,1)").run();
    migrated.sqlite.prepare("INSERT INTO account (id,account_id,provider_id,user_id,created_at,updated_at) VALUES ('a','119372400','github','admin',1,1)").run();
    expect(accessFor(migrated, "new", "119372400", "request").status).toBe("pending");
    expect(accessFor(migrated, "admin", "119372400", "request")).toMatchObject({ admin: true, status: "approved" });
    expect(saveAccessNote(migrated, "new", "Uses synthetic data").note).toBe("Uses synthetic data");
    expect(() => saveAccessNote(migrated, "new", "x".repeat(501))).toThrow("note_too_long");
    expect(() => decideAccess(migrated, "admin", "admin", "revoke", "119372400")).toThrow("admin_immutable");
    expect(decideAccess(migrated, "admin", "new", "approve", "119372400")).toBe("approved");
    expect(decideAccess(migrated, "admin", "new", "revoke", "119372400")).toBe("revoked");
    expect(decideAccess(migrated, "admin", "new", "restore", "119372400")).toBe("approved");
    expect(migrated.sqlite.prepare("SELECT count(*) AS n FROM admin_events").get()).toEqual({ n: 3 });
    migrated.sqlite.prepare("DELETE FROM user WHERE id='new'").run();
    expect(migrated.sqlite.prepare("SELECT count(*) AS n FROM access_requests WHERE user_id='new'").get()).toEqual({ n: 0 });
  } finally { migrated.close(); }
});

test("a warm-start source must be a succeeded run the submitter can read, re-checked for the worker", () => {
  const a = save(A), b = save(B);
  const examples = store.createScenario("Example", { schema_version: 1, document: example.scenario } as never, "Fillrate examples", 1, "examples");
  const warm = (runId: string) => ({ schema_version: 1 as const, document: { n: 1, warm_start: { kind: "run", run_id: runId } } });
  let now = 2_000_000;
  /** Queues a run and completes it with a summary artifact, as the worker would. */
  function finished(versionId: string, ownerId: string) {
    const runId = store.enqueue(versionId, settings(), randomUUID(), now++, 3, "pipeline", { ownerId });
    const lease = store.claim("w", now++)!.lease;
    const payload = { validity: "valid", runId };
    const manifest = { ...artifact(lease, "e".repeat(64)).manifest, stage_type: "summary" as const, output_hash: contentHash(canonical(payload)) };
    store.record({ lease, sequence: 1, kind: "succeeded", payload: {} }, [{ manifest, payload }], now++);
    return runId;
  }
  const sourceA = finished(a.versionId, A), exampleRun = finished(examples.versionId, B);
  // Another account's run reads as missing, in the queue and in a sweep.
  expect(() => store.enqueue(b.versionId, warm(sourceA), "b-warm", now++, 3, "pipeline", { ownerId: B })).toThrow("warm_start_source_not_found");
  expect(() => store.createExperiment({ versionId: b.versionId, name: "x", spec: {}, comparison: {}, runs: [{ settings: warm(sourceA), varied: {} }], ownerId: B }, "b-sweep")).toThrow("warm_start_source_not_found");
  expect(() => store.enqueue(b.versionId, warm("no-such-run"), "b-missing", now++, 3, "pipeline", { ownerId: B })).toThrow("warm_start_source_not_found");
  expect(store.listRuns(50, B).map(r => r.id)).not.toContain(sourceA);
  // A run that has not succeeded is not a source yet.
  const queued = store.enqueue(a.versionId, settings(9), "a-queued", now++, 3, "pipeline", { ownerId: A });
  expect(() => store.enqueue(a.versionId, warm(queued), "a-early", now++, 3, "pipeline", { ownerId: A })).toThrow("warm_start_source_not_ready");
  store.cancel(queued);
  // The owner, and anyone for a bundled example's run, may warm-start; the worker receives the source summary.
  const warmA = store.enqueue(a.versionId, warm(sourceA), "a-warm", now++, 3, "pipeline", { ownerId: A });
  const warmB = store.enqueue(b.versionId, warm(exampleRun), "b-example", now++, 3, "pipeline", { ownerId: B });
  const leaseA = store.claim("w", now++)!.lease;
  expect(store.runView(warmA)!.status).toBe("claimed");
  expect(store.leaseWarmStartSource(leaseA, now++)).toEqual({ summary: { validity: "valid", runId: sourceA } });
  const leaseB = store.claim("w", now++)!.lease;
  expect(store.runView(warmB)!.status).toBe("claimed");
  expect(store.leaseWarmStartSource(leaseB, now++)).toEqual({ summary: { validity: "valid", runId: exampleRun } });
  // A run without a warm start gets nothing.
  store.enqueue(a.versionId, settings(3), "a-cold", now++, 3, "pipeline", { ownerId: A });
  const cold = store.claim("w", now++)!.lease;
  expect(() => store.leaseWarmStartSource(cold, now++)).toThrow("warm_start_not_selected");
});

test("saved manual baselines are owner-scoped, quota-charged, deletable and the only baselines a warm start may name", () => {
  const a = save(A), b = save(B);
  const examples = store.createScenario("Example", { schema_version: 1, document: example.scenario } as never, "Fillrate examples", 1, "examples");
  const warm = (baselineId: string) => ({ schema_version: 1 as const, document: { n: 1, warm_start: { kind: "manual_baseline", baseline_id: baselineId } } });
  let now = 3_000_000;
  function finished(versionId: string, ownerId: string) {
    const runId = store.enqueue(versionId, settings(now), randomUUID(), now++, 3, "pipeline", { ownerId });
    const lease = store.claim("w", now++)!.lease;
    const payload = { validity: "valid", runId };
    store.record({ lease, sequence: 1, kind: "succeeded", payload: {} }, [{ manifest: { ...artifact(lease, "f".repeat(64)).manifest, stage_type: "summary" as const, output_hash: contentHash(canonical(payload)) }, payload }], now++);
    return runId;
  }
  const outcome = (valid: boolean) => ({ manual: { valid, violations: valid ? [] : [{ code: "missing_visit" }], metrics: { trucks: 1 }, trucks: [{ id: "C1-M1", visits: [{ visit_id: "v1", location_id: "L1", load: 5, sequence: 1 }] }] } });
  const plan = { cluster_id: "C1", routes: [["v1"]] };
  const runA = finished(a.versionId, A), exampleRun = finished(examples.versionId, A), unfinished = enqueue(b.versionId, B, "b-unfinished", now++);
  const key = { runId: runA, ownerId: A, name: "Hand plan", plan, evaluation: outcome(true), idempotencyKey: "base-1" };
  const saved = store.saveBaseline(key, now++);
  expect(saved).toMatchObject({ ownerId: A, runId: runA, clusterId: "C1", name: "Hand plan", valid: true, plan });
  // Replaying the key returns the same baseline; another account or a different request is a conflict.
  expect(store.saveBaseline(key, now++).id).toBe(saved.id);
  expect(store.baselineReplay("base-1", A, store.baselineRequestHash(runA, "Hand plan", plan))!.id).toBe(saved.id);
  expect(() => store.saveBaseline({ ...key, ownerId: B }, now++)).toThrow("idempotency_conflict");
  expect(() => store.saveBaseline({ ...key, name: "Other" }, now++)).toThrow("idempotency_conflict");
  // Another account cannot save onto, list, read, delete or warm-start from it; an unfinished or foreign run refuses.
  expect(() => store.saveBaseline({ ...key, ownerId: B, idempotencyKey: "b-foreign" }, now++)).toThrow("run_not_found");
  expect(() => store.saveBaseline({ ...key, runId: unfinished, ownerId: B, idempotencyKey: "b-early" }, now++)).toThrow("run_not_finished");
  store.cancel(unfinished);
  expect(store.baseline(saved.id, B)).toBeNull();
  expect(store.listBaselines(runA, B)).toEqual([]);
  expect(store.listBaselines(runA, A).map(r => r.id)).toEqual([saved.id]);
  expect(store.deleteBaseline(saved.id, B)).toBe(false);
  expect(() => store.enqueue(b.versionId, warm(saved.id), "b-warm", now++, 3, "pipeline", { ownerId: B })).toThrow("warm_start_source_not_found");
  expect(() => store.createExperiment({ versionId: b.versionId, name: "x", spec: {}, comparison: {}, runs: [{ settings: warm(saved.id), varied: {} }], ownerId: B }, "b-sweep-baseline")).toThrow("warm_start_source_not_found");
  expect(store.ownerBaselines(B)).toEqual([]);
  // A bundled example's run may be baselined by anyone; the baseline is still only the saver's.
  const onExample = store.saveBaseline({ ...key, runId: exampleRun, idempotencyKey: "base-example" }, now++);
  expect(store.baseline(onExample.id, B)).toBeNull();
  // An invalid baseline is saved and listed, but refused as a warm start (for the web check, the queue and the worker).
  const invalid = store.saveBaseline({ ...key, evaluation: outcome(false), idempotencyKey: "base-invalid", name: "Broken" }, now++);
  expect(invalid.valid).toBe(false);
  expect(() => store.enqueue(a.versionId, warm(invalid.id), "a-invalid", now++, 3, "pipeline", { ownerId: A })).toThrow("warm_start_baseline_invalid");
  // The owner's valid baseline queues; the worker receives it, re-checked against the run's owner.
  const warmRun = store.enqueue(a.versionId, warm(saved.id), "a-warm-baseline", now++, 3, "pipeline", { ownerId: A });
  const lease = store.claim("w", now++)!.lease;
  expect(store.runView(warmRun)!.status).toBe("claimed");
  const source = store.leaseWarmStartSource(lease, now++) as { baseline: { id: string; run_id: string; cluster_id: string; routes: string[][]; trucks: unknown[]; settings: unknown } };
  expect(source.baseline).toMatchObject({ id: saved.id, run_id: runA, cluster_id: "C1", routes: plan.routes, valid: true });
  expect(source.baseline.trucks).toEqual(outcome(true).manual.trucks);
  // A running solve that names it holds the baseline; deleting is refused until it finishes, then a later queue is 404.
  expect(() => store.deleteBaseline(saved.id, A)).toThrow("baseline_in_use");
  store.record({ lease, sequence: 1, kind: "failed", payload: { code: "x" } }, [], now++);
  expect(store.runView(warmRun)!.status).toBe("failed");
  expect(store.deleteBaseline(saved.id, A)).toBe(true);
  expect(store.baseline(saved.id, A)).toBeNull();
  expect(() => store.enqueue(a.versionId, warm(saved.id), "a-after-delete", now++, 3, "pipeline", { ownerId: A })).toThrow("warm_start_source_not_found");
  // Saves are charged in the saving transaction (one failed bucket charges nothing, a replay is free) and bounded per owner.
  const tight: Admission = { ownerId: A, buckets: [{ bucket: "save:user:a", limit: 2, windowMs: DAY, label: "daily scenario saves" }] };
  const charged = (k: string) => store.saveBaseline({ ...key, idempotencyKey: k, name: k, admission: tight }, now++);
  charged("c1"); charged("c2"); charged("c2");
  expect(admissionCode(() => charged("c3"))).toBe("quota_exceeded");
  expect(store.ownerBaselines(A).map(r => r.name)).not.toContain("c3");
  expect(() => store.saveBaseline({ ...key, idempotencyKey: "cap", name: "cap", maxPerOwner: 1 }, now++)).toThrow("baseline_limit");
});

test("deleting a scenario or an account deletes the baselines on its runs and the ones it saved", () => {
  const a = save(A), b = save(B);
  const examples = store.createScenario("Example", { schema_version: 1, document: example.scenario } as never, "Fillrate examples", 1, "examples");
  let now = 4_000_000;
  const finished = (versionId: string, ownerId: string) => {
    const runId = store.enqueue(versionId, settings(now), randomUUID(), now++, 3, "pipeline", { ownerId });
    const lease = store.claim("w", now++)!.lease;
    const payload = { validity: "valid", runId };
    store.record({ lease, sequence: 1, kind: "succeeded", payload: {} }, [{ manifest: { ...artifact(lease, "f".repeat(64)).manifest, stage_type: "summary" as const, output_hash: contentHash(canonical(payload)) }, payload }], now++);
    return runId;
  };
  const plan = { cluster_id: "C1", routes: [["v1"]] }, evaluation = { manual: { valid: true, violations: [], metrics: {}, trucks: [] } };
  const runA = finished(a.versionId, A), exampleRun = finished(examples.versionId, "examples");
  const onScenario = store.saveBaseline({ runId: runA, ownerId: A, name: "n", plan, evaluation, idempotencyKey: "k1" }, now++);
  const bOnExample = store.saveBaseline({ runId: exampleRun, ownerId: B, name: "n", plan, evaluation, idempotencyKey: "k2" }, now++);
  const aOnExample = store.saveBaseline({ runId: exampleRun, ownerId: A, name: "n", plan, evaluation, idempotencyKey: "k3" }, now++);
  store.deleteScenarios([a.scenarioId]);
  expect(store.baseline(onScenario.id, A)).toBeNull();
  store.deleteOwnerData(A);
  expect(store.baseline(aOnExample.id, A)).toBeNull();
  expect(store.baseline(bOnExample.id, B)).not.toBeNull();
  expect(b.scenarioId).toBeTruthy();
});
