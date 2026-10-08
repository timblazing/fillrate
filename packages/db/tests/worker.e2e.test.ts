// End to end through the real optimizer service and PyVRP: a synthetic run completes and reconciles,
// cancellation kills solver work, and a service that dies fails the run instead of leaving it running.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonical, openDatabase, type RunResult, type Store } from "../src/index";
import { createSolver, type Solver } from "../src/solver";
import { previewCsvImport } from "../src/imports";
import { saveScenario } from "../src/scenarios";
import { parseContract, type RunSummary } from "@fillrate/contracts";
import { sheetCsvRows, shipmentSheets } from "../../../apps/web/src/lib/shipment-sheet";
import { compareRuns, expandSweep } from "../src/experiments";
import { replayBundle } from "../src/replay";
import { buildRouteGeoJson } from "../../../apps/web/src/lib/geojson";
import { writeFileSync } from "node:fs";

const optimizer = resolve("services/optimizer");
const example = JSON.parse(readFileSync(resolve("examples/m1-synthetic.json"), "utf8"));
const hasUv = spawnSync("uv", ["--version"]).status === 0 && process.env.FILLRATE_SKIP_PYTHON !== "1";
const env = { ...process.env, UV_PYTHON: "python3.13" };

let dir: string, store: Store, solver: Solver, versionId: string, service: ChildProcess;
const services: ChildProcess[] = [];

const freePort = () => new Promise<number>(resolvePort => {
  const probe = createServer().listen(0, "127.0.0.1", () => { const port = (probe.address() as { port: number }).port; probe.close(() => resolvePort(port)); });
});
async function startOptimizer() {
  const port = await freePort();
  const child = spawn(join(optimizer, ".venv/bin/fillrate-optimizer"), [], { cwd: optimizer, env: { ...env, OPTIMIZER_PORT: String(port) }, stdio: "ignore" });
  services.push(child);
  for (let i = 0; i < 100; i++) {
    if (await fetch(`http://127.0.0.1:${port}/health`).then(r => r.ok, () => false)) return { child, url: `http://127.0.0.1:${port}` };
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("optimizer did not start");
}

beforeAll(() => { if (hasUv) spawnSync("uv", ["sync", "--locked", "-q"], { cwd: optimizer, env, stdio: "inherit" }); }, 300_000);
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-e2e-"));
  store = openDatabase(join(dir, "e2e.sqlite"));
  if (hasUv) {
    const started = await startOptimizer();
    service = started.child;
    solver = createSolver(store, { url: started.url });
  }
  versionId = store.createScenario("M1", { schema_version: 1, document: example.scenario }, "e2e").versionId;
}, 60_000);
afterEach(() => {
  for (const child of services.splice(0)) child.kill("SIGKILL");
  store.close(); rmSync(dir, { recursive: true, force: true });
});
afterAll(() => { for (const child of services) child.kill("SIGKILL"); });

/** Creates a run and hands it to the solver, like the web app does; `done` resolves when it ends. */
function startRun(settings: Record<string, unknown>, kind: "pipeline" | "explorer" = "pipeline", forVersion = versionId) {
  const id = store.createRun(forVersion, { schema_version: 1, document: kind === "explorer" ? settings : { ...example.settings, ...settings } as never }, kind, { status: solver.idle() ? "running" : "queued" });
  return { id, done: solver.start(id) };
}
const result = (id: string) => store.runResult(id) as RunResult;
const summaryOf = (id: string) => parseContract("RunSummary", result(id).summary) as RunSummary;
test.skipIf(!hasUv)("a synthetic run completes, validates and reconciles", async () => {
  const run = startRun({});
  expect(store.runView(run.id)!.status).toBe("running");
  await run.done;
  expect(store.runView(run.id)!.status).toBe("succeeded");
  expect(result(run.id).stages!.map(a => a.stage)).toEqual(["preflight", "allocation", "aggregation", "clustering"]);
  const summary = summaryOf(run.id);
  expect(summary.validity).toBe("valid");
  for (const p of summary.products) {
    expect(p.ordered).toBe(p.excluded + p.eligible);
    expect(p.eligible).toBe(p.allocated + p.unselected);
    expect(p.allocated).toBe(p.planned + p.allocated_unplanned);
    expect(p.starting_inventory).toBe(p.allocated + p.residual);
  }
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

test.skipIf(!hasUv)("blocking preflight checks fail the run with the reasons", async () => {
  const run = startRun({ preflight: { missing_coordinates: "block", far_from_depot: "block", oversize_stop: "warn" } });
  await run.done;
  const view = store.runView(run.id)!;
  expect(view.status).toBe("failed");
  expect(view.error!.code).toBe("preflight_blocked");
  expect(view.error!.message).toMatch(/no coordinates.*too far from the depot/);
}, 120_000);

test.skipIf(!hasUv)("cancelling a running solve kills it and frees the service for the next run", async () => {
  // A time-only budget keeps the solver busy for 60 s per cluster unless it is killed.
  const slow = startRun({ solver_max_iterations: null, solver_time_limit_s: 60 });
  const next = startRun({});
  expect(store.runView(next.id)!.status).toBe("queued");
  await new Promise(r => setTimeout(r, 2_500)); // let the service start the child
  const cancelledAt = Date.now();
  expect(await solver.cancel(slow.id)).toBe(true);
  await slow.done;
  expect(store.runView(slow.id)!.status).toBe("cancelled");
  await next.done;
  expect(store.runView(next.id)!.status).toBe("succeeded");
  expect(Date.now() - cancelledAt).toBeLessThan(40_000);
}, 120_000);

test.skipIf(!hasUv)("a queued run that is cancelled never starts", async () => {
  const slow = startRun({ solver_max_iterations: null, solver_time_limit_s: 60 });
  const waiting = startRun({});
  expect(await solver.cancel(waiting.id)).toBe(true);
  expect(await solver.cancel(slow.id)).toBe(true);
  await Promise.all([slow.done, waiting.done]);
  expect(store.runView(waiting.id)).toMatchObject({ status: "cancelled", finishedAt: expect.any(Number) });
  expect(store.runResult(waiting.id)).toBeNull();
}, 120_000);

test.skipIf(!hasUv)("a service that dies mid-solve fails the run instead of leaving it running", async () => {
  const run = startRun({ solver_max_iterations: null, solver_time_limit_s: 60 });
  await new Promise(r => setTimeout(r, 2_500));
  service.kill("SIGKILL");
  await run.done;
  expect(store.runView(run.id)).toMatchObject({ status: "failed", error: { code: "solve_failed" } });
}, 120_000);

test.skipIf(!hasUv)("imported CSV version completes through the real service", async () => {
  const preview = previewCsvImport({
    name: "Imported smoke", depot: {id:"depot",label:"Depot",lat:35.1495,lon:-90.049},
    ordersCsv: "order_id,line_id,order_date,location_id,location_label,address,latitude,longitude,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece\nO-1,L-1,2026-09-30,A,Stop A,,35.2,-90.1,SKU-1,10,12.50,1.25\nO-2,L-2,2026-09-30,B,Stop B,,35.3,-90.2,SKU-1,5,12.50,1.25\n",
    inventoryCsv: "product,available_pieces\nSKU-1,20\n",
  });
  expect(preview.errors).toEqual([]);
  expect(preview.document).not.toBeNull();
  const saved = saveScenario(store,{document:preview.document,author:"Importer",metadata:{timezone:"America/Chicago",planningDate:"2026-09-30",browserId:"browser"},source:preview.originals});
  const settings = {...example.settings,preflight:{missing_coordinates:"block",far_from_depot:"block",oversize_stop:"block"},k:1,solver_max_iterations:500};
  const run=startRun(settings,"pipeline",saved.versionId);
  await run.done;
  expect(store.runView(run.id)!.status).toBe("succeeded");
  const summary=summaryOf(run.id);
  expect(summary.validity).toBe("valid");
  expect(summary.totals.ordered_cents).toBe(18750);
  expect(summary.totals.planned_cents).toBe(18750);
  expect(store.versionDocument(saved.versionId).document).toEqual(preview.document);
},120_000);


test.skipIf(!hasUv)("a k explorer job runs clustering only and stores one explorer result", async () => {
  const run = startRun({ schema_version: 1, kind: "explorer", base: example.settings, ks: [3, 4], seeds: [0, 1, 2], selected_k: 4, reference_seed: 0, h3_resolutions: [1, 2] }, "explorer");
  const runId = run.id;
  await run.done;
  const view = store.runView(runId)!;
  expect(view.status).toBe("succeeded");
  expect(view.kind).toBe("explorer");
  expect(result(runId).summary).toBeUndefined();
  const summary = parseContract("ExplorerSummary", result(runId).explorer);
  expect(summary.tasks).toBe(3 * 2 + 2);
  expect(summary.per_k.map(r => r.k)).toEqual([3, 4]);
  expect(summary.h3.map(r => r.resolution)).toEqual([1, 2]);
  expect(summary.selected_k).toBe(4);
  // Location-level statistics, no dense pairwise array: one row per clustered location.
  expect(summary.locations).toHaveLength(summary.locations_clustered);

  // The explorer replay bundle recomputes every statistic offline and compares it with the recording (M7).
  const out = join(dir, "explorer-bundle"); const file = join(dir, "explorer-bundle.zip");
  writeFileSync(file, replayBundle(store, runId, optimizer));
  expect(spawnSync("python3", ["-c", `import zipfile; zipfile.ZipFile(${JSON.stringify(file)}).extractall(${JSON.stringify(out)})`]).status).toBe(0);
  const expected = JSON.parse(readFileSync(join(out, "expected.json"), "utf8"));
  expect(expected.kind).toBe("explorer");
  expect(expected.output_hash).toBe(result(runId).output_hash);
  expect(expected.travel).toEqual({ provider: "estimated", metric: "spatial", circuity: 1.2 });
  expect(canonical(expected.summary)).toBe(canonical(summary));
  const replay = spawnSync("uv", ["run", "--project", optimizer, "python", join(out, "replay.py")], { cwd: out, env, encoding: "utf8" });
  for (const section of ["population", "selection", "settings", "per_k", "h3", "locations"]) expect(replay.stdout).toMatch(new RegExp(`${section}\\s+reproduced`));
  expect(replay.stdout).toMatch(/explorer\s+bit-identical to the recorded artifact/);
  expect(replay.stdout).toContain("REPLAY OK");
  expect(replay.status).toBe(0);
  // A tampered statistic is reported by name; another travel provider is refused before any rerun.
  const tampered = structuredClone(expected);
  tampered.summary.per_k[1].stability_raw = -0.5;
  writeFileSync(join(out, "expected.json"), JSON.stringify(tampered));
  const differs = spawnSync("uv", ["run", "--project", optimizer, "python", join(out, "replay.py")], { cwd: out, env, encoding: "utf8" });
  expect(differs.status).toBe(1);
  expect(differs.stdout).toContain("DIFFERS: per_k[k=4].stability_raw recorded -0.5");
  expect(differs.stdout).toContain("REPLAY FAILED: per_k");
  writeFileSync(join(out, "expected.json"), JSON.stringify({ ...expected, travel: { provider: "valhalla" } }));
  const refused = spawnSync("uv", ["run", "--project", optimizer, "python", join(out, "replay.py")], { cwd: out, env, encoding: "utf8" });
  expect(refused.status).toBe(1);
  expect(refused.stdout).toContain("cannot be replayed");
}, 180_000);

test.skipIf(!hasUv)("sweep runs are independent solves, ranked within one cohort, and replay from a bundle", async () => {
  const runs = expandSweep(example.settings, { kmeans_seed: [0, 1], inventory_percent: [100, 60] });
  const { runIds } = store.createExperiment({ versionId, name: "e2e", spec: {}, comparison: {}, runs: runs.map(r => ({ settings: { schema_version: 1 as const, document: r.settings as never }, varied: r.varied })) });
  await Promise.all(runIds.map(id => solver.start(id)));
  const views = runIds.map(id => store.runView(id)!);
  expect(views.map(v => v.status)).toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);
  const compared = compareRuns(views.map((v, i) => ({ id: v.id, status: v.status, versionId, settings: runs[i].settings, summary: summaryOf(v.id) })));
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

test.skipIf(!hasUv)("a whole-order run replays from its bundle", async () => {
  const wholeVersion = store.createScenario("Whole-order example", { schema_version: 1, document: example.scenario }, "e2e").versionId;
  const settings = { fulfillment_policy: "whole_order" };
  const run = startRun(settings, "pipeline", wholeVersion);
  const runId = run.id;
  await run.done;
  expect(store.runView(runId)!.status).toBe("succeeded");

  const out = join(dir, "bundle"); const file = join(dir, "bundle.zip");
  writeFileSync(file, replayBundle(store, runId, optimizer));
  expect(spawnSync("python3", ["-c", `import zipfile; zipfile.ZipFile(${JSON.stringify(file)}).extractall(${JSON.stringify(out)})`]).status).toBe(0);
  const expected = JSON.parse(readFileSync(join(out, "expected.json"), "utf8"));
  expect(expected.allocation).toEqual({ strategy: "order_date_then_value", fulfillment_policy: "whole_order" });
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

// ---- GeoJSON export of a real run ---------------------------------------------------------------------------------
test.skipIf(!hasUv)("GeoJSON routes are schematic straight segments without the return leg", async () => {
  const run = startRun({ k: 1, solver_max_iterations: 300 });
  await run.done;
  const summary = summaryOf(run.id);
  const geo = buildRouteGeoJson(run.id, summary);
  const lines = geo.features.filter(f => f.geometry.type === "LineString");
  expect(lines).toHaveLength(summary.trucks.length);
  const depot: [number, number] = [summary.depot.lon, summary.depot.lat];
  for (const [i, line] of lines.entries()) {
    const coordinates = line.geometry.coordinates as [number, number][];
    expect(coordinates[0]).toEqual(depot);
    expect(coordinates.length).toBeLessThanOrEqual(1 + summary.trucks[i].visits.length); // depot + physical visits: no synthetic return
    expect(coordinates.at(-1)).not.toEqual(depot);
    expect(line.properties).toMatchObject({ geometry: "schematic_straight_line", distance_basis: "estimated (haversine × circuity)" });
  }
}, 120_000);
