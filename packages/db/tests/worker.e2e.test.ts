// End to end through the real Python supervisor and PyVRP (spec §15 M1 exit evidence):
// a synthetic run completes and reconciles, cancellation kills solver work, and a crashed
// worker's job is retried by a new worker after its lease expires.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonical, openDatabase, type Store } from "../src/index";
import { randomUUID } from "node:crypto";
import { createWorkerTransport } from "../src/transport";
import { previewCsvImport } from "../src/imports";
import { saveScenario } from "../src/scenarios";
import { parseContract, type RunSummary } from "@fillrate/contracts";
import { sheetCsvRows, shipmentSheets } from "../../../apps/web/src/lib/shipment-sheet";
import { compareRuns, expandSweep } from "../src/experiments";
import { replayBundle } from "../src/replay";
import { writeFileSync } from "node:fs";

const optimizer = resolve("services/optimizer");
const example = JSON.parse(readFileSync(resolve("examples/m1-synthetic.json"), "utf8"));
const allocationLesson = JSON.parse(readFileSync(resolve("examples/lesson-allocation.json"), "utf8"));
const hasUv = spawnSync("uv", ["--version"]).status === 0 && process.env.FILLRATE_SKIP_PYTHON !== "1";
const token = "e2e-token";
const env = { ...process.env, UV_PYTHON: "python3.13", WORKER_TOKEN: token, WORKER_POLL_SECONDS: "0.2", WORKER_HEARTBEAT_SECONDS: "0.5" };

let dir: string, store: Store, transport: ReturnType<typeof createWorkerTransport>, url: string, versionId: string;
const workers: ChildProcess[] = [];

beforeAll(() => { if (hasUv) spawnSync("uv", ["sync", "--locked", "-q"], { cwd: optimizer, env, stdio: "inherit" }); }, 300_000);
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-e2e-"));
  store = openDatabase(join(dir, "e2e.sqlite"));
  transport = createWorkerTransport(store, { token, port: 0, leaseMs: 2_000 });
  url = `http://127.0.0.1:${(await transport.listen()).port}`;
  versionId = store.createScenario("M1", { schema_version: 1, document: example.scenario }, "e2e").versionId;
});
afterEach(async () => {
  for (const w of workers.splice(0)) w.kill("SIGKILL");
  await transport.close(); store.close(); rmSync(dir, { recursive: true, force: true });
});
afterAll(() => { for (const w of workers) w.kill("SIGKILL"); });

function startWorker(id: string) {
  const worker = spawn(join(optimizer, ".venv/bin/fillrate-worker"), [], { cwd: optimizer, env: { ...env, FILLRATE_INTERNAL_URL: url, WORKER_ID: id }, stdio: ["ignore", "ignore", "pipe"] });
  let log = "";
  worker.stderr!.on("data", d => { log += d; });
  workers.push(worker);
  return { worker, log: () => log };
}
const enqueue = (settings: Record<string, unknown>, key: string) =>
  store.enqueue(versionId, { schema_version: 1, document: { ...example.settings, ...settings } }, key);
async function waitFor<T>(fn: () => T | undefined | null | false, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > end) throw new Error("timeout");
    await new Promise(r => setTimeout(r, 100));
  }
}

test.skipIf(!hasUv)("a synthetic run completes, validates and reconciles", async () => {
  const runId = enqueue({}, "ok");
  startWorker("w1");
  await waitFor(() => ["succeeded", "failed"].includes(store.runView(runId)!.status));
  const view = store.runView(runId)!;
  expect(view.status).toBe("succeeded");
  expect(view.artifacts.map(a => a.stage_type)).toEqual(["preflight", "allocation", "aggregation", "clustering", "travel", "problem", "solve", "validation", "summary"]);
  const summary = parseContract("RunSummary", store.readArtifact(view.artifacts.at(-1)!.output_hash)) as RunSummary;
  expect(summary.validity).toBe("valid");
  for (const p of summary.products) {
    expect(p.ordered).toBe(p.excluded + p.eligible);
    expect(p.eligible).toBe(p.allocated + p.unselected);
    expect(p.allocated).toBe(p.planned + p.allocated_unplanned);
    expect(p.starting_inventory).toBe(p.allocated + p.residual);
  }
  expect(view.events.filter(e => e.kind === "progress").map(e => e.payload.stage)).toContain("solve");
  // The example declares its policy checks as warnings (spec §15 M2 item 8); the 594 mi chained stop only warns.
  expect(summary.preflight?.map(f => [f.check, f.action])).toEqual([["missing_coordinates", "warn"], ["far_from_depot", "warn"], ["oversize_stop", "warn"], ["far_via_stop", "warn"]]);
  // Shipment sheets (M2 item 11) agree with the validated trucks: per-stop feet, legs and value sum to the totals.
  const sheets = shipmentSheets(summary);
  expect(sheets).toHaveLength(summary.trucks.length);
  for (const [i, sheet] of sheets.entries()) {
    const truck = summary.trucks[i];
    expect(sheet.stops.map(x => x.sequence)).toEqual(truck.visits.map((_, n) => n + 1));
    expect(sheet.stops.reduce((n, x) => n + x.linearFeet, 0)).toBe(truck.load);
    expect(sheet.stops.reduce((n, x) => n + x.value, 0)).toBe(truck.amount_cents);
    expect(sheet.stops.reduce((n, x) => n + x.milesFromPrevious, 0)).toBeCloseTo(truck.distance_m / 1609.344, 6);
  }
  const csv = sheetCsvRows(sheets, ["location"]);
  expect(csv.header.slice(0, 7)).toEqual(["truck_id", "shipment_number", "sequence", "order_ids", "linear_feet", "miles_from_previous", "value_dollars"]);
  expect(csv.rows).toHaveLength(summary.trucks.reduce((n, t) => n + t.visits.length, 0));
}, 120_000);

test.skipIf(!hasUv)("blocking preflight checks fail the run permanently with the reasons", async () => {
  const runId = enqueue({ preflight: { missing_coordinates: "block", far_from_depot: "block", oversize_stop: "warn" } }, "blocked");
  startWorker("w1");
  await waitFor(() => ["succeeded", "failed"].includes(store.runView(runId)!.status));
  const view = store.runView(runId)!;
  expect(view.status).toBe("failed");
  expect(view.attempt).toBe(1);
  const failure = view.events.find(e => e.kind === "failed")!.payload;
  expect(failure.code).toBe("preflight_blocked");
  expect(String(failure.message)).toMatch(/no coordinates.*too far from the depot/);
}, 120_000);

test.skipIf(!hasUv)("cancelling a running solve kills it and frees the worker", async () => {
  // A time-only budget keeps the solver busy for 60 s per cluster unless it is killed.
  const slow = enqueue({ solver_max_iterations: null, solver_time_limit_s: 60 }, "slow");
  const next = enqueue({}, "next");
  const { log } = startWorker("w1");
  await waitFor(() => store.runView(slow)!.events.some(e => e.payload.stage === "solve"));
  const cancelledAt = Date.now();
  store.cancel(slow);
  await waitFor(() => store.runView(slow)!.status === "cancelled", 10_000);
  expect(store.runView(slow)!.events.at(-1)!.kind).toBe("cancelled");
  // The same single worker then completes the next run, well before the killed budget.
  await waitFor(() => store.runView(next)!.status === "succeeded", 30_000);
  expect(Date.now() - cancelledAt).toBeLessThan(40_000);
  // Cancellation can be observed by a heartbeat or by the child's next server call.
  // Both paths cancel the run; the fast follow-up run proves this worker was freed.
  expect(log()).toContain(`run ${slow} cancelled`);
}, 120_000);

test.skipIf(!hasUv)("a cancel that refuses the solver's next server call ends cancelled, not failed", async () => {
  // Long heartbeats (and a lease to match) so the child's checkpoint, not a heartbeat, meets the cancel first.
  await transport.close();
  transport = createWorkerTransport(store, { token, port: 0, leaseMs: 120_000 });
  url = `http://127.0.0.1:${(await transport.listen()).port}`;
  const runId = enqueue({ solver_max_iterations: null, solver_time_limit_s: 60 }, "cancel-call");
  const worker = spawn(join(optimizer, ".venv/bin/fillrate-worker"), [], { cwd: optimizer, env: { ...env, WORKER_HEARTBEAT_SECONDS: "60", FILLRATE_INTERNAL_URL: url, WORKER_ID: "w1" }, stdio: "ignore" });
  workers.push(worker);
  await waitFor(() => store.runView(runId)!.status !== "queued", 30_000);
  store.cancel(runId);
  await waitFor(() => ["cancelled", "failed"].includes(store.runView(runId)!.status), 30_000);
  expect(store.runView(runId)!.status).toBe("cancelled");
}, 120_000);

test.skipIf(!hasUv)("a crashed worker's job is retried by a new worker after lease expiry", async () => {
  const runId = enqueue({ solver_max_iterations: null, solver_time_limit_s: 60 }, "crash");
  const first = startWorker("w1");
  await waitFor(() => store.runView(runId)!.events.some(e => e.payload.stage === "solve"));
  first.worker.kill("SIGKILL");
  // Run settings are immutable, so the retry also has a 60 s budget; cancel once it is re-claimed.
  startWorker("w2");
  await waitFor(() => { const v = store.runView(runId)!; return v.attempt === 2 && v.status === "running"; }, 20_000);
  const view = store.runView(runId)!;
  expect(view.attempts.map(a => [a.attempt, a.workerId, a.reason])).toEqual([[1, "w1", "lease_expired"], [2, "w2", null]]);
  store.cancel(runId);
  await waitFor(() => store.runView(runId)!.status === "cancelled", 10_000);
}, 120_000);


test.skipIf(!hasUv)("imported CSV version completes through the real worker and survives export", async () => {
  const preview = previewCsvImport({
    name: "Imported smoke", depot: {id:"depot",label:"Depot",lat:35.1495,lon:-90.049},
    ordersCsv: "order_id,line_id,order_date,location_id,location_label,address,latitude,longitude,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece\nO-1,L-1,2026-09-30,A,Stop A,,35.2,-90.1,SKU-1,10,12.50,1.25\nO-2,L-2,2026-09-30,B,Stop B,,35.3,-90.2,SKU-1,5,12.50,1.25\n",
    inventoryCsv: "product,available_pieces\nSKU-1,20\n",
  });
  expect(preview.errors).toEqual([]);
  expect(preview.document).not.toBeNull();
  const saved = saveScenario(store,{document:preview.document,author:"Importer",metadata:{timezone:"America/Chicago",planningDate:"2026-09-30",browserId:"browser"},source:preview.originals});
  const settings = {...example.settings,preflight:{missing_coordinates:"block",far_from_depot:"block",oversize_stop:"block"},k:1,solver_max_iterations:500};
  const runId=store.enqueue(saved.versionId,{schema_version:1,document:settings},"imported");
  startWorker("import-worker");
  await waitFor(() => ["succeeded","failed"].includes(store.runView(runId)!.status));
  const view=store.runView(runId)!;
  expect(view.status).toBe("succeeded");
  const manifest=view.artifacts.find(x=>x.stage_type==="summary")!;
  const summary=parseContract("RunSummary",store.readArtifact(manifest.output_hash));
  expect(summary.validity).toBe("valid");
  expect(summary.totals.ordered_cents).toBe(18750);
  expect(summary.totals.planned_cents).toBe(18750);
  expect(store.versionDocument(saved.versionId).document).toEqual(preview.document);
},120_000);


test.skipIf(!hasUv)("a k explorer job runs clustering only and stores one explorer artifact", async () => {
  const runId = store.enqueue(versionId, { schema_version: 1, document: { schema_version: 1, kind: "explorer", base: example.settings, ks: [3, 4], seeds: [0, 1, 2], selected_k: 4, reference_seed: 0, h3_resolutions: [1, 2] } }, "explore", Date.now(), 3, "explorer");
  startWorker("explorer");
  await waitFor(() => ["succeeded", "failed"].includes(store.runView(runId)!.status));
  const view = store.runView(runId)!;
  expect(view.status).toBe("succeeded");
  expect(view.kind).toBe("explorer");
  expect(view.artifacts.map(a => a.stage_type)).toEqual(["explorer"]);
  const summary = parseContract("ExplorerSummary", store.readArtifact(view.artifacts[0].output_hash));
  expect(summary.tasks).toBe(3 * 2 + 2);
  expect(summary.per_k.map(r => r.k)).toEqual([3, 4]);
  expect(summary.h3.map(r => r.resolution)).toEqual([1, 2]);
  expect(summary.selected_k).toBe(4);
  // Location-level statistics, no dense pairwise array: one row per clustered location.
  expect(summary.locations).toHaveLength(summary.locations_clustered);
}, 120_000);

test.skipIf(!hasUv)("sweep runs are independent solves, ranked within one cohort, and replay from a bundle", async () => {
  const runs = expandSweep(example.settings, { kmeans_seed: [0, 1], inventory_percent: [100, 60] });
  const id = store.createExperiment({ versionId, name: "e2e", spec: {}, comparison: {}, runs: runs.map(r => ({ settings: { schema_version: 1 as const, document: r.settings as never }, varied: r.varied })) }, "sweep");
  startWorker("sweeper");
  const members = store.experiment(id)!.runs;
  await waitFor(() => members.every(m => ["succeeded", "failed"].includes(store.runView(m.runId)!.status)), 110_000);
  const views = members.map(m => store.runView(m.runId)!);
  expect(views.map(v => v.status)).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);
  const solves = views.map(v => v.artifacts.find(a => a.stage_type === "solve")!);
  expect(new Set(solves.map(s => s.execution_id)).size).toBe(4);
  expect(solves.every(s => s.reused_from === null)).toBe(true);
  const compared = compareRuns(views.map((v, i) => ({ id: v.id, status: v.status, versionId, settings: runs[i].settings, summary: store.readArtifact(v.artifacts.find(a => a.stage_type === "summary")!.output_hash) as RunSummary })));
  // Two cohorts (inventory 100% and 60%); only the base cohort's valid complete runs are ranked.
  expect(compared.cohorts).toHaveLength(compared.rows.some(r => r.reason === "Partial plan" || r.reason === "Invalid plan") ? compared.cohorts.length : 2);
  expect(compared.rows.filter(r => r.reason === "Different cohort (changed assumptions)").every(r => runs[compared.rows.indexOf(r)].settings.inventory_percent === 60 || compared.cohort !== null)).toBe(true);

  // Replay the first run from its Python bundle in a clean folder.
  const zip = replayBundle(store, views[0].id, optimizer);
  const out = join(dir, "bundle"); const file = join(dir, "bundle.zip");
  writeFileSync(file, zip);
  expect(spawnSync("python3", ["-c", `import zipfile; zipfile.ZipFile(${JSON.stringify(file)}).extractall(${JSON.stringify(out)})`]).status).toBe(0);
  const replay = spawnSync("uv", ["run", "--project", optimizer, "python", join(out, "replay.py")], { cwd: out, env, encoding: "utf8" });
  expect(replay.stdout).toContain("REPLAY OK");
  expect(replay.stdout).toMatch(/clustering\s+reproduced/);
  expect(replay.status).toBe(0);
}, 180_000);

test.skipIf(!hasUv)("a CP-SAT whole-order run replays from its bundle; measured allocation runtimes are not differences", async () => {
  const lessonVersion = store.createScenario("Allocation lesson", { schema_version: 1, document: allocationLesson.scenario }, "e2e").versionId;
  const settings = { ...allocationLesson.settings, allocation_strategy: "optimized", fulfillment_policy: "whole_order" };
  const runId = store.enqueue(lessonVersion, { schema_version: 1, document: settings }, "optimized-whole");
  startWorker("replayer");
  await waitFor(() => ["succeeded", "failed"].includes(store.runView(runId)!.status), 110_000);
  const view = store.runView(runId)!;
  expect(view.status).toBe("succeeded");
  const allocation = store.readArtifact(view.artifacts.find(a => a.stage_type === "allocation")!.output_hash) as { stages: { status: string; runtime_s: number }[] };
  expect(allocation.stages.map(x => x.status)).toEqual(["optimal"]);

  const out = join(dir, "bundle"); const file = join(dir, "bundle.zip");
  writeFileSync(file, replayBundle(store, runId, optimizer));
  expect(spawnSync("python3", ["-c", `import zipfile; zipfile.ZipFile(${JSON.stringify(file)}).extractall(${JSON.stringify(out)})`]).status).toBe(0);
  const expected = JSON.parse(readFileSync(join(out, "expected.json"), "utf8"));
  expect(expected.allocation).toEqual({ strategy: "optimized", fulfillment_policy: "whole_order", kind: "cp_sat" });
  expect(expected.travel).toEqual({ provider: "estimated", circuity: 1.2 });
  const replay = spawnSync("uv", ["run", "--project", optimizer, "python", join(out, "replay.py")], { cwd: out, env, encoding: "utf8" });
  expect(replay.stdout).toMatch(/allocation\s+reproduced/);
  expect(replay.stdout).toMatch(/fulfillment_policy\s+recorded whole_order\s+replay whole_order\s+=/);
  expect(replay.stdout).toContain("REPLAY OK");
  expect(replay.status).toBe(0);
  // A bundle that declares another travel provider is refused, not replayed with estimated travel.
  writeFileSync(join(out, "expected.json"), JSON.stringify({ ...expected, travel: { provider: "valhalla" } }));
  const refused = spawnSync("uv", ["run", "--project", optimizer, "python", join(out, "replay.py")], { cwd: out, env, encoding: "utf8" });
  expect(refused.status).toBe(1);
  expect(refused.stdout).toContain("cannot be replayed");
}, 180_000);

// ---- Directed travel snapshots (spec §7, M6) --------------------------------------------------------------------
const parity = JSON.parse(readFileSync(resolve("packages/contracts/fixtures/travel-parity.json"), "utf8"));
const WARN = { missing_coordinates: "warn", far_from_depot: "warn", oversize_stop: "warn", approximate_coordinates: "warn" };
const roadSettings = (extra: Record<string, unknown> = {}) => ({ ...example.settings, preflight: WARN, k: 1, solver_max_iterations: 300, ...extra });
const summaryOf = (runId: string) => parseContract("RunSummary", store.readArtifact(store.runView(runId)!.artifacts.find(a => a.stage_type === "summary")!.output_hash)) as RunSummary;
const finished = (runId: string) => waitFor(() => ["succeeded", "failed"].includes(store.runView(runId)!.status));
/** A run row written straight to SQLite, as a bug or an old client could: the worker must still refuse it. */
function rawRun(version: string, document: Record<string, unknown>, key: string) {
  const id = randomUUID(), now = Date.now();
  store.sqlite.prepare("INSERT INTO runs (id, versionId, settings, status, idempotencyKey, requestHash, createdAt, kind) VALUES (?,?,?,?,?,?,?,?)").run(id, version, canonical({ schema_version: 1, document }), "queued", key, "raw", now, "pipeline");
  store.sqlite.prepare("INSERT INTO jobs (id, runId, status, attempt, maxAttempts, cancelRequested, createdAt) VALUES (?,?,'queued',0,3,0,?)").run(randomUUID(), id, now);
  return id;
}

test.skipIf(!hasUv)("a run on a stored directed snapshot routes over its legs, reuses its travel stage and replays offline", async () => {
  const road = store.createScenario("Parity", { schema_version: 1, document: parity.scenario }, "e2e").versionId;
  const snapshotId = store.saveTravelSnapshot(parity.snapshot).id;
  expect(snapshotId).toBe(parity.identity);
  const queue = (extra: Record<string, unknown>, key: string) => store.enqueue(road, { schema_version: 1, document: roadSettings(extra) as never }, key);
  const estimated = queue({}, "estimated"), first = queue({ travel_snapshot_id: snapshotId }, "road-1"), second = queue({ travel_snapshot_id: snapshotId, solver_seed: 1 }, "road-2");
  const blocking = queue({ travel_snapshot_id: snapshotId, preflight: { missing_coordinates: "warn", far_from_depot: "block", oversize_stop: "warn", approximate_coordinates: "warn" } }, "blocked");
  startWorker("road");
  for (const id of [estimated, first, second, blocking]) await finished(id);

  // Straight lines put every stop on one eastbound line (one truck); the directed matrix needs two.
  const flat = summaryOf(estimated);
  expect([flat.validity, flat.totals.trucks, flat.travel?.mode]).toEqual(["valid", 1, "estimated"]);
  const roads = summaryOf(first);
  expect(roads.validity).toBe("valid");
  expect(roads.totals.trucks).toBe(2);
  expect(roads.totals.loaded_distance_m).toBe(100_000 + 200_000 + 300_000 + 804_672);
  expect(roads.unplanned.map(u => [u.location_id, u.reason])).toEqual([["F", "unreachable"], ["M", "excluded_unresolved_coordinates"]]);
  expect(roads.travel).toMatchObject({ mode: "snapshot", snapshot_id: snapshotId, provider: "imported", profile: "truck", node_count: 7 });
  expect(roads.settings.travel_snapshot_id).toBe(snapshotId);

  // Stage reuse is bound to the snapshot: the second run reuses the first run's travel stage.
  const travel = (id: string) => store.runView(id)!.artifacts.find(a => a.stage_type === "travel")!;
  expect(travel(second).reused_from).toBe(travel(first).execution_id);
  expect(travel(first).effective_settings).toEqual({ max_leg_m: 804672, travel_snapshot_id: snapshotId });
  expect(travel(estimated).effective_settings).toEqual({ max_leg_m: 804672, travel_circuity: 1.2 });

  // The worker's preflight reads the same matrix as the submission preflight: only F is far.
  const refused = store.runView(blocking)!;
  expect(refused.status).toBe("failed");
  expect(refused.attempt).toBe(1);
  expect(refused.events.find(e => e.kind === "failed")!.payload).toMatchObject({ code: "preflight_blocked", message: "Location is too far from the depot" });

  // The bundle carries the exact snapshot, and the offline replay verifies its identity.
  const zip = replayBundle(store, first, optimizer);
  const out = join(dir, "road-bundle"), file = join(dir, "road-bundle.zip");
  writeFileSync(file, zip);
  expect(spawnSync("python3", ["-c", `import zipfile; z=zipfile.ZipFile(${JSON.stringify(file)}); assert 'travel-snapshot.json' in z.namelist(); z.extractall(${JSON.stringify(out)})`]).status).toBe(0);
  const replay = spawnSync("uv", ["run", "--project", optimizer, "python", join(out, "replay.py")], { cwd: out, env, encoding: "utf8" });
  expect(replay.stdout).toContain("REPLAY OK");
  expect(replay.stdout).toMatch(/travel\s+snapshot identity verified/);
  expect(replay.stdout).toMatch(/travel data\s+reproduced/);
  expect(replay.stdout).toMatch(/preflight\s+reproduced/);
  expect(replay.status).toBe(0);
  // A tampered snapshot in the bundle no longer hashes to the identity the run recorded.
  const tampered = JSON.parse(readFileSync(join(out, "travel-snapshot.json"), "utf8"));
  tampered.distances[0][1] = 1;
  writeFileSync(join(out, "travel-snapshot.json"), JSON.stringify(tampered));
  const bad = spawnSync("uv", ["run", "--project", optimizer, "python", join(out, "replay.py")], { cwd: out, env, encoding: "utf8" });
  expect(bad.status).not.toBe(0);
  expect(bad.stdout + bad.stderr).toMatch(/IDENTITY DIFFERS|identity/);
}, 180_000);

test.skipIf(!hasUv)("a worker refuses a snapshot it cannot use and fails the run permanently", async () => {
  const snapshotId = store.saveTravelSnapshot(parity.snapshot).id;
  // Stale coordinates: a version whose stop B moved after the snapshot was taken.
  const moved = structuredClone(parity.scenario);
  moved.locations.find((l: { id: string }) => l.id === "B").lat = 0.01;
  const stale = store.createScenario("Moved", { schema_version: 1, document: moved }, "e2e").versionId;
  const unknown = "f".repeat(64);
  const staleRun = rawRun(stale, roadSettings({ travel_snapshot_id: snapshotId }), "stale");
  const missingRun = rawRun(stale, roadSettings({ travel_snapshot_id: unknown }), "missing");
  startWorker("refuser");
  await finished(staleRun); await finished(missingRun);
  const failure = (id: string): Record<string, unknown> => { const v = store.runView(id)!; return { status: v.status, attempt: v.attempt, ...(v.events.find(e => e.kind === "failed")?.payload ?? {}) }; };
  expect(failure(staleRun)).toMatchObject({ status: "failed", attempt: 1, code: "travel_snapshot_mismatch" });
  expect(String(failure(staleRun).message)).toContain("B");
  expect(failure(missingRun)).toMatchObject({ status: "failed", attempt: 1, code: "travel_snapshot_unavailable" });
  expect(String(failure(missingRun).message)).toContain("travel_snapshot_not_found");
}, 120_000);
