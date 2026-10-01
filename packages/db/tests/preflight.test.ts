import { expect, test } from "vitest";
import { preflightChecks } from "../src/preflight";
import type { ScenarioDocument } from "@fillrate/contracts";
const scenario: ScenarioDocument = {
  schema_version: 1, name: "Preflight", depot: { id: "D", label: "Depot", lat: 0, lon: 0 },
  products: [{ id: "P", label: "Product", linear_feet_per_piece: 3000 }],
  locations: [
    { id: "missing", label: "Missing", lat: null, lon: null, coordinate_source: "unresolved" },
    { id: "far", label: "Far", lat: 0, lon: 8, coordinate_source: "imported" },
    { id: "near", label: "Near", lat: 0, lon: 1, coordinate_source: "zcta" },
  ],
  orders: [
    { id: "O1", location_id: "missing", order_date: "2026-09-30", lines: [{ id: "L1", product_id: "P", linear_feet_per_piece: null, ordered_pieces: 1, net_value_per_piece_cents: 100 }] },
    { id: "O2", location_id: "far", order_date: "2026-09-30", lines: [{ id: "L2", product_id: "P", linear_feet_per_piece: null, ordered_pieces: 1, net_value_per_piece_cents: 100 }] },
    { id: "O3", location_id: "near", order_date: "2026-09-30", lines: [{ id: "L3", product_id: "P", linear_feet_per_piece: null, ordered_pieces: 1, net_value_per_piece_cents: 100 }] },
    { id: "O4", location_id: "near", order_date: "2026-09-30", lines: [{ id: "L4", product_id: "P", linear_feet_per_piece: null, ordered_pieces: 1, net_value_per_piece_cents: 100 }] },
  ], inventory: [{ product_id: "P", available_pieces: 4 }],
};
test("policy blocks three cases, warns ZIP and aggregates all lines at one stop", () => {
  expect(preflightChecks(scenario)).toEqual([
    { check: "missing_coordinates", action: "block", location_ids: ["missing"], line_ids: ["L1"], message: "missing_coordinates: 1 line(s) at 1 location(s)." },
    { check: "far_from_depot", action: "block", location_ids: ["far"], line_ids: ["L2"], message: "far_from_depot: 1 line(s) at 1 location(s)." },
    { check: "oversize_stop", action: "block", location_ids: ["near"], line_ids: ["L3", "L4"], message: "oversize_stop: 2 line(s) at 1 location(s)." },
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
