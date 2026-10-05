import { describe, expect, it } from "vitest"

import { buildTimeline, cursorAt, formatClock, timingSource } from "./timeline"

const depot = { lat: 0, lon: 0 }
const places = new Map([
  ["A", { id: "A", label: "Alpha", lat: 0, lon: 1 }],
  ["B", { id: "B", label: "Beta", lat: 0, lon: 3 }],
])
const truck = (legs: (number | null | undefined)[]) => ({
  id: "C1-T1",
  load: 500,
  visits: [
    { visit_id: "V1", location_id: "A", sequence: 1, leg_m: 1000, leg_s: legs[0], load: 200 },
    { visit_id: "V2", location_id: "B", sequence: 2, leg_m: 2000, leg_s: legs[1], load: 300 },
  ],
})

describe("route timeline", () => {
  it("orders arrivals by cumulative drive and tracks load before and after each stop", () => {
    const t = buildTimeline(truck([100, 200]), depot, places)
    expect(t.timed).toBe(true)
    expect(t.totalS).toBe(300)
    expect(t.stops.map((s) => s.arrivalS)).toEqual([100, 300])
    expect(t.departLoad).toBe(500)
    expect(t.stops.map((s) => [s.loadBefore, s.loadAfter, s.serviceS])).toEqual([[500, 300, 0], [300, 0, 0]])
  })

  it("interpolates along the straight leg and reports phases", () => {
    const t = buildTimeline(truck([100, 200]), depot, places)
    expect(cursorAt(t, 0)).toMatchObject({ phase: "depot", load: 500, position: { lon: 0, lat: 0 } })
    expect(cursorAt(t, 50)).toMatchObject({ phase: "drive", stopIndex: 0, fraction: 0.5, position: { lon: 0.5 } })
    expect(cursorAt(t, 100)).toMatchObject({ phase: "service", stopIndex: 0, load: 300, position: { lon: 1 } })
    expect(cursorAt(t, 200)).toMatchObject({ phase: "drive", stopIndex: 1, load: 300, position: { lon: 2 } })
    expect(cursorAt(t, 999)).toMatchObject({ phase: "service", stopIndex: 1, load: 0, position: { lon: 3 } })
  })

  it("handles a zero-second leg without dividing by zero", () => {
    const t = buildTimeline(truck([0, 60]), depot, places)
    expect(cursorAt(t, 0)).toMatchObject({ phase: "service", stopIndex: 0, load: 300 })
    expect(cursorAt(t, 30)).toMatchObject({ phase: "drive", fraction: 0.5 })
  })

  it("reports timing as unavailable for results saved without leg durations", () => {
    const t = buildTimeline(truck([undefined, null]), depot, places)
    expect(t.timed).toBe(false)
    expect(t.totalS).toBeNull()
    expect(t.stops.map((s) => s.arrivalS)).toEqual([null, null])
    expect(t.stops[0].loadAfter).toBe(300)
    expect(cursorAt(t, 10)).toBeNull()
  })

  it("labels the timing source and always flags the schematic geometry", () => {
    expect(timingSource({ mode: "estimated", provider: "haversine" }).timing).toBe("Estimated drive time (constant speed)")
    expect(timingSource({ mode: "snapshot", provider: "imported" }).timing).toBe("Imported matrix durations")
    expect(timingSource(null).geometry).toContain("road geometry not available")
    expect(formatClock(3849)).toBe("1:04:09")
  })
})
