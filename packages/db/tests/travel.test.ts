// Directed travel snapshots (spec §7, M6): validation and identity agree with the Python implementation, storage is
// immutable and verified on read, runs bind to stored snapshots at enqueue, and only the leased run's worker can read one.
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { RunSettings, ScenarioDocument } from "@fillrate/contracts";
import { openDatabase, type Store } from "../src/index";
import { assertSnapshotBinding, preflightChecks } from "../src/preflight";
import { changedAssumptions, comparisonSignature, expandSweep, SweepError } from "../src/experiments";
import { createWorkerTransport } from "../src/transport";
import { zipStore } from "../src/replay";
import { bindNodes, effectiveMeters, normalizeSnapshot, roundHalfEven, snapshotIdentity, stopNodes, type TravelSnapshot } from "../src/travel";

// The same file pytest asserts against (services/optimizer/tests/travel_parity.py generates it).
const parity = JSON.parse(readFileSync(resolve("packages/contracts/fixtures/travel-parity.json"), "utf8")) as {
  scenario: ScenarioDocument; snapshot: TravelSnapshot; identity: string;
  effective_meters: { nodes: string[]; matrix: number[][] };
  findings: unknown[]; findings_excluding_F: unknown[];
};
const clone = <T,>(x: T) => structuredClone(x);
const withDefaults = (extra: Partial<RunSettings> = {}) => ({ ...extra }) as RunSettings;

test("identity, integer-meter conversion and preflight findings match the Python implementation", () => {
  const snapshot = normalizeSnapshot(parity.snapshot);
  expect(snapshotIdentity(snapshot)).toBe(parity.identity);
  // Defaults are filled in, so a document that omits them has the same identity.
  const bare: Record<string, unknown> = clone(parity.snapshot);
  delete bare.schema_version; delete bare.warnings; delete bare.conversion;
  expect(snapshotIdentity(normalizeSnapshot(bare))).toBe(parity.identity);

  const nodes = parity.effective_meters.nodes.map(id => snapshot.nodes.find(n => n.id === id)!);
  expect(effectiveMeters(snapshot, nodes)).toEqual(parity.effective_meters.matrix);

  const settings = { travel_snapshot_id: parity.identity };
  expect(preflightChecks(parity.scenario, settings, snapshot)).toEqual(parity.findings);
  expect(preflightChecks(parity.scenario, { ...settings, excluded_line_ids: ["L-F"] }, snapshot)).toEqual(parity.findings_excluding_F);
});

test("rounding is nearest-integer, ties to even", () => {
  expect([0.5, 1.5, 2.5, -0.5, 804672.5, 804673.5, 2.4999, 2.5001].map(roundHalfEven)).toEqual([0, 2, 2, 0, 804672, 804674, 2, 3]);
});

test("preflight needs the selected snapshot, and never silently falls back to estimates", () => {
  const snapshot = normalizeSnapshot(parity.snapshot);
  expect(() => preflightChecks(parity.scenario, { travel_snapshot_id: parity.identity })).toThrow("travel_snapshot_required");
  expect(() => preflightChecks(parity.scenario, {}, snapshot)).toThrow("travel_snapshot_required");
  // Estimated: every stop is within 500 miles on the straight line, so only the missing coordinates are flagged.
  expect(preflightChecks(parity.scenario).map(f => f.check)).toEqual(["missing_coordinates"]);
});

test("edited coordinates and absent stops are reported, not routed over", () => {
  const snapshot = normalizeSnapshot(parity.snapshot);
  const moved = clone(parity.scenario);
  moved.locations.find(l => l.id === "A")!.lon = 1.001;
  try { assertSnapshotBinding(moved, [], snapshot); throw new Error("expected a stale binding"); }
  catch (error) { expect((error as Error).message).toMatch(/^travel_snapshot_stale: coordinates changed since the snapshot: A/); expect((error as { binding: unknown }).binding).toEqual({ missing: [], moved: ["A"] }); }
  // A stop whose only lines are excluded carries no demand, so its stale coordinates do not matter.
  expect(() => assertSnapshotBinding(moved, ["L-A"], snapshot)).not.toThrow();
  const without = clone(parity.snapshot);
  const at = without.nodes.findIndex(n => n.id === "E");
  without.nodes.splice(at, 1);
  for (const key of ["distances", "durations"] as const) { without[key].splice(at, 1); for (const row of without[key]) row.splice(at, 1); }
  expect(bindNodes(normalizeSnapshot(without), stopNodes(parity.scenario.depot, new Map([["E", { lat: 0, lon: 4 }]])))).toEqual({ missing: ["E"], moved: [] });
  const clash = clone(parity.scenario);
  clash.locations[0].id = "D"; clash.orders[0].location_id = "D";
  expect(() => assertSnapshotBinding(clash, [], snapshot)).toThrow("travel_snapshot_nodes");
});

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
test.each<[string, (d: Doc) => void]>([
  ["duplicate node", d => d.nodes.push(d.nodes[0])],
  ["short matrix", d => d.distances.pop()],
  ["short row", d => d.distances[0].pop()],
  ["nonzero diagonal", d => { d.distances[0][0] = 1; d.durations[0][0] = 1; }],
  ["null diagonal", d => d.distances[0][0] = null],
  ["negative", d => d.distances[0][1] = -1],
  ["over 2^40", d => d.distances[0][1] = 2 ** 41],
  ["boolean", d => d.distances[0][1] = true],
  ["string", d => d.distances[0][1] = "400"],
  ["reachability disagrees", d => d.durations[0][1] = null],
  ["bad units", d => d.distance_units = "feet"],
  ["bad provider", d => d.provider = "osrm"],
  ["latitude", d => d.nodes[0].lat = 91],
  ["unknown field", d => d.endpoint = "http://valhalla"],
  ["node field", d => d.nodes[0].name = "x"],
  ["options not an object", d => d.options = []],
  ["empty text", d => d.profile = ""],
  ["unsafe integer option", d => d.options.big = 2 ** 60],
  ["warning not an object", d => d.warnings = ["x"]],
  ["bad conversion", d => d.conversion = "round-half-up"],
])("an invalid snapshot is rejected: %s", (_name, change) => {
  const document: Doc = clone(parity.snapshot);
  change(document);
  expect(() => normalizeSnapshot(document)).toThrow(/^invalid_travel_snapshot/);
});

let dir: string, store: Store, versionId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-travel-"));
  store = openDatabase(join(dir, "test.sqlite"));
  versionId = store.createScenario("Parity", { schema_version: 1, document: parity.scenario as never }, "Test").versionId;
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
const settings = (extra: Record<string, unknown> = {}) => ({ schema_version: 1 as const, document: { travel_snapshot_id: parity.identity, ...extra } });

test("snapshots are stored once by content hash, read back verified and immutable", () => {
  const saved = store.saveTravelSnapshot(parity.snapshot);
  expect(saved).toMatchObject({ id: parity.identity, created: true, nodeCount: 7, provider: "imported", profile: "truck" });
  expect(store.saveTravelSnapshot(clone(parity.snapshot))).toMatchObject({ id: parity.identity, created: false });
  expect(store.travelSnapshot(parity.identity)).toEqual(normalizeSnapshot(parity.snapshot));
  expect(() => store.sqlite.prepare("UPDATE travel_snapshots SET nodeCount=1").run()).toThrow(/immutable/);
  expect(() => store.sqlite.prepare("DELETE FROM travel_snapshots").run()).toThrow(/cannot be deleted/);
  expect(() => store.travelSnapshot("0".repeat(64))).toThrow("travel_snapshot_not_found");
  expect(() => store.saveTravelSnapshot({ ...parity.snapshot, distances: [] })).toThrow(/^invalid_travel_snapshot/);
  // A row whose bytes do not hash to its identity is corrupt, whatever wrote it.
  const row = store.sqlite.prepare("SELECT compressed, byteLength FROM travel_snapshots").get() as { compressed: Buffer; byteLength: number };
  store.sqlite.prepare("INSERT INTO travel_snapshots VALUES (?,?,?,?,?,?,?,?,?)").run("a".repeat(64), row.compressed, row.byteLength, 7, "imported", "v", "d", "truck", 1);
  expect(() => store.travelSnapshot("a".repeat(64))).toThrow("travel_snapshot_corrupt");
});

test("a run must select a stored snapshot that still matches the scenario's coordinates", () => {
  expect(() => store.enqueue(versionId, settings(), "missing")).toThrow("travel_snapshot_not_found");
  store.saveTravelSnapshot(parity.snapshot);
  const runId = store.enqueue(versionId, settings(), "ok");
  expect(store.runView(runId)!.settings.document.travel_snapshot_id).toBe(parity.identity);
  // Estimated runs carry no snapshot and are unaffected.
  expect(() => store.enqueue(versionId, settings({ travel_snapshot_id: null }), "estimated")).not.toThrow();

  // The scenario moves a stop after the snapshot was taken: a new version cannot reuse the old matrix.
  const edited = clone(parity.scenario);
  edited.locations.find(l => l.id === "B")!.lat = 0.01;
  const scenarioId = (store.sqlite.prepare("SELECT scenarioId FROM scenario_versions WHERE id=?").get(versionId) as { scenarioId: string }).scenarioId;
  const next = store.saveVersion(scenarioId, versionId, { schema_version: 1, document: edited as never }, "Editor");
  expect(() => store.enqueue(next, settings(), "stale")).toThrow(/^travel_snapshot_stale: coordinates changed since the snapshot: B/);
  expect(() => store.enqueue(next, settings({ excluded_line_ids: ["L-B"] }), "stale-but-excluded")).not.toThrow();
  const count = () => (store.sqlite.prepare("SELECT count(*) AS n FROM runs").get() as { n: number }).n;
  const before = count();
  expect(() => store.createExperiment({ versionId: next, name: "sweep", spec: {}, comparison: {}, runs: [{ settings: settings(), varied: {} }, { settings: settings({ k: 2 }), varied: {} }] }, "sweep")).toThrow("travel_snapshot_stale");
  expect(count()).toBe(before);
  expect(store.listExperiments()).toEqual([]);
});

test("only the leased run's worker can read the snapshot it selected, over the loopback transport", async () => {
  store.saveTravelSnapshot(parity.snapshot);
  const other = clone(parity.snapshot);
  other.profile = "auto";
  const otherId = store.saveTravelSnapshot(other).id;
  const transport = createWorkerTransport(store, { token: "t".repeat(64), port: 0 });
  const base = `http://127.0.0.1:${(await transport.listen()).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${"t".repeat(64)}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  try {
    const plain = store.enqueue(versionId, { schema_version: 1, document: {} }, "plain");
    const unselected = (await (await post("/internal/worker/claim", { worker_id: "w" })).json()).job;
    expect(unselected.run_id).toBe(plain);
    expect((await post("/internal/worker/snapshot", { lease: unselected.lease, snapshot_id: parity.identity })).status).toBe(400);
    await post("/internal/worker/events", { event: { lease: unselected.lease, sequence: 1, kind: "failed", payload: { code: "x" } } });

    store.enqueue(versionId, settings(), "selected");
    const job = (await (await post("/internal/worker/claim", { worker_id: "w" })).json()).job;
    const ok = await post("/internal/worker/snapshot", { lease: job.lease, snapshot_id: parity.identity });
    expect(ok.status).toBe(200);
    expect((await ok.json()).snapshot).toEqual(normalizeSnapshot(parity.snapshot));
    // Another stored snapshot, a forged lease and a missing token are all refused.
    const wrong = await post("/internal/worker/snapshot", { lease: job.lease, snapshot_id: otherId });
    expect([wrong.status, (await wrong.json()).error]).toEqual([400, "travel_snapshot_not_selected"]);
    const forged = await post("/internal/worker/snapshot", { lease: { ...job.lease, lease_token: crypto.randomUUID() }, snapshot_id: parity.identity });
    expect([forged.status, (await forged.json()).error]).toEqual([409, "stale_lease"]);
    expect((await fetch(base + "/internal/worker/snapshot", { method: "POST", body: "{}" })).status).toBe(401);
  } finally { await transport.close(); }
});

test("a selected snapshot changes the comparison signature and the changed-assumption chips", () => {
  const base = { ...withDefaults({ travel_circuity: 1.2, preflight: {} as never, trailer_capacity: 5300, cluster_circuity: 1.2, max_leg_m: 804672, inventory_percent: 100, max_cluster_diameter_m: null, excluded_line_ids: [] }) } as RunSettings;
  const versions = { pipeline: "fillrate-pipeline/3" };
  const estimated = comparisonSignature("v1", base, versions);
  // Existing signatures do not change: an explicit null is the same as no field.
  expect(comparisonSignature("v1", { ...base, travel_snapshot_id: null }, versions).signature).toBe(estimated.signature);
  const road = comparisonSignature("v1", { ...base, travel_snapshot_id: parity.identity }, versions);
  expect(road.signature).not.toBe(estimated.signature);
  expect(road.definition).toMatchObject({ travel: { snapshot: parity.identity }, metrics: { travel_circuity: null } });
  // The estimating circuity is not an assumption of a snapshot run; another snapshot is.
  expect(comparisonSignature("v1", { ...base, travel_snapshot_id: parity.identity, travel_circuity: 1.5 }, versions).signature).toBe(road.signature);
  expect(comparisonSignature("v1", { ...base, travel_snapshot_id: "b".repeat(64) }, versions).signature).not.toBe(road.signature);
  expect(changedAssumptions(base, { ...base, travel_snapshot_id: parity.identity })).toEqual(["Road travel snapshot"]);
  expect(changedAssumptions({ ...base, travel_snapshot_id: parity.identity }, base)).toEqual(["Estimated travel"]);
  expect(changedAssumptions(base, { ...base, travel_circuity: 1.5 })).toEqual(["Travel circuity 1.5"]);
});

test("sweeps keep the snapshot on every run and refuse a circuity axis that no longer applies", () => {
  const base = { ...withDefaults({ cluster_strategy: "kmeans", k: 1, allocation_strategy: "order_date_then_value", travel_snapshot_id: parity.identity }) } as RunSettings;
  const runs = expandSweep(base, { solver_seed: [0, 1] });
  expect(runs.map(r => r.settings.travel_snapshot_id)).toEqual([parity.identity, parity.identity]);
  expect(() => expandSweep(base, { travel_circuity: [1.2, 1.5] })).toThrow(SweepError);
  expect(expandSweep({ ...base, travel_snapshot_id: null }, { travel_circuity: [1.2, 1.5] })).toHaveLength(2);
});

test("a deflated zip entry round-trips and stored entries are unchanged", () => {
  if (spawnSync("python3", ["--version"]).status !== 0) return;
  const text = Buffer.from("matrix ".repeat(5000));
  const zip = zipStore([["a.txt", Buffer.from("plain")], ["b.json", text, true]]);
  expect(zip.length).toBeLessThan(text.length / 4);
  const file = join(dir, "z.zip");
  writeFileSync(file, zip);
  const out = spawnSync("python3", ["-c", `import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print([(i.filename,i.compress_type) for i in z.infolist()], z.read('b.json')==('matrix '*5000).encode(), z.read('a.txt'))`, file], { encoding: "utf8" });
  expect(out.stdout.trim()).toBe("[('a.txt', 0), ('b.json', 8)] True b'plain'");
});
