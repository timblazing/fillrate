// End to end through the real Python supervisor and PyVRP (spec §15 M1 exit evidence):
// a synthetic run completes and reconciles, cancellation kills solver work, and a crashed
// worker's job is retried by a new worker after its lease expires.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, type Store } from "../src/index";
import { createWorkerTransport } from "../src/transport";
import { previewCsvImport } from "../src/imports";
import { saveScenario } from "../src/scenarios";
import { parseContract, type RunSummary } from "@fillrate/contracts";
import { sheetCsvRows, shipmentSheets } from "../../../apps/web/src/lib/shipment-sheet";

const optimizer = resolve("services/optimizer");
const example = JSON.parse(readFileSync(resolve("examples/m1-synthetic.json"), "utf8"));
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
  // The example declares its three blocking preflight cases as warnings (spec v1.8 §15 M2 item 8).
  expect(summary.preflight?.map(f => [f.check, f.action])).toEqual([["missing_coordinates", "warn"], ["far_from_depot", "warn"], ["oversize_stop", "warn"]]);
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
  expect(log()).toContain("solver process killed");
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
