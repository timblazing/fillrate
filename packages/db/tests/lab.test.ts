// Solver Lab runs (M6): instance validation in TypeScript, hidden lab versions, the `lab` run kind, owner
// isolation and admission charged in the queuing transaction (spec §4, §9, §14).
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LabInstance } from "@fillrate/contracts";
import { AdmissionError, EXAMPLES_OWNER, openDatabase, type Admission, type Store } from "../src/index";
import { enqueueLabRun, isLabVersion, LAB_SETTINGS, LabInstanceError, labExampleVersion, labRun, validateLabInstance } from "../src/lab";
import { saveScenario, scenarioList, scenarioVersion } from "../src/scenarios";
import dimensions from "../../../examples/lab-dimensions.json";
import fleet from "../../../examples/lab-fleet.json";
import groups from "../../../examples/lab-groups.json";
import prizes from "../../../examples/lab-prizes.json";
import reloads from "../../../examples/lab-reloads.json";
import depots from "../../../examples/lab-depots.json";
import example from "../../../examples/m1-synthetic.json";

const A = "user:a", B = "user:b", DAY = 86_400_000;
const metadata = { timezone: "America/Chicago", planningDate: "2026-09-30", browserId: "test-browser" };
let dir: string, store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fillrate-lab-")); store = openDatabase(join(dir, "test.sqlite")); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

const instance = (patch: Record<string, unknown> = {}) => ({ ...structuredClone(dimensions), ...patch }) as unknown as LabInstance;
const failure = (input: unknown) => { try { validateLabInstance(input); return null; } catch (error) { return error instanceof LabInstanceError ? [error.code, error.message] : ["other", String(error)]; } };
const quota = (ownerId: string): Admission => ({ ownerId, maxActive: 1, maxQueued: 10, buckets: [{ bucket: `solves:${ownerId}`, limit: 5, windowMs: DAY, label: "daily solve admissions" }] });

test("bundled lab examples validate; planned capabilities are refused by name", () => {
  expect(validateLabInstance(structuredClone(dimensions)).name).toBe(dimensions.name);
  expect(validateLabInstance(structuredClone(fleet)).coordinates).toBe("geographic");
  expect(failure(instance({ depots: [dimensions.depots[0], { id: "d2", x: 1, y: 1 }] }))).toBeNull();
  expect(validateLabInstance(structuredClone(depots)).depots).toHaveLength(2);
  expect(failure(instance({ vehicle_types: [{ ...dimensions.vehicle_types[0], start_depot: "nowhere" }] }))?.[1]).toContain('start_depot "nowhere" is not a depot id');
  expect(failure(instance({ vehicle_types: [{ ...dimensions.vehicle_types[0], profile: "bike" }] }))?.[1]).toContain("routing_profiles");
  expect(failure(instance({ shipments: [] }))?.[1]).toContain("planned capability paired_shipments");
  expect(failure(instance({ clients: [{ ...dimensions.clients[0], prize: 3, required: false }] }))).toBeNull();
  expect(failure(instance({ clients: [{ ...dimensions.clients[0], prize: 3 }] }))?.[1]).toContain("has a prize but is required");
  expect(validateLabInstance(structuredClone(prizes)).clients.filter(c => c.required === false)).toHaveLength(3);
  expect(failure(instance({ vehicle_types: [{ ...dimensions.vehicle_types[0], reload_depots: ["depot"], max_reloads: 2 }] }))).toBeNull();
  expect(failure(instance({ vehicle_types: [{ ...dimensions.vehicle_types[0], reload_depots: ["nowhere"], max_reloads: 2 }] }))?.[1]).toContain('reload depot "nowhere" is not a depot id');
  expect(failure(instance({ vehicle_types: [{ ...dimensions.vehicle_types[0], reload_depots: ["depot"] }] }))?.[1]).toContain("need max_reloads of at least 1");
  expect(validateLabInstance(structuredClone(reloads)).vehicle_types[0].max_reloads).toBe(3);
  expect(failure(instance({ clients: [{ ...dimensions.clients[0], group: "g" }] }))?.[0]).toBe("invalid_lab_instance");
  expect(validateLabInstance(structuredClone(groups)).groups).toHaveLength(1);
  const alt = (patch: Record<string, unknown>) => instance({ clients: [{ ...dimensions.clients[0], id: "a", required: false }, { ...dimensions.clients[1], id: "b", required: false }, dimensions.clients[2]], groups: [{ id: "g", members: ["a", "b"], ...patch }] });
  expect(failure(alt({}))).toBeNull();
  expect(failure(alt({ members: ["a", "zzz"] }))?.[1]).toContain('member "zzz" is not a client id');
  expect(failure(alt({ members: ["a", "a"] }))?.[1]).toContain("lists a member twice");
  expect(failure(instance({ clients: dimensions.clients, groups: [{ id: "g", members: [dimensions.clients[0].id, dimensions.clients[1].id] }] }))?.[1]).toContain("must be an optional client");
});

test("lab instances are checked structurally and against their own references", () => {
  expect(failure(instance({ coordinates: "spherical" }))?.[0]).toBe("invalid_lab_instance");
  expect(failure(instance({ clients: [{ id: "x", lat: 1, lon: 2, delivery: { weight: 1 } }] }))?.[1]).toContain("planar instances need x and y");
  expect(failure(instance({ clients: [{ id: "x", x: 1, y: 2, delivery: { mass: 1 } }] }))?.[1]).toContain("unknown dimension");
  expect(failure(instance({ vehicle_types: [{ id: "t", count: 1, capacity: { weight: 1 } }] }))?.[1]).toContain("capacity must name exactly");
  expect(failure(instance({ clients: [{ id: "x", x: 1, y: 2, delivery: { weight: 5_000 } }] }))?.[1]).toContain("fits no vehicle type");
  expect(failure(instance({ clients: [{ id: "depot", x: 1, y: 2 }] }))?.[1]).toContain('duplicate location id "depot"');
  expect(failure(instance({ vehicle_types: [{ ...dimensions.vehicle_types[0], count: 2.5 }] }))?.[0]).toBe("invalid_lab_instance");
  expect(failure([1, 2])?.[0]).toBe("invalid_lab_instance");
});

test("an owner's instance is a hidden version: never a scenario, run only as a lab run", () => {
  const runId = enqueueLabRun(store, { instance: validateLabInstance(instance()) }, "lab-1", { ownerId: A, now: 1 });
  const view = store.runView(runId)!;
  expect(view.kind).toBe("lab");
  expect(view.settings).toEqual(LAB_SETTINGS);
  expect(isLabVersion(store, view.versionId)).toBe(true);
  expect(store.versionOwner(view.versionId)).toBe(A);
  // Not listed or readable as a scenario, and not usable by the pipeline, a sweep or a save.
  expect(scenarioList(store, A)).toHaveLength(0);
  const scenarioId = (store.sqlite.prepare("SELECT scenarioId FROM scenario_versions WHERE id=?").get(view.versionId) as { scenarioId: string }).scenarioId;
  expect(() => scenarioVersion(store, scenarioId, undefined, A)).toThrow("scenario_not_found");
  expect(() => store.enqueue(view.versionId, { schema_version: 1, document: {} }, "pipe", 1, 3, "pipeline", { ownerId: A })).toThrow("version_not_found");
  expect(() => store.createExperiment({ versionId: view.versionId, name: "x", spec: {}, comparison: {}, runs: [{ settings: { schema_version: 1, document: {} }, varied: {} }], ownerId: A }, "sweep")).toThrow("version_not_found");
  expect(() => saveScenario(store, { document: structuredClone(example.scenario), author: "T", metadata, scenarioId, expectedVersionId: view.versionId, ownerId: A })).toThrow("scenario_not_found");
  // And a scenario version cannot be run as a lab instance.
  const scenario = saveScenario(store, { document: structuredClone(example.scenario), author: "T", metadata, ownerId: A });
  expect(isLabVersion(store, scenario.versionId)).toBe(false);
  expect(() => enqueueLabRun(store, { versionId: scenario.versionId }, "lab-2", { ownerId: A })).toThrow("lab_version_required");
  expect(scenarioList(store, A)).toHaveLength(1);
  // The same instance again reuses the version; the same key with another instance is a conflict.
  const again = enqueueLabRun(store, { instance: validateLabInstance(instance()) }, "lab-3", { ownerId: A, now: 2 });
  expect(store.runView(again)!.versionId).toBe(view.versionId);
  expect(() => enqueueLabRun(store, { instance: validateLabInstance(instance({ name: "other" })) }, "lab-1", { ownerId: A })).toThrow("idempotency_conflict");
  expect(labRun(store, runId)).toMatchObject({ instance: { name: dimensions.name }, result: null });
});

test("owner isolation: another account cannot see or reuse a lab instance; bundled examples are public", () => {
  const mine = enqueueLabRun(store, { instance: validateLabInstance(instance()) }, "a-run", { ownerId: A });
  const theirs = enqueueLabRun(store, { instance: validateLabInstance(instance()) }, "b-run", { ownerId: B });
  // Identical content, separate private versions: content never grants access.
  expect(store.runView(mine)!.versionId).not.toBe(store.runView(theirs)!.versionId);
  expect(store.listRuns(50, B).map(r => r.id)).not.toContain(mine);
  expect(store.listRuns(50, A).map(r => r.id)).not.toContain(theirs);
  expect(() => enqueueLabRun(store, { versionId: store.runView(mine)!.versionId }, "b-steal", { ownerId: B })).toThrow("version_not_found");
  expect(() => enqueueLabRun(store, { instance: validateLabInstance(instance()) }, "x", { ownerId: EXAMPLES_OWNER })).toThrow("invalid_owner");
  // A bundled example version belongs to "examples": anyone may queue it and everyone lists its runs.
  const versionId = labExampleVersion(store, validateLabInstance(structuredClone(dimensions)));
  expect(labExampleVersion(store, validateLabInstance(structuredClone(dimensions)))).toBe(versionId);
  expect(store.versionOwner(versionId)).toBe(EXAMPLES_OWNER);
  const shared = enqueueLabRun(store, { versionId }, "public-run", { ownerId: "public" });
  expect(store.listRuns(50, null).map(r => r.id)).toEqual([shared]);
  expect(store.listRuns(50, A).map(r => r.id)).toContain(shared);
});

test("admission is charged in the queuing transaction; a refusal stores nothing", () => {
  const scenarios = () => (store.sqlite.prepare("SELECT count(*) AS n FROM scenarios").get() as { n: number }).n;
  enqueueLabRun(store, { instance: validateLabInstance(instance()) }, randomUUID(), { ownerId: A, admission: quota(A), now: 1_000 });
  expect(store.rateUsage(`solves:${A}`, DAY, 1_000).used).toBe(1);
  const before = scenarios();
  let error: unknown;
  try { enqueueLabRun(store, { instance: validateLabInstance(instance({ name: "second" })) }, randomUUID(), { ownerId: A, admission: quota(A), now: 2_000 }); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(AdmissionError);
  expect((error as AdmissionError).code).toBe("active_limit");
  expect(scenarios()).toBe(before);
  expect(store.rateUsage(`solves:${A}`, DAY, 2_000).used).toBe(1);
  // An idempotent replay is not charged twice.
  const key = randomUUID();
  const other = enqueueLabRun(store, { instance: validateLabInstance(instance()) }, key, { ownerId: B, admission: quota(B), now: 3_000 });
  expect(enqueueLabRun(store, { instance: validateLabInstance(instance()) }, key, { ownerId: B, admission: quota(B), now: 3_001 })).toBe(other);
  expect(store.rateUsage(`solves:${B}`, DAY, 3_001).used).toBe(1);
});

test("deleting an account removes its lab instances and runs", () => {
  enqueueLabRun(store, { instance: validateLabInstance(instance()) }, "a", { ownerId: A });
  const runs = store.sqlite.prepare("SELECT id FROM runs").all() as { id: string }[];
  for (const r of runs) store.cancel(r.id);
  store.deleteOwnerData(A);
  expect((store.sqlite.prepare("SELECT count(*) AS n FROM scenarios WHERE ownerId=?").get(A) as { n: number }).n).toBe(0);
  expect((store.sqlite.prepare("SELECT count(*) AS n FROM runs").get() as { n: number }).n).toBe(0);
});

test("an instance without the optional constants is stored as a lab instance", () => {
  const bare: Record<string, unknown> = structuredClone(dimensions);
  delete bare.kind; delete bare.schema_version;
  const parsed = validateLabInstance(bare);
  expect(parsed).toMatchObject({ kind: "lab_instance", schema_version: 1 });
  const runId = enqueueLabRun(store, { instance: parsed }, "bare", { ownerId: A });
  expect(isLabVersion(store, store.runView(runId)!.versionId)).toBe(true);
  expect(failure({ ...bare, kind: "scenario" })?.[0]).toBe("invalid_lab_instance");
});
