import { expect, test } from "vitest";
import type { RunSettings, ScenarioDocument } from "@fillrate/contracts";
import example from "../../../examples/m1-synthetic.json";
import { changedAssumptions, comparisonSignature } from "../src/experiments";
import { fleetProblems, withoutEmptyFleet, type FleetType } from "../src/fleet";
import { parsePlan } from "../src/evaluate";
import { largestCapacity, preflightChecks } from "../src/preflight";

const base = example.settings as unknown as RunSettings;
const versions = { pipeline: "fillrate-pipeline/3" };
const trailer: FleetType = { id: "trailer", label: "53 ft trailer", count: null, capacity: 5300, fixed_cost_cents: null, per_mile_cents: null };
const box: FleetType = { id: "box", label: "26 ft box truck", count: 4, capacity: 2600, fixed_cost_cents: null, per_mile_cents: null };
const sig = (s: Partial<RunSettings>) => comparisonSignature("v1", { ...base, ...s }, versions);

test("without a fleet the comparison signature is the single-trailer definition, unchanged", () => {
  const { definition } = sig({});
  expect(Object.keys(definition)).not.toContain("fleet");
  expect(definition.units).toEqual({ capacity: base.trailer_capacity, distance: "m", money: "cents" });
  // A null or empty fleet is "no fleet", the same cohort as one that never had the key.
  expect(sig({ fleet: null }).signature).toBe(sig({}).signature);
});

test("a fleet is part of the problem: its types, counts and capacities form their own cohort", () => {
  const fleet = sig({ fleet: [trailer, box] });
  expect(fleet.signature).not.toBe(sig({}).signature);
  expect(fleet.definition).toMatchObject({ units: { capacity: null }, fleet: [{ id: "box", count: 4, capacity: 2600 }, { id: "trailer", count: null, capacity: 5300 }] });
  // Order, labels and cost rates are not physical assumptions; counts and capacities are.
  expect(sig({ fleet: [box, trailer] }).signature).toBe(fleet.signature);
  expect(sig({ fleet: [{ ...trailer, label: "Renamed", fixed_cost_cents: 5 }, box] }).signature).toBe(fleet.signature);
  expect(sig({ fleet: [trailer, { ...box, count: 5 }] }).signature).not.toBe(fleet.signature);
  expect(sig({ fleet: [trailer, { ...box, capacity: 2700 }] }).signature).not.toBe(fleet.signature);
  // The unused trailer capacity setting does not split a fleet cohort.
  expect(sig({ fleet: [trailer, box], trailer_capacity: 4000 }).signature).toBe(fleet.signature);
});

test("fleet changes are named as changed assumptions", () => {
  expect(changedAssumptions(base, { ...base, fleet: [trailer] })).toEqual(["Vehicle fleet"]);
  expect(changedAssumptions({ ...base, fleet: [trailer] }, { ...base, fleet: [trailer, box] })).toEqual(["Vehicle fleet"]);
  expect(changedAssumptions({ ...base, fleet: [trailer] }, { ...base, fleet: [{ ...trailer, label: "x" }] })).toEqual([]);
  expect(changedAssumptions(base, { ...base, trailer_capacity: 4000 })).toEqual(["Trailer capacity"]);
});

test("fleet validation mirrors the optimizer's settings checks", () => {
  expect(fleetProblems({})).toEqual([]);
  expect(fleetProblems({ fleet: [trailer, box] })).toEqual([]);
  expect(fleetProblems({ fleet: [] })).toHaveLength(1);
  expect(fleetProblems({ fleet: [trailer, trailer] }).join(" ")).toMatch(/used twice/);
  expect(fleetProblems({ fleet: [{ ...trailer, capacity: 0 }] }).join(" ")).toMatch(/capacity/);
  expect(fleetProblems({ fleet: [{ ...trailer, count: 0 }] }).join(" ")).toMatch(/count/);
  expect(fleetProblems({ fleet: [{ ...trailer, label: " " }] }).join(" ")).toMatch(/label/);
  expect(fleetProblems({ fleet: Array.from({ length: 11 }, (_, i) => ({ ...trailer, id: `t${i}` })) }).join(" ")).toMatch(/at most 10/);
  // The lowest-cost objective prices each type, so it needs both rates on every type.
  expect(fleetProblems({ objective: "cost", fleet: [trailer] })).toHaveLength(2);
  expect(fleetProblems({ objective: "cost", fleet: [{ ...trailer, fixed_cost_cents: 100, per_mile_cents: 3 }] })).toEqual([]);
  expect(withoutEmptyFleet({ fleet: null })).toEqual({});
  expect(withoutEmptyFleet({ fleet: [] })).toEqual({});
  expect(withoutEmptyFleet({ fleet: [trailer] })).toEqual({ fleet: [trailer] });
});

const scenario: ScenarioDocument = {
  schema_version: 1, name: "Fleet preflight", depot: { id: "D", label: "Depot", lat: 0, lon: 0 },
  products: [{ id: "P", label: "Pallet", linear_feet_per_piece: 400 }],
  locations: [{ id: "near", label: "Near", lat: 0, lon: 1, coordinate_source: "imported", address: null, geocode: null, original: null }],
  orders: [{ id: "O1", customer_id: null, location_id: "near", order_date: "2026-10-05", priority: 1, lines: [{ id: "L1", product_id: "P", linear_feet_per_piece: null, ordered_pieces: 7, net_value_per_piece_cents: 100 }] }],
  inventory: [{ product_id: "P", available_pieces: 7 }],
};

test("oversize stops are checked against the largest vehicle type, as the optimizer does", () => {
  expect(largestCapacity({})).toBe(5300);
  expect(largestCapacity({ trailer_capacity: 4000 })).toBe(4000);
  expect(largestCapacity({ trailer_capacity: 4000, fleet: [box, trailer] })).toBe(5300);
  // 28 ft at one stop: over a 26 ft box truck, within a 53 ft trailer.
  expect(preflightChecks(scenario, { fleet: [box] }).map(f => f.check)).toEqual(["oversize_stop"]);
  expect(preflightChecks(scenario, { fleet: [box, trailer] })).toEqual([]);
  expect(preflightChecks(scenario, { trailer_capacity: 2600 }).map(f => f.check)).toEqual(["oversize_stop"]);
});

test("a manual plan carries one vehicle type per shipment, never guessed", () => {
  const plan = { cluster_id: "C1", routes: [["a"], ["b"]], vehicle_types: ["box", "trailer"] };
  expect(parsePlan(plan)).toEqual(plan);
  expect(() => parsePlan({ ...plan, vehicle_types: ["box"] })).toThrow(/one type per shipment/);
  expect(() => parsePlan({ ...plan, vehicle_types: ["box", ""] })).toThrow(/vehicle_types/);
  expect(parsePlan({ ...plan, vehicle_types: null })).toEqual({ cluster_id: "C1", routes: [["a"], ["b"]] });
});
