// Solver Lab runs through the real Python supervisor and PyVRP (M6): a bundled example completes with a
// validated result, Python re-validates instances independently of TypeScript, and cancellation kills the solve.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LabInstance } from "@fillrate/contracts";
import { openDatabase, type Store } from "../src/index";
import { enqueueLabRun, labExampleVersion, labRun, validateLabInstance } from "../src/lab";
import { createWorkerTransport } from "../src/transport";

const optimizer = resolve("services/optimizer");
const dimensions = JSON.parse(readFileSync(resolve("examples/lab-dimensions.json"), "utf8")) as LabInstance;
const hasUv = spawnSync("uv", ["--version"]).status === 0 && process.env.FILLRATE_SKIP_PYTHON !== "1";
const token = "e2e-token";
const env = { ...process.env, UV_PYTHON: "python3.13", WORKER_TOKEN: token, WORKER_POLL_SECONDS: "0.2", WORKER_HEARTBEAT_SECONDS: "0.3" };

let dir: string, store: Store, transport: ReturnType<typeof createWorkerTransport>, url: string;
const workers: ChildProcess[] = [];
beforeAll(() => { if (hasUv) spawnSync("uv", ["sync", "--locked", "-q"], { cwd: optimizer, env, stdio: "inherit" }); }, 300_000);
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-lab-e2e-"));
  store = openDatabase(join(dir, "e2e.sqlite"));
  transport = createWorkerTransport(store, { token, port: 0, leaseMs: 2_000 });
  url = `http://127.0.0.1:${(await transport.listen()).port}`;
});
afterEach(async () => {
  for (const w of workers.splice(0)) w.kill("SIGKILL");
  await transport.close(); store.close(); rmSync(dir, { recursive: true, force: true });
});
afterAll(() => { for (const w of workers) w.kill("SIGKILL"); });

function startWorker(id: string) {
  const worker = spawn(join(optimizer, ".venv/bin/fillrate-worker"), [], { cwd: optimizer, env: { ...env, FILLRATE_INTERNAL_URL: url, WORKER_ID: id }, stdio: ["ignore", "ignore", "pipe"] });
  workers.push(worker);
}
async function waitFor<T>(fn: () => T | undefined | null | false, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error("timeout"); await new Promise(r => setTimeout(r, 100)); }
}
const ended = (id: string) => waitFor(() => ["succeeded", "failed", "cancelled", "interrupted"].includes(store.runView(id)!.status) && store.runView(id)!);

test.skipIf(!hasUv)("a bundled lab example completes with a validated, persisted result", async () => {
  const runId = enqueueLabRun(store, { versionId: labExampleVersion(store, validateLabInstance(structuredClone(dimensions))) }, "lab-example", { ownerId: "public" });
  startWorker("lab-1");
  const view = await ended(runId);
  expect(view.status).toBe("succeeded");
  expect(view.artifacts.map(a => a.stage_type)).toEqual(["lab"]);
  expect(view.events.map(e => e.kind)).toEqual(["progress", "progress", "progress", "succeeded"]);
  const { result } = labRun(store, runId)!;
  expect(result).toMatchObject({ kind: "lab_result", proof: "heuristic", solver_feasible: true, validated_feasible: true, violations: [] });
  // The pytest-asserted observation: weight sets the truck count.
  expect(result!.totals.routes).toBe(3);
  expect(Math.max(...result!.routes.map(r => r.utilization.volume))).toBeLessThan(0.6);
  expect(view.events.at(-1)!.payload).toMatchObject({ kind: "lab", validated_feasible: true, routes: 3, problem_fingerprint: result!.problem_fingerprint });
}, 120_000);

test.skipIf(!hasUv)("Python re-validates an instance the TypeScript checks never saw, and fails it permanently", async () => {
  const sneaky = structuredClone(dimensions) as unknown as { clients: Record<string, unknown>[] };
  sneaky.clients[0].pickup = [1, 1];
  const runId = enqueueLabRun(store, { instance: sneaky as unknown as LabInstance }, "sneaky", { ownerId: "operator" });
  startWorker("lab-2");
  const view = await ended(runId);
  expect(view.status).toBe("failed");
  expect(view.attempt).toBe(1);
  expect(view.events.at(-1)!.payload).toMatchObject({ code: "planned_capability" });
  expect(String(view.events.at(-1)!.payload.message)).toContain("pickups_and_deliveries");
}, 120_000);

test.skipIf(!hasUv)("cancelling a running lab solve kills it and persists the cancellation", async () => {
  // 300 clients on a runtime-only budget: the solve would run its full 30 s unless cancelled.
  const clients = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, x: (i * 37) % 101, y: (i * 61) % 97, delivery: { load: 1 + (i % 4) } }));
  const instance = validateLabInstance({ name: "long", coordinates: "planar", dimensions: [{ id: "load", unit: "units" }], depots: [{ id: "depot", x: 50, y: 50 }], clients, vehicle_types: [{ id: "t", count: 100, capacity: { load: 20 } }], solver: { seed: 0, max_iterations: null, max_runtime_s: 30 } });
  const runId = enqueueLabRun(store, { instance }, "long", { ownerId: "operator" });
  startWorker("lab-3");
  await waitFor(() => store.runView(runId)!.events.some(e => e.kind === "progress" && e.payload.stage === "solve"));
  const started = Date.now();
  store.cancel(runId);
  const view = await ended(runId);
  expect(view.status).toBe("cancelled");
  expect(Date.now() - started).toBeLessThan(15_000);
  expect(view.artifacts).toEqual([]);
  expect(labRun(store, runId)!.result).toBeNull();
}, 120_000);
