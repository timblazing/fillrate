import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { canonical, contentHash, openDatabase, type Store } from "../src/index";
import { parseContract } from "@fillrate/contracts";
import * as s from "../src/schema";

let dir: string, path: string, store: Store, versionId: string;
const snapshot = { schema_version: 1 as const, document: { synthetic: true } };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-test-")); path = join(dir, "test.sqlite");
  store = openDatabase(path);
  versionId = store.createScenario("Synthetic", snapshot, "Test").versionId;
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
const status = (id: string) => store.runView(id)!.status;

test("WAL, foreign keys, pragmas and idempotent migrations survive reopening", () => {
  expect(store.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
  expect(store.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(store.sqlite.pragma("synchronous", { simple: true })).toBe(1);
  expect(store.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
  const id = store.createRun(versionId, snapshot); store.close(); store = openDatabase(path);
  expect(store.db.select().from(s.runs).get()?.id).toBe(id);
  expect(() => store.createRun("missing", snapshot)).toThrow(/FOREIGN KEY/);
});

test("versions and settings remain snapshots; stale edits conflict", () => {
  const first = store.db.select().from(s.versions).get()!;
  store.saveVersion(first.scenarioId, first.id, { ...snapshot, document: { changed: true } }, "Other");
  expect(() => store.saveVersion(first.scenarioId, first.id, snapshot, "Test")).toThrow("version_conflict");
  store.createRun(versionId, snapshot);
  expect(JSON.parse(store.db.select().from(s.runs).get()!.settings)).toEqual(snapshot);
  expect(store.db.select().from(s.versions).all()).toHaveLength(2);
});

test("a run moves queued, running, then one terminal state that later outcomes cannot overwrite", () => {
  const done = store.createRun(versionId, snapshot);
  expect(status(done)).toBe("queued");
  expect(store.startRun(done)).toBe(true);
  expect(store.finishRun(done, { status: "succeeded", result: { explorer: undefined, output_hash: "x" } }, 5)).toBe(true);
  expect(store.finishRun(done, { status: "failed", error: { code: "late", message: "late" } })).toBe(false);
  expect(store.runView(done)).toMatchObject({ status: "succeeded", finishedAt: 5, error: null });
  expect(store.runResult(done)).toEqual({ output_hash: "x" });

  const failed = store.createRun(versionId, snapshot, "pipeline", { status: "running" });
  expect(store.startRun(failed)).toBe(true);
  store.finishRun(failed, { status: "failed", error: { code: "preflight_blocked", message: "blocked" } });
  expect(store.runView(failed)).toMatchObject({ status: "failed", error: { code: "preflight_blocked", message: "blocked" } });
  expect(store.runResult(failed)).toBeNull();
});

test("cancelling a queued run keeps it from starting; cancelling a running run reports it was running", () => {
  const queued = store.createRun(versionId, snapshot);
  expect(store.cancelRun(queued)).toBe("queued");
  expect(store.startRun(queued)).toBe(false);
  const running = store.createRun(versionId, snapshot, "pipeline", { status: "running" });
  expect(store.cancelRun(running)).toBe("running");
  expect(store.finishRun(running, { status: "succeeded", result: {} })).toBe(false);
  expect(store.cancelRun(running)).toBeNull();
  expect(status(running)).toBe("cancelled");
  expect(() => store.cancelRun("missing")).toThrow("run_not_found");
});

test("on startup unfinished runs fail as interrupted and finished runs are untouched", () => {
  const queued = store.createRun(versionId, snapshot);
  const running = store.createRun(versionId, snapshot, "pipeline", { status: "running" });
  const done = store.createRun(versionId, snapshot); store.finishRun(done, { status: "succeeded", result: {} });
  expect(store.failInterruptedRuns()).toBe(2);
  for (const id of [queued, running]) expect(store.runView(id)).toMatchObject({ status: "failed", error: { code: "interrupted", message: "interrupted (server restarted)" } });
  expect(status(done)).toBe("succeeded");
  expect(store.runCounts()).toEqual({ failed: 2, succeeded: 1 });
});

test("the optimizer payload is the version document and the run settings document", () => {
  const id = store.createRun(versionId, { ...snapshot, document: { k: 3 } }, "explorer");
  expect(store.solveInput(id)).toEqual({ kind: "explorer", scenario: { synthetic: true }, settings: { k: 3 } });
});

test("runs made before direct solves are rebuilt from their stored stage outputs", () => {
  const id = store.createRun(versionId, snapshot);
  store.sqlite.prepare("UPDATE runs SET status='succeeded'").run();
  for (const [stage, payload] of [["allocation", { allocated: { L1: 2 } }], ["summary", { validity: "valid" }]] as const) {
    const bytes = Buffer.from(canonical(payload)), hash = contentHash(bytes);
    store.sqlite.prepare("INSERT INTO artifacts (hash, compressed, byteLength) VALUES (?,?,?)").run(hash, gzipSync(bytes), bytes.length);
    store.sqlite.prepare("INSERT INTO run_artifacts (id, runId, artifactHash, manifest) VALUES (?,?,?,?)").run(`${stage}-ref`, id, hash, JSON.stringify({ stage_type: stage, output_hash: hash }));
  }
  const result = store.runResult(id)!;
  expect(result.summary).toEqual({ validity: "valid" });
  expect(result.stages).toEqual([{ stage: "allocation", output_hash: contentHash(canonical({ allocated: { L1: 2 } })), payload: { allocated: { L1: 2 } } }]);
  store.sqlite.prepare("UPDATE artifacts SET byteLength = 1").run();
  expect(() => store.runResult(id)).toThrow("artifact_corrupt");
});

test("generated contracts reject extra fields; canonical JSON is key-order independent and strict", () => {
  expect(() => parseContract("Snapshot", { ...snapshot, extra: true })).toThrow("invalid_Snapshot");
  expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }));
  expect(() => canonical({ a: undefined })).toThrow("invalid_json");
  expect(() => canonical(Number.MAX_SAFE_INTEGER + 1)).toThrow("invalid_json");
});

test("snapshot immutability is enforced by SQLite, including direct writes", () => {
  store.createRun(versionId, snapshot);
  expect(() => store.sqlite.prepare("UPDATE scenario_versions SET document = '{}'").run()).toThrow("immutable");
  expect(() => store.sqlite.prepare("UPDATE runs SET settings = '{}'").run()).toThrow("immutable");
  expect(() => store.sqlite.prepare("UPDATE runs SET status = 'queued'").run()).not.toThrow();
});
