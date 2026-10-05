// Durable Valhalla snapshot job through the real Python worker against a loopback FAKE Valhalla (no live
// service): the stored snapshot is content-addressed, owner-linked, binds to its version, and a pipeline run
// on it routes over the fake's directed distances.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, type Store } from "../src/index";
import { createWorkerTransport } from "../src/transport";
import { bindNodes, normalizeSnapshot, snapshotIdentity } from "../src/travel";
import { createTravelSnapshotJob, valhallaConfigured } from "../src/travel-job";
import { parseContract, type RunSummary } from "@fillrate/contracts";

const optimizer = resolve("services/optimizer");
const parity = JSON.parse(readFileSync(resolve("packages/contracts/fixtures/travel-parity.json"), "utf8"));
const example = JSON.parse(readFileSync(resolve("examples/m1-synthetic.json"), "utf8"));
const hasUv = spawnSync("uv", ["--version"]).status === 0 && process.env.FILLRATE_SKIP_PYTHON !== "1";
const token = "e2e-token";
const A = "owner-a", B = "owner-b";
const WARN = { missing_coordinates: "warn", far_from_depot: "warn", oversize_stop: "warn", approximate_coordinates: "warn" };

type Point = { lat: number; lon: number };
/** Directed fake distances in km (exact in binary): 100 km per degree of longitude plus a direction-dependent term. */
const fakeKm = (s: Point, t: Point) => (s.lat === t.lat && s.lon === t.lon ? 0 : 100 * Math.abs(s.lon - t.lon) + (s.lon < t.lon ? 1.5 : 7.25));

let dir: string, store: Store, transport: ReturnType<typeof createWorkerTransport>, url: string, versionId: string;
let fake: Server, fakeUrl: string, fakeCalls: number, fakeMode: { status?: number; delayMs?: number };
const workers: ChildProcess[] = [];

beforeAll(() => { if (hasUv) spawnSync("uv", ["sync", "--locked", "-q"], { cwd: optimizer, env: { ...process.env, UV_PYTHON: "python3.13" }, stdio: "inherit" }); }, 300_000);
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-m6job-"));
  store = openDatabase(join(dir, "e2e.sqlite"));
  transport = createWorkerTransport(store, { token, port: 0, leaseMs: 2_000 });
  url = `http://127.0.0.1:${(await transport.listen()).port}`;
  versionId = store.createScenario("Parity", { schema_version: 1, document: parity.scenario }, "e2e", Date.now(), A).versionId;
  fakeCalls = 0; fakeMode = {};
  fake = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c as Buffer));
    req.on("end", () => {
      fakeCalls++;
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { sources: Point[]; targets: Point[] };
      setTimeout(() => {
        if (fakeMode.status) { res.writeHead(fakeMode.status, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "rejected" })); }
        const rows = body.sources.map((s, i) => body.targets.map((t, j) => ({ from_index: i, to_index: j, distance: fakeKm(s, t), time: fakeKm(s, t) * 60 })));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ units: "kilometers", algorithm: "timedistancematrix", sources_to_targets: rows }));
      }, fakeMode.delayMs ?? 0);
    });
  });
  await new Promise<void>(r => fake.listen(0, "127.0.0.1", r));
  fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
});
afterEach(async () => {
  for (const w of workers.splice(0)) w.kill("SIGKILL");
  await transport.close(); await new Promise(r => fake.close(r)); store.close(); rmSync(dir, { recursive: true, force: true });
});
afterAll(() => { for (const w of workers) w.kill("SIGKILL"); });

const valhallaEnv = () => ({ VALHALLA_URL: fakeUrl, VALHALLA_VERSION: "fake-valhalla/1", VALHALLA_DATASET_REVISION: "fixture-extract", VALHALLA_GRAPH_CONFIG_HASH: "sha256:fixture", VALHALLA_COSTING_OPTIONS: JSON.stringify({ length: 21.64 }), VALHALLA_BLOCK_SIZE: "2", VALHALLA_MAX_MATRIX_DISTANCE_M: "5000000" });
function startWorker(id: string, extra: Record<string, string> = valhallaEnv()) {
  const worker = spawn(join(optimizer, ".venv/bin/fillrate-worker"), [], { cwd: optimizer, env: { ...process.env, UV_PYTHON: "python3.13", WORKER_TOKEN: token, WORKER_POLL_SECONDS: "0.2", WORKER_HEARTBEAT_SECONDS: "0.3", FILLRATE_INTERNAL_URL: url, WORKER_ID: id, ...extra }, stdio: ["ignore", "ignore", "pipe"] });
  workers.push(worker);
  return worker;
}
async function waitFor<T>(fn: () => T | undefined | null | false, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error("timeout"); await new Promise(r => setTimeout(r, 100)); }
}
const job = (key: string, owner = A) => createTravelSnapshotJob(store, versionId, key, { ownerId: owner, env: valhallaEnv() });
const ended = (id: string) => waitFor(() => ["succeeded", "failed", "cancelled"].includes(store.runView(id)!.status) && store.runView(id)!);
const result = (view: ReturnType<Store["runView"]>) => view!.events.find(e => e.kind === "succeeded")?.payload as { snapshot_id: string; node_count: number; blocks: number; kind: string };

test("valhallaConfigured needs every deployment setting", () => {
  expect(valhallaConfigured({})).toBe(false);
  expect(valhallaConfigured({ ...valhallaEnv(), VALHALLA_GRAPH_CONFIG_HASH: "" })).toBe(false);
  expect(valhallaConfigured(valhallaEnv())).toBe(true);
});

test("unconfigured: a clear error and no run is enqueued", () => {
  expect(() => createTravelSnapshotJob(store, versionId, "k", { ownerId: A, env: {} })).toThrow(/^valhalla_not_configured/);
  expect(store.listRuns(10, A)).toEqual([]);
});

test("another owner cannot queue a build on, or see a snapshot from, this version", () => {
  expect(() => job("other", B)).toThrow();
  expect(store.listRuns(10, B)).toEqual([]);
});

test.skipIf(!hasUv)("a job stores a content-addressed, owner-linked snapshot that binds to its version; a pipeline run on it uses its directed legs; replay is idempotent", async () => {
  const run = job("build-1");
  expect(job("build-1")).toBe(run); // idempotent replay: the same run, not a second job
  startWorker("w1");
  const view = await ended(run);
  expect(view.status).toBe("succeeded");
  const summary = result(view);
  expect(summary).toMatchObject({ kind: "travel_snapshot", node_count: 6 });
  expect(summary.blocks).toBe(9); // 6 nodes in blocks of 2: 3 × 3
  expect(fakeCalls).toBe(9);
  expect(view.events.some(e => e.kind === "progress" && (e.payload as { blocks_total?: number }).blocks_total === 9)).toBe(true);
  expect(store.listRuns(10, A).filter(r => r.kind === "travel_snapshot")).toHaveLength(1);

  // Identity is the content hash; the owner is linked; nobody else sees it.
  const snapshot = store.travelSnapshot(summary.snapshot_id);
  expect(snapshotIdentity(snapshot)).toBe(summary.snapshot_id);
  expect(store.ownsTravelSnapshot(summary.snapshot_id, A)).toBe(true);
  expect(store.ownsTravelSnapshot(summary.snapshot_id, B)).toBe(false);
  expect(snapshot).toMatchObject({ provider: "valhalla", provider_version: "fake-valhalla/1", dataset_revision: "fixture-extract", profile: "truck", distance_units: "kilometers" });
  expect(snapshot.distances[0][1]).toBe(101.5);
  expect(snapshot.distances[1][0]).toBe(107.25); // asymmetric
  expect(bindNodes(snapshot, store.travelSnapshotNodes(versionId))).toEqual({ missing: [], moved: [] });

  // A pipeline run selecting it routes over exactly the fake's directed distances.
  const pipeline = store.enqueue(versionId, { schema_version: 1, document: { ...example.settings, preflight: WARN, k: 1, solver_max_iterations: 300, travel_snapshot_id: summary.snapshot_id } as never }, "pipeline-1", Date.now(), 3, "pipeline", { ownerId: A });
  const done = await ended(pipeline);
  expect(done.status).toBe("succeeded");
  const run2 = parseContract("RunSummary", store.readArtifact(done.artifacts.find(a => a.stage_type === "summary")!.output_hash)) as RunSummary;
  expect(run2.travel).toMatchObject({ mode: "snapshot", snapshot_id: summary.snapshot_id, provider: "valhalla" });
  const coords = new Map<string, Point>([["D", { lat: 0, lon: 0 }], ...parity.scenario.locations.map((l: { id: string; lat: number; lon: number }) => [l.id, { lat: l.lat, lon: l.lon }] as const)]);
  let legs = 0;
  for (const truck of run2.trucks) {
    let at = "D";
    for (const visit of [...truck.visits].sort((x, y) => x.sequence - y.sequence)) {
      expect(visit.leg_m).toBe(Math.round(fakeKm(coords.get(at)!, coords.get(visit.location_id)!) * 1000));
      at = visit.location_id; legs++;
    }
  }
  expect(legs).toBeGreaterThan(0);
}, 120_000);

test.skipIf(!hasUv)("a rejected request fails the run with a stable code, is not retried and stores nothing", async () => {
  fakeMode = { status: 400 };
  const run = job("reject");
  startWorker("w1");
  const view = await ended(run);
  expect(view.status).toBe("failed");
  expect(view.attempt).toBe(1);
  expect(view.events.find(e => e.kind === "failed")!.payload).toMatchObject({ code: "valhalla_request_rejected" });
  expect(fakeCalls).toBe(1);
  expect(store.listTravelSnapshots(A)).toEqual([]);
}, 60_000);

test.skipIf(!hasUv)("a worker without Valhalla settings fails the run with valhalla_not_configured", async () => {
  const run = job("worker-unconfigured");
  startWorker("w1", { VALHALLA_URL: "" });
  const view = await ended(run);
  expect(view.status).toBe("failed");
  expect(view.events.find(e => e.kind === "failed")!.payload).toMatchObject({ code: "valhalla_not_configured" });
  expect(store.listTravelSnapshots(A)).toEqual([]);
}, 60_000);

test.skipIf(!hasUv)("cancelling mid-build ends cancelled and stores no snapshot", async () => {
  fakeMode = { delayMs: 700 };
  const run = job("cancel");
  startWorker("w1");
  await waitFor(() => fakeCalls >= 1);
  store.cancel(run);
  const view = await ended(run);
  expect(view.status).toBe("cancelled");
  expect(fakeCalls).toBeLessThan(9);
  expect(store.listTravelSnapshots(A)).toEqual([]);
  expect(store.sqlite.prepare("SELECT count(*) AS n FROM travel_snapshots").get()).toEqual({ n: 0 });
}, 60_000);

test("the server verifies identity, binding and cancellation before storing a worker's snapshot", () => {
  const run = job("verify");
  const claimed = store.claim("w", Date.now(), 60_000)!;
  expect(claimed.run.id).toBe(run);
  const doc = (nodes: { id: string; lat: number; lon: number }[]) => {
    const m = nodes.map((_, i) => nodes.map((__, j) => (i === j ? 0 : 5)));
    return { nodes, provider: "valhalla", provider_version: "v", dataset_revision: "d", profile: "truck", options: {}, distance_units: "kilometers", duration_units: "seconds", distances: m, durations: m };
  };
  const nodes = store.travelSnapshotNodes(versionId);
  const full = doc(nodes), id = snapshotIdentity(normalizeSnapshot(full));
  expect(() => store.storeLeaseTravelSnapshot(claimed.lease, full, "0".repeat(64))).toThrow(/^travel_snapshot_hash_mismatch/);
  const short = doc(nodes.slice(0, -1));
  expect(() => store.storeLeaseTravelSnapshot(claimed.lease, short, snapshotIdentity(normalizeSnapshot(short)))).toThrow(/^travel_snapshot_stale/);
  store.cancel(run);
  expect(() => store.storeLeaseTravelSnapshot(claimed.lease, full, id)).toThrow(/^cancel_requested/);
  expect(store.sqlite.prepare("SELECT count(*) AS n FROM travel_snapshots").get()).toEqual({ n: 0 });
});
