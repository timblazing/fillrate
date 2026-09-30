import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { canonical, contentHash, openDatabase, type Store, type ArtifactInput } from "../src/index";
import { parseContract, type Lease, type WorkerEvent } from "@fillrate/contracts";
import * as s from "../src/schema";

let dir: string, path: string, store: Store, versionId: string;
const snapshot = { schema_version: 1 as const, document: { synthetic: true } };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-test-")); path = join(dir, "test.sqlite");
  store = openDatabase(path);
  versionId = store.createScenario("Synthetic", snapshot, "Test").versionId;
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
function enqueue(key: string = randomUUID(), maxAttempts = 3) { return store.enqueue(versionId, snapshot, key, 1000, maxAttempts); }
function event(lease: Lease, kind: WorkerEvent["kind"] = "succeeded", sequence = 1): WorkerEvent { return { lease, kind, sequence, payload: {} }; }
function artifact(payload: unknown = { pieces: 3 }): ArtifactInput {
  return { payload, manifest: { schema_version: 1, stage_type: "allocation", input_hash: "a".repeat(64), output_hash: contentHash(canonical(payload)), producer_version: "test/1", adapter_version: "test/1", parent_hashes: [], effective_settings: {}, created_at_ms: 1001, execution_id: randomUUID(), reused_from: null } };
}

test("WAL, foreign keys, pragmas and idempotent migrations survive reopening", () => {
  expect(store.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
  expect(store.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(store.sqlite.pragma("synchronous", { simple: true })).toBe(1);
  expect(store.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
  const id = enqueue(); store.close(); store = openDatabase(path);
  expect(store.db.select().from(s.runs).get()?.id).toBe(id);
  expect(() => store.enqueue(randomUUID(), snapshot, "bad")).toThrow(/FOREIGN KEY/);
});

test("versions and settings remain snapshots; stale edits and reused keys conflict", () => {
  const first = store.db.select().from(s.versions).get()!;
  store.saveVersion(first.scenarioId, first.id, { ...snapshot, document: { changed: true } }, "Other");
  expect(() => store.saveVersion(first.scenarioId, first.id, snapshot, "Test")).toThrow("version_conflict");
  const id = enqueue("same"); expect(enqueue("same")).toBe(id);
  expect(() => store.enqueue(versionId, { ...snapshot, document: {} }, "same")).toThrow("idempotency_conflict");
  expect(JSON.parse(store.db.select().from(s.runs).get()!.settings)).toEqual(snapshot);
  expect(store.db.select().from(s.versions).all()).toHaveLength(2);
});

test("independent processes racing on a real file grant exactly one lease", async () => {
  enqueue();
  const outputs = await Promise.all(Array.from({ length: 4 }, (_, i) => promisify(execFile)(process.execPath, ["--import", "tsx", resolve("packages/db/tests/claim-worker.ts"), path, `worker-${i}`])));
  const claims = outputs.map(x => JSON.parse(x.stdout)).filter(Boolean);
  expect(claims).toHaveLength(1);
  expect(store.db.select().from(s.attempts).all()).toHaveLength(1);
});

test("expiry fences heartbeat/completion, retries record attempts, and permanent failures stop", () => {
  enqueue(); const old = store.claim("one", 1000, 100)!.lease;
  expect(() => store.heartbeat(old, 1100)).toThrow("stale_lease");
  const current = store.claim("two", 1100)!.lease;
  expect(current.attempt).toBe(2);
  expect(() => store.record(event(old), [], 1101)).toThrow("stale_lease");
  expect(() => store.heartbeat(old, 1101)).toThrow("stale_lease");
  store.record(event(current, "failed"), [], 1101);
  expect(store.claim("three", 999999)).toBeNull();
  expect(store.db.select().from(s.attempts).all().map(a => a.reason)).toEqual(["lease_expired", "failed"]);
});

test("bounded retries end interrupted after a crashed last attempt", () => {
  enqueue(undefined, 1); store.claim("one", 1000, 10);
  expect(store.claim("two", 1010)).toBeNull();
  expect(store.db.select().from(s.runs).get()?.status).toBe("interrupted");
});

test("queued cancellation is immediate; active cancellation requires acknowledgement or expiry", () => {
  const id = enqueue(); store.cancel(id); expect(store.claim("one", 1000)).toBeNull();
  const second = enqueue(); const lease = store.claim("one", 1000, 100)!.lease;
  store.cancel(second);
  expect(store.heartbeat(lease, 1001, 100).cancelRequested).toBe(true);
  expect(() => store.record(event(lease), [], 1002)).toThrow("cancel_requested");
  store.record(event(lease, "cancelled"), [], 1002);
  expect(store.db.select().from(s.runs).all().every(r => r.status === "cancelled")).toBe(true);
  const third = enqueue(); store.claim("one", 1000, 10); store.cancel(third);
  expect(store.claim("two", 1010)).toBeNull();
  expect(store.db.select().from(s.runs).all().every(r => r.status === "cancelled")).toBe(true);
});

test("events are ordered, exact callbacks idempotent, conflicting callbacks rejected", () => {
  enqueue(); const lease = store.claim("one", 1000)!.lease;
  expect(() => store.record(event(lease, "progress", 2), [], 1001)).toThrow("event_out_of_order");
  const progress = event(lease, "progress"); store.record(progress, [], 1001);
  expect(store.record(progress, [], 1002).duplicate).toBe(true);
  expect(() => store.record({ ...progress, payload: { different: true } }, [], 1002)).toThrow("event_conflict");
  const complete = event(lease, "succeeded", 2); store.record(complete, [], 1003);
  expect(store.record(complete, [], 900000).duplicate).toBe(true);
  expect(() => store.record(event(lease, "failed", 3), [], 1004)).toThrow("stale_lease");
});

test("completion atomically stores compressed, hash-verified artifacts and survives restart", () => {
  enqueue(); const lease = store.claim("one", 1000)!.lease; const input = artifact();
  const broken = artifact(); broken.manifest.output_hash = "0".repeat(64);
  expect(() => store.record(event(lease), [input, broken], 1001)).toThrow("artifact_hash_mismatch");
  expect(store.db.select().from(s.artifacts).all()).toHaveLength(0);
  store.record(event(lease), [input], 1002); store.close(); store = openDatabase(path);
  expect(store.readArtifact(input.manifest.output_hash)).toEqual(input.payload);
  expect(store.db.select().from(s.runArtifacts).all()).toHaveLength(1);
  expect(store.record(event(lease), [input], 1003).duplicate).toBe(true);
  expect(store.db.select().from(s.runArtifacts).all()).toHaveLength(1);
});

test("database write failure rolls back artifacts, references, events and status", () => {
  enqueue(); const lease = store.claim("one", 1000)!.lease;
  store.sqlite.exec("CREATE TRIGGER reject_event BEFORE INSERT ON job_events BEGIN SELECT RAISE(ABORT, 'forced failure'); END");
  expect(() => store.record(event(lease), [artifact()], 1001)).toThrow("forced failure");
  expect(store.db.select().from(s.artifacts).all()).toHaveLength(0);
  expect(store.db.select().from(s.runArtifacts).all()).toHaveLength(0);
  expect(store.db.select().from(s.jobs).get()?.status).toBe("claimed");
});

test("oversized and corrupt artifacts are rejected", () => {
  enqueue(); const lease = store.claim("one", 1000)!.lease;
  expect(() => store.record(event(lease), [artifact("x".repeat(8 * 1024 * 1024))], 1001)).toThrow("artifact_too_large");
  const input = artifact(); store.record(event(lease), [input], 1002);
  store.sqlite.prepare("UPDATE artifacts SET byteLength = 1").run();
  expect(() => store.readArtifact(input.manifest.output_hash)).toThrow("artifact_corrupt");
});

test("generated contracts reject extra fields, malformed hashes and fractional attempts", () => {
  expect(() => parseContract("StageManifest", { ...artifact().manifest, output_hash: "no" })).toThrow("invalid_StageManifest");
  expect(() => parseContract("Snapshot", { ...snapshot, extra: true })).toThrow("invalid_Snapshot");
  expect(() => parseContract("Lease", { job_id: randomUUID(), lease_token: randomUUID(), worker_id: "one", attempt: 1.2 })).toThrow("invalid_Lease");
  expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
  expect(() => canonical({ a: undefined })).toThrow("invalid_json");
  expect(() => canonical(Number.MAX_SAFE_INTEGER + 1)).toThrow("invalid_json");
});

test("snapshot immutability is enforced by SQLite, including direct writes", () => {
  enqueue();
  expect(() => store.sqlite.prepare("UPDATE scenario_versions SET document = '{}'").run()).toThrow("immutable");
  expect(() => store.sqlite.prepare("UPDATE runs SET settings = '{}'").run()).toThrow("immutable");
});

test("simultaneous heartbeat and completion calls leave one durable terminal result", async () => {
  enqueue(); const lease = store.claim("one")!.lease;
  const input = artifact();
  const runner = resolve("packages/db/tests/mutate-worker.ts");
  const results = await Promise.all(Array.from({ length: 4 }, (_, i) => promisify(execFile)(process.execPath, ["--import", "tsx", runner, path, JSON.stringify(lease), i % 2 ? "complete" : "heartbeat", JSON.stringify(input)])));
  const values = results.map(r => JSON.parse(r.stdout));
  expect(values.filter(v => v.duplicate === false)).toHaveLength(1);
  expect(values.filter(v => v.duplicate === true)).toHaveLength(1);
  expect(values.every(v => !v.error || v.error === "stale_lease")).toBe(true);
  expect(store.db.select().from(s.events).all()).toHaveLength(1);
  expect(store.db.select().from(s.runArtifacts).all()).toHaveLength(1);
  expect(store.db.select().from(s.runs).get()?.status).toBe("succeeded");
});
