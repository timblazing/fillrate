// Travel matrix downloads (M7): canonical JSON whose hash is the identity, long-form directed CSV, and the run binding.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type Store } from "../src/index";
import { normalizeSnapshot, snapshotIdentity } from "../src/travel";
import { runMatrixJson, snapshotCanonicalJson, snapshotCsv } from "../src/travel-export";

const parity = JSON.parse(readFileSync(resolve("packages/contracts/fixtures/travel-parity.json"), "utf8")) as { snapshot: unknown; identity: string };
const snapshot = () => normalizeSnapshot(structuredClone(parity.snapshot));

test("the canonical JSON hashes to the snapshot identity and round-trips", () => {
  const json = snapshotCanonicalJson(snapshot());
  expect(createHash("sha256").update(json).digest("hex")).toBe(parity.identity);
  expect(snapshotIdentity(normalizeSnapshot(JSON.parse(json)))).toBe(parity.identity);
});

test("CSV is long-form in node order, keeps asymmetry and leaves missing edges empty", () => {
  const lines = snapshotCsv(snapshot()).trimEnd().split("\r\n");
  expect(lines[0]).toBe("from_id,to_id,distance_m,duration_s");
  expect(lines).toHaveLength(1 + 7 * 7);
  expect(lines.slice(1, 4)).toEqual(["D,D,0,0", "D,A,100000,10000", "D,B,804672,80467.25"]); // 804672.5 rounds half to even
  expect(lines[4]).toBe("D,C,,"); // null edge: empty cells, not zero
  expect(lines).toContain("A,D,,"); // the reverse of D->A is absent, not copied
  expect(lines).toContain("X,D,1,0.1"); // a tiny reachable edge keeps its value
});

test("unit conversion: kilometers become integer meters and minutes become seconds", () => {
  const s = snapshot();
  const km = normalizeSnapshot({ ...structuredClone(s), distance_units: "kilometers", duration_units: "minutes", distances: s.distances.map(r => r.map(v => v === null ? null : v / 1000)), durations: s.durations.map(r => r.map(v => v === null ? null : v / 60)) });
  expect(snapshotCsv(km).split("\r\n")[2]).toBe("D,A,100000,10000");
});

test("run matrix JSON carries the exact snapshot and a node binding (depot first, stops by ID)", () => {
  const out = runMatrixJson("run-1", snapshot(), { id: "D", label: "Depot", lat: 0, lon: 0 }, [
    { id: "B", label: "B", lat: 0, lon: 2 }, { id: "A", label: "A", lat: 0, lon: 1.5 }, { id: "Q", label: "Q", lat: 1, lon: 1 }, { id: "M", label: "M", lat: null, lon: null },
  ]);
  expect(out.snapshot_id).toBe(parity.identity);
  expect(out.snapshot).toEqual(snapshot());
  expect(out.binding.map(b => [b.id, b.role, b.snapshot_index, b.in_snapshot, b.coordinates_match])).toEqual([
    ["D", "depot", 0, true, true], ["A", "stop", 1, true, false], ["B", "stop", 2, true, true], ["Q", "stop", null, false, false],
  ]);
});

let dir: string, store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fillrate-matrix-")); store = openDatabase(join(dir, "t.sqlite")); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

test("only the owner can read a snapshot's matrix; keyless callers and other owners cannot", () => {
  store.saveTravelSnapshot(parity.snapshot, 1, "user:a");
  expect(store.travelSnapshotInfo(parity.identity, "user:a")).not.toBeNull();
  expect(store.travelSnapshotInfo(parity.identity, "user:b")).toBeNull();
  expect(store.ownsTravelSnapshot(parity.identity, "user:b")).toBe(false);
  expect(snapshotCsv(store.travelSnapshot(parity.identity))).toBe(snapshotCsv(snapshot()));
});
