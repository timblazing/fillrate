// The road matrix lesson's bundled synthetic recorded matrix (spec §7, §13): it is seeded for the examples owner under
// the identity the example's settings select, public example runs bind it through the ordinary snapshot checks, and it
// stays read-only and invisible to every account's own snapshot list.
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EXAMPLES_OWNER, OPERATOR, openDatabase, type Store } from "../src/index";
import { normalizeSnapshot, snapshotIdentity } from "../src/travel";

const read = (name: string) => JSON.parse(readFileSync(resolve("examples", name), "utf8"));
const recorded = read("lesson-matrix.json"), estimated = read("lesson-matrix-estimated.json"), matrix = read("lesson-matrix-snapshot.json");
const snapshotId: string = recorded.settings.travel_snapshot_id;

let dir: string, store: Store, exampleVersion: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fillrate-lesson-matrix-"));
  store = openDatabase(join(dir, "test.sqlite"));
  exampleVersion = store.createScenario(recorded.scenario.name, { schema_version: 1, document: recorded.scenario }, "Fillrate examples", Date.now(), EXAMPLES_OWNER).versionId;
});
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
const run = (settings: object, key: string, versionId = exampleVersion, ownerId = "public") => store.enqueue(versionId, { schema_version: 1, document: settings as never }, key, Date.now(), 3, "pipeline", { ownerId });

test("the bundled snapshot hashes, in TypeScript, to the identity the Python generator recorded", () => {
  expect(snapshotIdentity(normalizeSnapshot(matrix))).toBe(snapshotId);
  expect(estimated.settings.travel_snapshot_id).toBeNull();
  expect(estimated.scenario).toEqual(recorded.scenario);
  expect(matrix.options.synthetic).toBe(true);
  expect(matrix.dataset_revision).toContain("not real roads");
});

test("a public example run binds the seeded snapshot through the usual checks", () => {
  expect(() => run(recorded.settings, "before-seed")).toThrow("travel_snapshot_not_found");
  expect(store.seedExampleTravelSnapshot(matrix, snapshotId)).toBe(snapshotId);
  expect(store.seedExampleTravelSnapshot(matrix, snapshotId)).toBe(snapshotId); // idempotent
  const runId = run(recorded.settings, "recorded");
  expect(store.runView(runId)!.settings.document.travel_snapshot_id).toBe(snapshotId);
  expect(() => run(estimated.settings, "estimated")).not.toThrow();
  // A document that does not hash to the selected identity is never stored.
  expect(() => store.seedExampleTravelSnapshot({ ...matrix, profile: "auto" }, "f".repeat(64))).toThrow("travel_snapshot_hash_mismatch");
  expect(store.travelSnapshotInfo("f".repeat(64), EXAMPLES_OWNER)).toBeNull();
});

test("the example snapshot is read-only and private to the examples owner", () => {
  store.seedExampleTravelSnapshot(matrix, snapshotId);
  for (const owner of [OPERATOR, "user:a"]) {
    expect(store.travelSnapshotInfo(snapshotId, owner)).toBeNull();
    expect(store.listTravelSnapshots(owner).map(s => s.id)).not.toContain(snapshotId);
  }
  // An account's own copy of the scenario cannot select it: the snapshot must belong to the version's owner.
  const own = store.createScenario("Copy", { schema_version: 1, document: recorded.scenario }, "a", Date.now(), "user:a").versionId;
  expect(() => run(recorded.settings, "copy", own, "user:a")).toThrow("travel_snapshot_not_found");
  expect(() => store.sqlite.prepare("UPDATE travel_snapshots SET profile='x'").run()).toThrow(/immutable/);
  expect(() => store.sqlite.prepare("DELETE FROM travel_snapshots").run()).toThrow(/cannot be deleted/);
  expect(() => store.deleteOwnerData(EXAMPLES_OWNER)).toThrow("invalid_owner");
  // Deleting an account that uploaded the same document keeps the examples owner's link and the row.
  store.saveTravelSnapshot(matrix, Date.now(), "user:a");
  store.deleteOwnerData("user:a");
  expect(store.travelSnapshotInfo(snapshotId, EXAMPLES_OWNER)?.id).toBe(snapshotId);
});
