import { expect, test } from "vitest";
import { preflightChecks } from "../src/preflight";
import type { ScenarioDocument } from "@fillrate/contracts";
const scenario: ScenarioDocument = {
  schema_version: 1, name: "Preflight", depot: { id: "D", label: "Depot", lat: 0, lon: 0 },
  products: [{ id: "P", label: "Product", linear_feet_per_piece: 3000 }],
  locations: [
    { id: "missing", label: "Missing", lat: null, lon: null, coordinate_source: "unresolved", address: null, geocode: null, original: null },
    { id: "far", label: "Far", lat: 0, lon: 8, coordinate_source: "imported", address: null, geocode: null, original: null },
    { id: "near", label: "Near", lat: 0, lon: 1, coordinate_source: "zcta", address: null, geocode: null, original: null },
  ],
  orders: [
    { id: "O1", customer_id: null, location_id: "missing", order_date: "2026-09-30", priority: 1, lines: [{ id: "L1", product_id: "P", linear_feet_per_piece: null, ordered_pieces: 1, net_value_per_piece_cents: 100 }] },
    { id: "O2", customer_id: null, location_id: "far", order_date: "2026-09-30", priority: 1, lines: [{ id: "L2", product_id: "P", linear_feet_per_piece: null, ordered_pieces: 1, net_value_per_piece_cents: 100 }] },
    { id: "O3", customer_id: "near-customer", location_id: "near", order_date: "2026-09-30", priority: 1, lines: [{ id: "L3", product_id: "P", linear_feet_per_piece: null, ordered_pieces: 1, net_value_per_piece_cents: 100 }] },
    { id: "O4", customer_id: "near-customer", location_id: "near", order_date: "2026-09-30", priority: 1, lines: [{ id: "L4", product_id: "P", linear_feet_per_piece: null, ordered_pieces: 1, net_value_per_piece_cents: 100 }] },
  ], inventory: [{ product_id: "P", available_pieces: 4 }],
};
test("policy blocks two cases by default, warns oversize and ZIP and aggregates all lines at one stop", () => {
  expect(preflightChecks(scenario)).toEqual([
    { check: "missing_coordinates", action: "block", location_ids: ["missing"], line_ids: ["L1"], message: "missing_coordinates: 1 line(s) at 1 location(s)." },
    { check: "far_from_depot", action: "block", location_ids: ["far"], line_ids: ["L2"], message: "far_from_depot: 1 line(s) at 1 location(s)." },
    { check: "oversize_stop", action: "warn", location_ids: ["near"], line_ids: ["L3", "L4"], message: "oversize_stop: 2 line(s) at 1 location(s)." },
    { check: "approximate_coordinates", action: "warn", location_ids: ["near"], line_ids: ["L3", "L4"], message: "approximate_coordinates: 2 line(s) at 1 location(s)." },
  ]);
});
test("explicit exclusion removes its demand and per-check override warns", () => {
  const hits = preflightChecks(scenario, { excluded_line_ids: ["L3"], preflight: { far_from_depot: "warn" } });
  expect(hits.map(x => [x.check, x.action, x.line_ids])).toEqual([
    ["missing_coordinates", "block", ["L1"]], ["far_from_depot", "warn", ["L2"]], ["approximate_coordinates", "warn", ["L4"]],
  ]);
  expect(() => preflightChecks(scenario, { excluded_line_ids: ["nonexistent"] })).toThrow("Unknown excluded line IDs");
});

test("separate customers at the same location do not trigger oversize", () => {
  const separate = structuredClone(scenario);
  separate.orders[3].customer_id = "other-customer";
  expect(preflightChecks(separate).some(x => x.check === "oversize_stop")).toBe(false);
});

test("a far stop reachable through another stop only warns (round two)", () => {
  const chained = structuredClone(scenario);
  chained.locations.push({ id: "mid", label: "Mid", lat: 0, lon: 4, coordinate_source: "imported", address: null, geocode: null, original: null });
  chained.orders.push({ id: "O5", customer_id: null, location_id: "mid", order_date: "2026-09-30", priority: 1, lines: [{ id: "L5", product_id: "P", linear_feet_per_piece: null, ordered_pieces: 1, net_value_per_piece_cents: 100 }] });
  const hits = preflightChecks(chained);
  expect(hits.find(x => x.check === "far_from_depot")).toBeUndefined();
  expect(hits.find(x => x.check === "far_via_stop")).toMatchObject({ action: "warn", line_ids: ["L2"] });
  expect(preflightChecks(chained, { excluded_line_ids: ["L5"], preflight: { oversize_stop: "block" } }).map(x => [x.check, x.action])).toEqual([
    ["missing_coordinates", "block"], ["far_from_depot", "block"], ["oversize_stop", "block"], ["approximate_coordinates", "warn"],
  ]);
});
