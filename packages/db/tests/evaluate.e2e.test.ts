// Manual plan evaluation end to end (spec §10, M6): the real optimizer process (FastAPI with its worker
// supervisor, as the container runs it) solves a run, then evaluates plans that the web side assembles from
// the stored artifacts. The run's own routes reproduce its stored trucks; an edited plan names violations.
import { afterAll, beforeAll, expect, test } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import type { RunSummary } from "@fillrate/contracts";
import { openDatabase, type Store } from "../src/index";
import { createWorkerTransport } from "../src/transport";
import { callEvaluator, decodeTravel, EvaluationError, evaluationRequest, parsePlan, planContext } from "../src/evaluate";

const optimizer = resolve("services/optimizer");
const windows = JSON.parse(readFileSync(resolve("examples/lesson-windows.json"), "utf8"));
const hasUv = spawnSync("uv", ["--version"]).status === 0 && process.env.FILLRATE_SKIP_PYTHON !== "1";
const token = "e2e-token";

let dir: string, store: Store, transport: ReturnType<typeof createWorkerTransport>, service: ChildProcess | null = null, optimizerUrl: string;

const freePort = () => new Promise<number>((done, fail) => {
  const server = createServer();
  server.once("error", fail);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address() as { port: number }; server.close(() => done(port)); });
});
async function waitFor<T>(fn: () => Promise<T | undefined | null | false> | T | undefined | null | false, ms = 90_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error("timeout");
    await new Promise(r => setTimeout(r, 150));
  }
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-evaluate-"));
  store = openDatabase(join(dir, "e2e.sqlite"));
  transport = createWorkerTransport(store, { token, port: 0, leaseMs: 5_000 });
  const internal = `http://127.0.0.1:${(await transport.listen()).port}`;
  if (!hasUv) return;
  spawnSync("uv", ["sync", "--locked", "-q"], { cwd: optimizer, env: { ...process.env, UV_PYTHON: "python3.13" }, stdio: "inherit" });
  const port = await freePort();
  optimizerUrl = `http://127.0.0.1:${port}`;
  service = spawn(join(optimizer, ".venv/bin/fillrate-optimizer"), [], {
    cwd: optimizer,
    env: { ...process.env, WORKER_TOKEN: token, FILLRATE_WORKER: "1", OPTIMIZER_PORT: String(port), FILLRATE_INTERNAL_URL: internal, WORKER_ID: "evaluate-e2e", WORKER_POLL_SECONDS: "0.2" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  await waitFor(() => fetch(`${optimizerUrl}/health`).then(r => r.ok, () => false));
}, 300_000);
afterAll(async () => {
  service?.kill("SIGKILL");
  await transport.close(); store.close(); rmSync(dir, { recursive: true, force: true });
});

test("plans are validated for shape before the optimizer sees them", () => {
  expect(parsePlan({ cluster_id: "C1", routes: [["a", "b"], ["c"]] })).toEqual({ cluster_id: "C1", routes: [["a", "b"], ["c"]] });
  for (const bad of [null, { routes: [["a"]] }, { cluster_id: "C1", routes: [] }, { cluster_id: "C1", routes: [["a"], []] }, { cluster_id: "C1", routes: [[1]] }])
    expect(() => parsePlan(bad)).toThrow(EvaluationError);
  expect(() => parsePlan({ cluster_id: "C1", routes: [Array.from({ length: 10_001 }, (_, i) => `v${i}`)] })).toThrow(/at most 10000/);
});

test("large travel artifacts are decoded exactly as the worker encoded them", () => {
  const travel = { clusters: [{ cluster_id: "C1", nodes: ["depot", "A"], matrix: [[0, 5], [7, 0]] }], globally_reachable: ["A"] };
  const raw = Buffer.from(JSON.stringify(travel));
  expect(decodeTravel({ encoding: "zlib-json-v1", raw_length: raw.length, data: deflateSync(raw).toString("base64") })).toEqual(travel);
  expect(decodeTravel(travel)).toBe(travel);
  expect(() => decodeTravel({ encoding: "zlib-json-v1", raw_length: raw.length + 1, data: deflateSync(raw).toString("base64") })).toThrow("travel_artifact_invalid");
});

test.skipIf(!hasUv)("a run's routes reproduce its trucks and an edited plan names its violations", async () => {
  const versionId = store.createScenario("Windows", { schema_version: 1, document: windows.scenario }, "e2e").versionId;
  const runId = store.enqueue(versionId, { schema_version: 1, document: windows.settings }, "windows");
  await waitFor(() => ["succeeded", "failed"].includes(store.runView(runId)!.status));
  const view = store.runView(runId)!;
  expect(view.status).toBe("succeeded");
  const summary = store.readArtifact(view.artifacts.find(a => a.stage_type === "summary")!.output_hash) as RunSummary;

  const context = planContext(store, runId, "C1");
  expect(context.reference_routes).toHaveLength(2);
  expect(context.visits.map(v => v.visit_id).sort()).toEqual(context.reference_routes!.flat().sort());
  expect(() => planContext(store, runId, "C9")).toThrow(/no cluster C9/);

  // The optimized routes, evaluated as a manual plan: same trucks as the stored result.
  const same = evaluationRequest(store, runId, { cluster_id: "C1", routes: context.reference_routes! });
  expect(same.recorded.travel).toBe(view.artifacts.find(a => a.stage_type === "travel")!.output_hash);
  const result = await callEvaluator(optimizerUrl, token, same.request);
  expect(result.manual.valid).toBe(true);
  expect(result.reference!.trucks).toEqual(summary.trucks);
  expect(result.manual.metrics.loaded_distance_m).toBe(summary.totals.loaded_distance_m);
  expect(result.manual.metrics.trucks).toBe(summary.totals.trucks);

  // One truck for everything misses windows: each one is named with its truck, visit and times.
  const merged = evaluationRequest(store, runId, { cluster_id: "C1", routes: [context.reference_routes!.flat()] });
  const edited = await callEvaluator(optimizerUrl, token, merged.request);
  expect(edited.manual.valid).toBe(false);
  const late = edited.manual.violations.filter(v => v.code === "window_late");
  expect(late.length).toBeGreaterThan(0);
  expect(late.every(v => v.truck === 1 && v.visit_id && /after its window end/.test(v.message))).toBe(true);
  expect(edited.manual.metrics.trucks).toBe(1);
  expect(edited.reference!.valid).toBe(true);

  // The optimizer refuses a wrong token and a plan for another cluster.
  await expect(callEvaluator(optimizerUrl, "wrong", same.request)).rejects.toMatchObject({ status: 503, code: "evaluator_unavailable" });
  await expect(callEvaluator(optimizerUrl, token, { ...same.request, plan: { cluster_id: "C2", routes: [["x"]] } })).rejects.toMatchObject({ status: 422, code: "cluster_mismatch" });
  // Unreachable optimizer: a clear 503, not a hang.
  await expect(callEvaluator(`http://127.0.0.1:${await freePort()}`, token, same.request, 2_000)).rejects.toMatchObject({ status: 503, code: "evaluator_unavailable" });
}, 180_000);

test.skipIf(!hasUv)("a saved valid baseline starts a rerun from its plan, an invalid one cannot", async () => {
  const versionId = store.createScenario("Windows baselines", { schema_version: 1, document: windows.scenario }, "e2e").versionId;
  const settings = { ...windows.settings, solver_max_iterations: 200 };
  const finish = async (id: string) => { await waitFor(() => ["succeeded", "failed"].includes(store.runView(id)!.status)); return store.runView(id)!; };
  const runId = store.enqueue(versionId, { schema_version: 1, document: settings }, "baseline-source");
  expect((await finish(runId)).status).toBe("succeeded");

  // The saved baseline is the evaluator's real outcome for a hand plan (here the run's own routes, one stop moved to the end of its truck).
  const context = planContext(store, runId, "C1");
  const plan = { cluster_id: "C1", routes: context.reference_routes!.map(r => [...r]) };
  const evaluated = await callEvaluator(optimizerUrl, token, evaluationRequest(store, runId, plan).request);
  expect(evaluated.manual.valid).toBe(true);
  const evaluation = { evaluator_version: evaluated.evaluator_version, cluster_id: "C1", manual: evaluated.manual };
  const good = store.saveBaseline({ runId, ownerId: "operator", name: "Dispatcher plan", plan, evaluation, idempotencyKey: "good" });
  const merged = { cluster_id: "C1", routes: [plan.routes.flat()] };
  const bad = await callEvaluator(optimizerUrl, token, evaluationRequest(store, runId, merged).request);
  expect(bad.manual.valid).toBe(false);
  const broken = store.saveBaseline({ runId, ownerId: "operator", name: "One truck", plan: merged, evaluation: { evaluator_version: bad.evaluator_version, cluster_id: "C1", manual: bad.manual }, idempotencyKey: "bad" });
  expect([good.valid, broken.valid]).toEqual([true, false]);

  const warm = (baseline_id: string) => ({ schema_version: 1 as const, document: { ...settings, warm_start: { kind: "manual_baseline", baseline_id } } });
  expect(() => store.enqueue(versionId, warm(broken.id), "warm-bad")).toThrow("warm_start_baseline_invalid");
  const rerun = store.enqueue(versionId, warm(good.id), "warm-good");
  const view = await finish(rerun);
  expect(view.status).toBe("succeeded");
  const warmManifest = view.artifacts.find(a => a.stage_type === "warm_start")!;
  expect(store.readArtifact(warmManifest.output_hash)).toMatchObject({ source: { kind: "manual_baseline", baseline_id: good.id }, clusters: [{ cluster_id: "C1", status: "validated" }] });
  const summary = store.readArtifact(view.artifacts.find(a => a.stage_type === "summary")!.output_hash) as RunSummary;
  expect(summary.warm_start).toMatchObject({ source: { kind: "manual_baseline", baseline_id: good.id }, plan_id: warmManifest.output_hash, used: 1, skipped: 0 });
  const cluster = summary.clusters.find(c => c.id === "C1")!;
  expect(cluster.warm_start).toMatchObject({ status: "used", reason: null });
  expect(cluster.warm_start!.final_cost!).toBeLessThanOrEqual(cluster.warm_start!.initial_cost!);
  expect(summary.validity).toBe("valid");

  // Another owner cannot start from it, and deleting it afterwards leaves the finished run intact.
  expect(() => store.enqueue(versionId, warm(good.id), "warm-other", Date.now(), 3, "pipeline", { ownerId: "user:other" })).toThrow(/version_not_found|warm_start_source_not_found/);
  expect(store.deleteBaseline(good.id, "operator")).toBe(true);
  expect(store.runView(rerun)!.status).toBe("succeeded");
}, 240_000);
