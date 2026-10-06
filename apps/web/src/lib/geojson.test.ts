import { expect, test } from "vitest"
import type { RunSummary } from "@fillrate/contracts"
import { buildRouteGeoJson } from "./geojson"

const line = (pieces: number) => ({ order_id: "o", line_id: "l", product_id: "p", pieces, linear_feet: 100 * pieces, amount_cents: 1000 * pieces })
const visit = (sequence: number, location_id: string) => ({ visit_id: `v${sequence}`, location_id, sequence, leg_m: 1000, leg_s: 60, load: 100, lines: [line(1)] })

// Depot D at (lon -90, lat 35). T1 serves A then B; T2 serves B again (a split stop) and an unlocated stop U.
const summary = {
  depot: { id: "D", label: "Depot", lat: 35, lon: -90 },
  travel: { mode: "snapshot", provider: "imported", provider_version: "v1", snapshot_id: "ab".repeat(32), dataset_revision: "r", profile: "truck", circuity: null, node_count: 4, warning_count: 0 },
  locations: [
    { id: "A", label: "Stop A", lat: 35.1, lon: -90.2, cluster_id: "c1", state: "planned", coordinate_source: "imported" },
    { id: "B", label: "Stop B", lat: 35.3, lon: -90.4, cluster_id: "c1", state: "planned", coordinate_source: "imported" },
    { id: "U", label: "Stop U", lat: null, lon: null, cluster_id: "c2", state: "planned", coordinate_source: "unresolved" },
    { id: "Z", label: "Unplanned", lat: 36, lon: -91, cluster_id: null, state: "unplanned", coordinate_source: "imported" },
  ],
  trucks: [
    { id: "T1", cluster_id: "c1", distance_m: 5000, drive_s: 300, fill: 0.5, load: 200, amount_cents: 2000, visits: [visit(2, "B"), visit(1, "A")] },
    { id: "T2", cluster_id: "c2", distance_m: 3000, drive_s: null, fill: 0.2, load: 100, amount_cents: 1000, visits: [visit(1, "B"), visit(2, "U")] },
  ],
} as unknown as RunSummary

test("routes are depot-then-visits LineStrings in [lon, lat], with no synthetic return", () => {
  const collection = buildRouteGeoJson("run-1", summary)
  expect(collection.type).toBe("FeatureCollection")
  const lines = collection.features.filter(f => f.geometry.type === "LineString")
  expect(lines).toHaveLength(2)
  const [t1, t2] = lines
  expect(t1.geometry.coordinates).toEqual([[-90, 35], [-90.2, 35.1], [-90.4, 35.3]]) // sorted by sequence, ends at B, never back at the depot
  expect(t2.geometry.coordinates).toEqual([[-90, 35], [-90.4, 35.3]]) // the unlocated visit is skipped
  expect(t1.properties).toMatchObject({ truck_id: "T1", cluster_id: "c1", stops: 2, distance_m: 5000, drive_s: 300, travel_provider: "imported", geometry: "schematic_straight_line" })
  expect(t2.properties).not.toHaveProperty("drive_s")
})

test("stops are one Point per location, split stops list every truck, and metadata counts omissions", () => {
  const collection = buildRouteGeoJson("run-1", summary)
  const points = collection.features.filter(f => f.geometry.type === "Point")
  expect(points.map(p => p.properties.role)).toEqual(["depot", "stop", "stop"])
  expect(points[0].geometry.coordinates).toEqual([-90, 35])
  const b = points.find(p => p.properties.location_id === "B")!
  expect(b.properties).toMatchObject({ trucks: ["T1", "T2"], visits: 2, cluster_id: "c1", label: "Stop B" })
  expect(points.some(p => p.properties.location_id === "Z")).toBe(false)
  expect(collection.fillrate).toMatchObject({
    run_id: "run-1", export_version: 1, units: { distance: "meters" }, geometry: "schematic_straight_line",
    travel: { provider: "imported", snapshot_id: "ab".repeat(32) },
    counts: { trucks: 2, routes: 2, planned_stops: 2 },
    omitted: { planned_locations_without_coordinates: 1, visits_without_coordinates: 1 },
  })
  expect(JSON.parse(JSON.stringify(collection))).toEqual(collection)
})

test("road geometry is opt-in per truck, labeled valhalla_road with provider context, and never replaces schematic lines elsewhere", () => {
  const road = {
    kind: "valhalla_road", snapshot_id: "ab".repeat(32), truck_id: "T1",
    provider: { provider: "valhalla", version: "3.9.0", dataset_revision: "extract-1", graph_config_hash: "sha256:g", costing: "truck", costing_options: { length: 21.64 } },
    legs: [
      { index: 0, from_id: "D", to_id: "A", status: "ok", coordinates: [[-90, 35], [-90.1, 35.05], [-90.2, 35.1]], route_m: 1100, route_s: 70, matrix_m: 1000, matrix_s: 60, delta_m: 100, delta_s: 10, relative_m: 0.1, relative_s: 0.17, notable: true },
      { index: 1, from_id: "A", to_id: "B", status: "no_route", coordinates: null, error: "no path", matrix_m: 2000, matrix_s: 90 },
    ],
    summary: { legs: 2, drawn: 1, missing: 1 },
  } as never
  const plain = buildRouteGeoJson("run-1", summary)
  expect(plain.features.filter(f => f.properties.role === "route_leg")).toHaveLength(0)
  expect(plain.fillrate.geometry).toBe("schematic_straight_line")

  const mixed = buildRouteGeoJson("run-1", summary, new Map([["T1", road]]))
  const legs = mixed.features.filter(f => f.properties.role === "route_leg")
  expect(legs).toHaveLength(1) // the leg with no route is absent, not a straight line
  expect(legs[0].geometry.coordinates).toHaveLength(3)
  expect(legs[0].properties).toMatchObject({ geometry: "valhalla_road", provider: "valhalla", provider_version: "3.9.0", dataset_revision: "extract-1", graph_config_hash: "sha256:g", costing: "truck", delta_m: 100, discrepancy_notable: true })
  expect(String(legs[0].properties.note)).toContain("do not prove which roads the solver used")
  // T1 has road legs instead of its schematic line; T2 stays schematic.
  const routes = mixed.features.filter(f => f.properties.role === "route")
  expect(routes.map(f => f.properties.truck_id)).toEqual(["T2"])
  expect(routes[0].properties.geometry).toBe("schematic_straight_line")
  expect(mixed.fillrate.geometry).toBe("mixed")
  expect(mixed.fillrate.road_geometry).toMatchObject({ trucks: ["T1"], legs_without_route: { T1: [{ leg_index: 1, from_id: "A", to_id: "B", status: "no_route" }] } })
  expect(mixed.fillrate.counts).toMatchObject({ routes: 1, road_legs: 1 })
})
