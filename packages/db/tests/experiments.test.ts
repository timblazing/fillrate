import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunSettings, RunSummary } from "@fillrate/contracts";
import { openDatabase, type Store } from "../src/index";
import { compareRuns, comparisonSignature, DEFAULT_COMPARISON, dominates, expandSweep, parseComparison, runMetrics, SweepError, type CompareInput, type Metrics } from "../src/experiments";
import example from "../../../examples/m1-synthetic.json";

const base = example.settings as unknown as RunSettings;
const versions = { pipeline: "fillrate-pipeline/3" };

// A minimal valid summary: metrics come from totals and per-cluster tightness.
function summary(t: { planned: number; util: number; centroid: number; trucks: number; miles?: number }, extra: Partial<RunSummary> = {}): RunSummary {
  return {
    validity: "valid", coverage: "complete", versions,
    totals: { planned_cents: t.planned, utilization: t.util, trucks: t.trucks, loaded_distance_m: t.miles ?? 1000, min_fill: 0.5 },
    clusters: [{ location_ids: ["a", "b"], mean_centroid_distance_m: t.centroid, diameter_m: 10 }],
    ...extra,
  } as unknown as RunSummary;
}
const run = (id: string, s: RunSummary | null, settings: Partial<RunSettings> = {}, status = "succeeded"): CompareInput =>
  ({ id, status, versionId: "v1", settings: { ...base, ...settings }, summary: s });

test("a sweep expands the cartesian product, normalizes per method and never truncates", () => {
  const runs = expandSweep(base, { k: [2, 3], kmeans_seed: [0, 1] });
  expect(runs).toHaveLength(4);
  expect(runs.map(r => r.varied)).toContainEqual({ k: 3, kmeans_seed: 1 });
  // k means nothing to the H3 baseline: kmeans × k=2,3 plus one h3 run, not two.
  const methods = expandSweep(base, { cluster_strategy: ["kmeans", "h3"], k: [2, 3] });
  expect(methods).toHaveLength(3);
  expect(methods.find(r => r.settings.cluster_strategy === "h3")!.settings.k).toBeNull();
  expect(methods.find(r => r.settings.cluster_strategy === "h3")!.varied).toEqual({ cluster_strategy: "h3" });
  // 3–12 × 10 seeds is 100 runs: an error naming the count, not 25 silent runs.
  const tooMany = () => expandSweep(base, { k: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], kmeans_seed: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
  expect(tooMany).toThrow(SweepError);
  expect(tooMany).toThrow(/100 runs; the limit is 25/);
  expect(() => expandSweep(base, { k: [2, 2] })).toThrow(/repeats/);
  expect(() => expandSweep(base, { trucks: [1] } as never)).toThrow(/Unknown sweep axis/);
});

test("k and seeds share a cohort; inventory and mileage changes form changed-assumption cohorts", () => {
  const sig = (s: Partial<RunSettings>) => comparisonSignature("v1", { ...base, ...s }, versions).signature;
  expect(sig({ k: 3, kmeans_seed: 4, solver_seed: 9, cluster_strategy: "h3" })).toBe(sig({}));
  expect(sig({ inventory_percent: 50 })).not.toBe(sig({}));
  expect(sig({ travel_circuity: 1.3 })).not.toBe(sig({}));
  expect(sig({ max_leg_m: 700_000 })).not.toBe(sig({}));
  expect(comparisonSignature("v2", base, versions).signature).not.toBe(sig({}));
});

test("allocation strategy varies within a cohort; whole-order fulfillment is a changed assumption", () => {
  const sig = (s: Partial<RunSettings>) => comparisonSignature("v1", { ...base, ...s }, versions).signature;
  expect(sig({ allocation_strategy: "priority" })).toBe(sig({}));
  expect(sig({ fulfillment_policy: "whole_order" })).not.toBe(sig({}));
  const runs = expandSweep(base, { allocation_strategy: ["order_date_then_value", "priority"], fulfillment_policy: ["piece", "whole_order"] });
  expect(runs).toHaveLength(4);
  expect(runs.map(r => r.varied)).toContainEqual({ allocation_strategy: "priority", fulfillment_policy: "whole_order" });
});

test("strict Pareto domination respects metric directions and declared rounding", () => {
  const m = (p: number, u: number, c: number): Metrics => ({ planned_cents: p, utilization: u, mean_centroid_m: c, trucks: 1, loaded_distance_m: 1, min_fill: 1, max_diameter_m: 1 });
  const v = DEFAULT_COMPARISON.vector;
  expect(dominates(m(100, 0.9, 10), m(100, 0.8, 10), v)).toBe(true);
  expect(dominates(m(100, 0.9, 10), m(100, 0.9, 10), v)).toBe(false); // equal: no domination
  expect(dominates(m(100, 0.9, 10), m(90, 0.95, 10), v)).toBe(false); // trade-off
  expect(dominates(m(100, 0.9, 9), m(100, 0.9, 10), v)).toBe(true); // centroid distance: lower is better
  expect(dominates(m(100, 0.90001, 10), m(100, 0.9, 10.4), v)).toBe(false); // tied after rounding
});

test("ranking: non-dominated first, then revenue, shipments, miles; ties share a rank", () => {
  const out = compareRuns([
    run("a", summary({ planned: 100, util: 0.8, centroid: 10, trucks: 3 })),
    run("b", summary({ planned: 100, util: 0.9, centroid: 10, trucks: 3 })), // dominates a
    run("c", summary({ planned: 90, util: 0.95, centroid: 10, trucks: 2 })), // trade-off with b
    run("d", summary({ planned: 90, util: 0.95, centroid: 10, trucks: 2 })), // tie with c
  ]);
  const by = Object.fromEntries(out.rows.map(r => [r.id, r]));
  expect(by.a.nonDominated).toBe(false);
  expect([by.b.rank, by.c.rank, by.d.rank, by.a.rank]).toEqual([1, 2, 2, 4]);
  expect([by.b.label, by.c.label, by.d.label, by.a.label]).toEqual(["Best option", "2nd best", "2nd best", null]);
  // The order is declared and changeable: shipments first puts the trade-off runs ahead.
  const fewest = compareRuns(out.rows.map((r, i) => run(r.id, [summary({ planned: 100, util: 0.8, centroid: 10, trucks: 3 }), summary({ planned: 100, util: 0.9, centroid: 10, trucks: 3 }), summary({ planned: 90, util: 0.95, centroid: 10, trucks: 2 }), summary({ planned: 90, util: 0.95, centroid: 10, trucks: 2 })][i])), parseComparison({ order: ["trucks", "planned_cents"] }));
  expect(fewest.rows.filter(r => r.rank === 1).map(r => r.id).sort()).toEqual(["c", "d"]);
});

test("invalid, partial, unfinished and other-cohort runs are listed but never ranked", () => {
  const good = summary({ planned: 100, util: 0.9, centroid: 10, trucks: 3 });
  const out = compareRuns([
    run("ok", good),
    run("ok2", summary({ planned: 50, util: 0.9, centroid: 10, trucks: 3 })),
    run("invalid", summary({ planned: 999, util: 1, centroid: 1, trucks: 1 }, { validity: "invalid" })),
    run("partial", summary({ planned: 999, util: 1, centroid: 1, trucks: 1 }, { coverage: "partial" })),
    run("running", null, {}, "running"),
    run("inventory", summary({ planned: 999, util: 1, centroid: 1, trucks: 1 }), { inventory_percent: 50 }),
  ]);
  const by = Object.fromEntries(out.rows.map(r => [r.id, r]));
  expect(by.ok.label).toBe("Best option");
  expect(by.ok2.label).toBe("2nd best");
  expect(by.invalid.reason).toBe("Invalid plan");
  expect(by.partial.reason).toBe("Partial plan");
  expect(by.running.reason).toBe("Run running");
  expect(by.inventory.reason).toMatch(/Different cohort/);
  expect(out.cohorts).toHaveLength(2);
  // Choosing the inventory cohort ranks it alone.
  const other = compareRuns([run("ok", good), run("inventory", good, { inventory_percent: 50 })], parseComparison({ cohort: comparisonSignature("v1", { ...base, inventory_percent: 50 }, versions).signature }));
  expect(other.rows.find(r => r.id === "inventory")!.label).toBe("Best option");
  expect(other.rows.find(r => r.id === "ok")!.label).toBeNull();
});

test("tightness averages one distance per location group", () => {
  const m = runMetrics({ ...summary({ planned: 1, util: 1, centroid: 0, trucks: 1 }), clusters: [
    { location_ids: ["a"], mean_centroid_distance_m: 0, diameter_m: 0 },
    { location_ids: ["b", "c", "d"], mean_centroid_distance_m: 40, diameter_m: 80 },
  ] } as unknown as RunSummary);
  expect(m.mean_centroid_m).toBe(30);
  expect(m.max_diameter_m).toBe(80);
});

let dir: string, store: Store;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "fillrate-exp-")); store = openDatabase(join(dir, "t.sqlite")); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

test("an experiment and all of its runs commit together", () => {
  const versionId = store.createScenario("S", { schema_version: 1, document: { s: 1 } }, "T").versionId;
  const runs = expandSweep(base, { k: [2, 3] }).map(r => ({ settings: { schema_version: 1 as const, document: r.settings as never }, varied: r.varied }));
  const { id, runIds } = store.createExperiment({ versionId, name: "k sweep", spec: { axes: { k: [2, 3] } }, comparison: DEFAULT_COMPARISON, runs });
  expect(runIds).toHaveLength(2);
  const view = store.experiment(id)!;
  expect(view.runs.map(r => [r.position, r.varied, r.status])).toEqual([[0, { k: 2 }, "queued"], [1, { k: 3 }, "queued"]]);
  expect(store.runCounts().queued).toBe(2);
  store.saveComparison(id, parseComparison({ order: ["trucks"] }));
  expect((store.experiment(id)!.comparison as { order: string[] }).order).toEqual(["trucks"]);
  // A failing insert rolls back the whole sweep.
  expect(() => store.createExperiment({ versionId: "missing", name: "x", spec: {}, comparison: {}, runs })).toThrow(/FOREIGN KEY/);
  expect(store.listExperiments(50, "operator")).toHaveLength(1);
});
