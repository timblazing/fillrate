// Valhalla road geometry (spec §4, §7): the context rule, the truck's physical stop sequence, and the separate,
// run-scoped cache that goes away with its run or owner.
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunSummary } from "@fillrate/contracts";
import { openDatabase, type Store } from "../src/index";
import { saveScenario } from "../src/scenarios";
import { deploymentIdentity, geometryEligibility, geometryKey, geometryRequest, GeometryError } from "../src/route-geometry";
import example from "../../../examples/m1-synthetic.json";

const metadata = { timezone: "America/Chicago", planningDate: "2026-09-30", browserId: "test-browser" };
const ENV = {
  VALHALLA_URL: "http://127.0.0.1:8002", VALHALLA_VERSION: "valhalla-3.9.0", VALHALLA_DATASET_REVISION: "extract-1",
  VALHALLA_GRAPH_CONFIG_HASH: "sha256:graph", VALHALLA_COSTING_OPTIONS: '{"length":21.64,"weight":21.77}',
};
let dir: string, store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fillrate-geometry-")); store = openDatabase(join(dir, "test.sqlite")); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

function snapshot(provider: "valhalla" | "imported" | "haversine", extra: Record<string, unknown> = {}, version = "valhalla-3.9.0") {
  const doc = {
    nodes: [{ id: "D", lat: 35, lon: -90 }, { id: "A", lat: 35.1, lon: -90.1 }], provider, provider_version: provider === "valhalla" ? version : "x/1",
    dataset_revision: "extract-1", profile: provider === "haversine" ? "estimated" : "truck",
    options: provider === "valhalla" ? { costing_options: { length: 21.64, weight: 21.77 }, graph_config_hash: "sha256:graph", ...extra } : { ...extra },
    distance_units: "kilometers", duration_units: "seconds", distances: [[0, 10], [10, 0]], durations: [[0, 600], [600, 0]],
  };
  return store.saveTravelSnapshot(doc).id;
}
const summaryFor = (provider: string, snapshotId: string | null): RunSummary => ({
  depot: { id: "D", label: "Depot", lat: 35, lon: -90 },
  travel: snapshotId ? { mode: "snapshot", provider, provider_version: "v", dataset_revision: "extract-1", profile: "truck", snapshot_id: snapshotId } : { mode: "estimated", provider: "haversine", provider_version: "h", dataset_revision: "e", profile: "estimated", circuity: 1.2 },
  locations: [
    { id: "A", label: "A", lat: 35.1, lon: -90.1 }, { id: "B", label: "B", lat: 35.2, lon: -90.2 }, { id: "N", label: "N", lat: null, lon: null },
  ],
  trucks: [{ id: "C1-T1", cluster_id: "C1", visits: [{ visit_id: "v2", location_id: "B", sequence: 2 }, { visit_id: "v1", location_id: "A", sequence: 1 }] },
    { id: "C1-T2", cluster_id: "C1", visits: [{ visit_id: "v3", location_id: "N", sequence: 1 }] }],
}) as unknown as RunSummary;

test("only a Valhalla snapshot recorded under this deployment's identity is eligible", () => {
  const ok = snapshot("valhalla");
  const eligible = geometryEligibility(store, summaryFor("valhalla", ok), ENV);
  expect(eligible).toMatchObject({ eligible: true, snapshotId: ok });
  const refuse = (summary: RunSummary, env: Record<string, string | undefined> = ENV) => { const r = geometryEligibility(store, summary, env); return r.eligible ? "eligible" : r.reason; };
  expect(refuse(summaryFor("haversine", null))).toBe("estimated_travel");
  expect(refuse(summaryFor("imported", snapshot("imported")))).toBe("imported_matrix");
  expect(refuse(summaryFor("valhalla", ok), {})).toBe("valhalla_not_configured");
  expect(refuse(summaryFor("valhalla", ok), { ...ENV, VALHALLA_DATASET_REVISION: "extract-2" })).toBe("provider_context_mismatch");
  expect(refuse(summaryFor("valhalla", ok), { ...ENV, VALHALLA_VERSION: "valhalla-3.10" })).toBe("provider_context_mismatch");
  expect(refuse(summaryFor("valhalla", ok), { ...ENV, VALHALLA_GRAPH_CONFIG_HASH: "sha256:other" })).toBe("provider_context_mismatch");
  expect(refuse(summaryFor("valhalla", ok), { ...ENV, VALHALLA_COSTING_OPTIONS: '{"length":12}' })).toBe("provider_context_mismatch");
  // Key order in the options never matters.
  expect(refuse(summaryFor("valhalla", ok), { ...ENV, VALHALLA_COSTING_OPTIONS: '{"weight":21.77,"length":21.64}' })).toBe("eligible");
  // A snapshot recorded under other options (built by another deployment) does not match.
  expect(refuse(summaryFor("valhalla", snapshot("valhalla", { graph_config_hash: "sha256:elsewhere" })))).toBe("provider_context_mismatch");
  expect(deploymentIdentity({ ...ENV, VALHALLA_COSTING_OPTIONS: "nope" })).toBeNull();
});

test("the request is the depot then the visits in sequence order, with no return leg and no reordering", () => {
  const id = snapshot("valhalla");
  const request = geometryRequest(store, summaryFor("valhalla", id), "C1-T1", id);
  expect(request.stops.map(s => s.id)).toEqual(["D", "A", "B"]);
  expect(request.snapshot_id).toBe(id);
  try { geometryRequest(store, summaryFor("valhalla", id), "nope", id); expect.unreachable(); } catch (error) { expect((error as GeometryError).code).toBe("truck_not_found"); }
  try { geometryRequest(store, summaryFor("valhalla", id), "C1-T2", id); expect.unreachable(); } catch (error) { expect((error as GeometryError).code).toBe("stop_without_coordinates"); }
});

test("the cache is keyed by run, truck, snapshot and deployment, stored apart from results, and goes with its run or owner", () => {
  const saved = saveScenario(store, { document: structuredClone(example.scenario), author: "T", metadata, source: { ordersCsv: "x" }, ownerId: "user:a" });
  const runId = store.enqueue(saved.versionId, { schema_version: 1, document: { n: 0 } }, "k1", 1, 3, "pipeline", { ownerId: "user:a" });
  const id = snapshot("valhalla");
  const dep = "d".repeat(64);
  const key = geometryKey(runId, "C1-T1", id, dep);
  expect(key).toBe(geometryKey(runId, "C1-T1", id, dep));
  expect(key).not.toBe(geometryKey(runId, "C1-T2", id, dep));
  expect(key).not.toBe(geometryKey(runId, "C1-T1", id, "e".repeat(64)));
  expect(key).not.toBe(geometryKey("other-run", "C1-T1", id, dep));
  expect(store.routeGeometry(key)).toBeNull();
  const payload = { kind: "valhalla_road", legs: [{ index: 0, coordinates: [[-90, 35], [-90.1, 35.1]] }] };
  store.saveRouteGeometry({ key, runId, truckId: "C1-T1", snapshotId: id, deployment: dep }, payload);
  store.saveRouteGeometry({ key, runId, truckId: "C1-T1", snapshotId: id, deployment: dep }, payload); // idempotent
  expect(store.routeGeometry(key)).toEqual(payload);
  expect(store.routeGeometryTrucks(runId, dep)).toEqual(["C1-T1"]);
  expect(store.routeGeometryTrucks(runId, "e".repeat(64))).toEqual([]);
  // Deleting the owner's data removes the run, its cached geometry and the now unreferenced artifact.
  (store as unknown as { sqlite: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).sqlite.prepare("UPDATE jobs SET status='cancelled' WHERE runId=?").run(runId);
  store.deleteOwnerData("user:a");
  expect(store.routeGeometry(key)).toBeNull();
  expect(store.routeGeometryTrucks(runId, dep)).toEqual([]);
});
