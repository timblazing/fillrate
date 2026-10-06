import { expect, test } from "vitest"
import { interpolateAlong, legPaths, roadLabel } from "./road-geometry"
import { buildTimeline, cursorAt, timingSource, withRoadPaths } from "./timeline"

const truck = {
  id: "T1", load: 200,
  visits: [
    { visit_id: "v1", location_id: "A", sequence: 1, leg_m: 1000, leg_s: 100, load: 100 },
    { visit_id: "v2", location_id: "B", sequence: 2, leg_m: 1000, leg_s: 100, load: 100 },
  ],
}
const places = new Map([["A", { id: "A", label: "A", lat: 35, lon: -89 }], ["B", { id: "B", label: "B", lat: 35, lon: -88 }]])
const depot = { lat: 35, lon: -90 }

test("interpolation follows the road line proportionally by distance", () => {
  // An L-shaped path: 1 degree east, then ~1 degree north (longer) so the corner is not at the midpoint.
  const path: [number, number][] = [[-90, 35], [-89, 35], [-89, 36]]
  const total = 1 * Math.cos((35 * Math.PI) / 180) + 1
  const corner = Math.cos((35 * Math.PI) / 180) / total
  expect(interpolateAlong(path, 0)).toEqual({ lon: -90, lat: 35 })
  expect(interpolateAlong(path, 1)).toEqual({ lon: -89, lat: 36 })
  const at = interpolateAlong(path, corner)
  expect(at.lon).toBeCloseTo(-89, 3)
  expect(at.lat).toBeCloseTo(35, 3)
  expect(interpolateAlong(path, 0.5).lon).toBeGreaterThanOrEqual(-89)
  expect(interpolateAlong([[1, 1], [1, 1]], 0.5)).toEqual({ lon: 1, lat: 1 })
})

test("the cursor drives along each leg's road line using the planned leg duration", () => {
  const base = buildTimeline(truck, depot, places)
  const legs = [[[-90, 35], [-89.5, 35.5], [-89, 35]], null] as ([number, number][] | null)[]
  const timeline = withRoadPaths(base, legs)
  const mid = cursorAt(timeline, 50)!
  expect(mid.phase).toBe("drive")
  expect(mid.onRoad).toBe(true)
  expect(mid.fraction).toBeCloseTo(0.5, 5)
  expect(mid.position!.lat).toBeGreaterThan(35.4) // the apex of the road line, not the straight segment (lat 35)
  // The leg without a road route falls back to the straight segment and says so.
  const second = cursorAt(timeline, 150)!
  expect(second.onRoad).toBe(false)
  expect(second.position).toEqual({ lon: -88.5, lat: 35 })
  // Without road geometry the schematic behavior is unchanged.
  expect(cursorAt(base, 50)!.position).toEqual({ lon: -89.5, lat: 35 })
  expect(cursorAt(base, 50)!.onRoad).toBe(false)
})

test("labels distinguish road geometry from the schematic line", () => {
  expect(timingSource({ mode: "snapshot", provider: "valhalla" }).geometry).toContain("not available")
  const road = roadLabel({ provider: { dataset_revision: "extract-1" } } as never)
  expect(road).toBe("Road geometry (Valhalla truck, extract-1)")
  expect(timingSource({ mode: "snapshot", provider: "valhalla" }, road).geometry).toContain("no live traffic or GPS")
  expect(legPaths({ legs: [{ index: 1, coordinates: [[0, 0], [1, 1]] }, { index: 0, coordinates: null }] } as never, 2)).toEqual([null, [[0, 0], [1, 1]]])
})
