import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonical, contentHash, openDatabase, type Store } from "../src/index";
import { createWorkerTransport, resolveWorkerToken } from "../src/transport";

let dir: string, store: Store, transport: ReturnType<typeof createWorkerTransport>, base: string;
const token = "t".repeat(64);
const snapshot = { schema_version: 1 as const, document: { synthetic: true } };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-transport-"));
  store = openDatabase(join(dir, "test.sqlite"));
  transport = createWorkerTransport(store, { token, port: 0 });
  base = `http://127.0.0.1:${(await transport.listen()).port}`;
});
afterEach(async () => { await transport.close(); store.close(); rmSync(dir, { recursive: true, force: true }); });

const post = (path: string, body: unknown, auth = `Bearer ${token}`) =>
  fetch(base + path, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

test("rejects missing or wrong tokens and unknown routes", async () => {
  expect((await post("/internal/worker/claim", { worker_id: "w" }, "")).status).toBe(401);
  expect((await post("/internal/worker/claim", { worker_id: "w" }, `Bearer ${"x".repeat(64)}`)).status).toBe(401);
  expect((await post("/internal/nope", {})).status).toBe(404);
  expect((await fetch(base + "/internal/worker/claim", { headers: { authorization: `Bearer ${token}` } })).status).toBe(405);
});

test("claim → heartbeat → ordered events → atomic completion; stale callbacks get 409", async () => {
  expect(await (await post("/internal/worker/claim", { worker_id: "w" })).json()).toEqual({ job: null });
  const versionId = store.createScenario("S", snapshot, "T").versionId;
  const runId = store.enqueue(versionId, snapshot, "k");
  const { job } = await (await post("/internal/worker/claim", { worker_id: "w" })).json();
  expect(job.run_id).toBe(runId);
  expect(job.scenario).toEqual(snapshot);
  expect(transport.lastContact()?.workerId).toBe("w");
  const beat = await (await post("/internal/worker/heartbeat", { lease: job.lease })).json();
  expect(beat.cancel_requested).toBe(false);

  const progress = { lease: job.lease, sequence: 1, kind: "progress", payload: { stage: "allocation" } };
  expect((await post("/internal/worker/events", { event: progress })).status).toBe(200);
  expect(await (await post("/internal/worker/events", { event: progress })).json()).toEqual({ duplicate: true });
  const skipped = await post("/internal/worker/events", { event: { ...progress, sequence: 5 } });
  expect([skipped.status, (await skipped.json()).error]).toEqual([409, "event_out_of_order"]);

  const payload = { pieces: 3, lat: 35.1495 };
  const manifest = { schema_version: 1, stage_type: "summary", input_hash: "a".repeat(64), output_hash: contentHash(canonical(payload)), producer_version: "t/1", adapter_version: "t/1", parent_hashes: [], effective_settings: {}, created_at_ms: 1, execution_id: randomUUID(), reused_from: null };
  const done = await post("/internal/worker/events", { event: { lease: job.lease, sequence: 2, kind: "succeeded", payload: {} }, artifacts: [{ manifest, payload }] });
  expect(done.status).toBe(200);
  expect(store.runView(runId)?.status).toBe("succeeded");
  expect(store.readArtifact(manifest.output_hash)).toEqual(payload);
  const stale = await post("/internal/worker/heartbeat", { lease: job.lease });
  expect([stale.status, (await stale.json()).error]).toEqual([409, "stale_lease"]);
});

test("heartbeat reports cancellation; success after cancellation is refused", async () => {
  const versionId = store.createScenario("S", snapshot, "T").versionId;
  const runId = store.enqueue(versionId, snapshot, "k");
  const { job } = await (await post("/internal/worker/claim", { worker_id: "w" })).json();
  store.cancel(runId);
  expect((await (await post("/internal/worker/heartbeat", { lease: job.lease })).json()).cancel_requested).toBe(true);
  const success = await post("/internal/worker/events", { event: { lease: job.lease, sequence: 1, kind: "succeeded", payload: {} } });
  expect([success.status, (await success.json()).error]).toEqual([409, "cancel_requested"]);
  expect((await post("/internal/worker/events", { event: { lease: job.lease, sequence: 1, kind: "cancelled", payload: {} } })).status).toBe(200);
  expect(store.runView(runId)?.status).toBe("cancelled");
});

test("requests from a non-loopback address are refused even with the token", async () => {
  const lan = Object.values(networkInterfaces()).flat().find(i => i && i.family === "IPv4" && !i.internal);
  if (!lan) return; // no external interface in this environment
  const open = createWorkerTransport(store, { token, host: "0.0.0.0", port: 0 });
  const { port } = await open.listen();
  try {
    const res = await fetch(`http://${lan.address}:${port}/internal/worker/claim`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
    expect(res.status).toBe(403);
  } finally { await open.close(); }
});

test("worker token file is created once with owner-only permissions", () => {
  const path = join(dir, "db.sqlite");
  const first = resolveWorkerToken(path, {});
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(resolveWorkerToken(path, {})).toBe(first);
  expect(statSync(join(dir, "worker.token")).mode & 0o777).toBe(0o600);
  expect(readFileSync(join(dir, "worker.token"), "utf8")).toBe(first);
  expect(resolveWorkerToken(path, { WORKER_TOKEN: "env" })).toBe("env");
});
