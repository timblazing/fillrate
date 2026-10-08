import { expect, test } from "vitest"
import type { RunSummary } from "@fillrate/contracts"
import { buildRouteGeoJson } from "./geojson"

const line = (pieces: number) => ({ order_id: "o", line_id: "l", product_id: "p", pieces, linear_feet: 100 * pieces, amount_cents: 1000 * pieces })
const visit = (sequence: number, location_id: string) => ({ visit_id: `v${sequence}`, location_id, sequence, leg_m: 1000, leg_s: 60, load: 100, lines: [line(1)] })

// Depot D at (lon -90, lat 35). T1 serves A then B; T2 serves B again (a split stop) and an unlocated stop U.
const summary = {
  depot: { id: "D", label: "Depot", lat: 35, lon: -90 },
  travel: { mode: "estimated", provider: "haversine", provider_version: "haversine/1", dataset_revision: "r", profile: "estimated", circuity: 1.2 },
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
  expect(t1.properties).toMatchObject({ truck_id: "T1", cluster_id: "c1", stops: 2, distance_m: 5000, drive_s: 300, distance_basis: "estimated (haversine × circuity)", geometry: "schematic_straight_line" })
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
    distance_basis: "estimated (haversine × circuity)", travel: { mode: "estimated", circuity: 1.2 },
    counts: { trucks: 2, routes: 2, planned_stops: 2 },
    omitted: { planned_locations_without_coordinates: 1, visits_without_coordinates: 1 },
  })
  expect(JSON.parse(JSON.stringify(collection))).toEqual(collection)
})
