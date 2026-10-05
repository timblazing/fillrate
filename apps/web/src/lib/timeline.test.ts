import { describe, expect, it } from "vitest"

import { buildTimeline, cursorAt, formatClock, localClock, timingSource } from "./timeline"

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

  it("keeps the unmodeled service and wait semantics for results without time-window fields", () => {
    const t = buildTimeline(truck([100, 200]), depot, places, { timezone: "America/Chicago", planning_date: "2026-10-06", midnight_epoch_s: 0 })
    expect(t.scheduled).toBe(false)
    expect([t.waitS, t.serviceS, t.driveS, t.totalS]).toEqual([0, 0, 300, 300])
    expect(t.stops.map((s) => [s.waitS, s.serviceS, s.window, s.arrivalClock])).toEqual([[0, 0, null, null], [0, 0, null, null]])
  })
})

// 2026-10-06 in America/Chicago is CDT (UTC-5): local midnight is 05:00 UTC.
const clock = { timezone: "America/Chicago", planning_date: "2026-10-06", midnight_epoch_s: Date.UTC(2026, 9, 6, 5) / 1000 }
const h = (hours: number) => hours * 3600
// Leaves 06:00. A: 600 s drive, arrives 06:10, waits until 09:00 (window 09:00-10:00), serves 30 min, leaves 09:30.
// B: 1800 s drive, arrives 10:00, no wait, serves 45 min (window 10:00-10:30), leaves 10:45.
const scheduledTruck = {
  id: "C1-T1",
  load: 500,
  shift_start_s: h(6),
  visits: [
    { visit_id: "V1", location_id: "A", sequence: 1, leg_m: 1000, leg_s: 600, load: 200, arrival_s: h(6) + 600, wait_s: h(9) - h(6) - 600, service_s: 1800, start_s: h(9), departure_s: h(9) + 1800, window_earliest_s: h(9), window_latest_s: h(10) },
    { visit_id: "V2", location_id: "B", sequence: 2, leg_m: 2000, leg_s: 1800, load: 300, arrival_s: h(10), wait_s: 0, service_s: 2700, start_s: h(10), departure_s: h(10) + 2700, window_earliest_s: h(10), window_latest_s: h(10) + 1800 },
  ],
}

describe("time-window timeline", () => {
  it("converts elapsed seconds to local clock in the scenario timezone", () => {
    expect(localClock(clock, h(6))).toBe("06:00")
    expect(localClock(clock, h(25) + 1800)).toBe("01:30 +1d")
    expect(localClock(null, h(6))).toBeNull()
    // Spring forward 2026-03-08: two elapsed hours after midnight is 03:00 local.
    const spring = { timezone: "America/Chicago", planning_date: "2026-03-08", midnight_epoch_s: Date.UTC(2026, 2, 8, 6) / 1000 }
    expect([localClock(spring, 7200), localClock(spring, 3600)]).toEqual(["03:00", "01:00"])
  })

  it("derives drive, wait and service per stop relative to departure", () => {
    const t = buildTimeline(scheduledTruck, depot, places, clock)
    expect(t.scheduled).toBe(true)
    expect([t.driveS, t.waitS, t.serviceS, t.totalS, t.departClock]).toEqual([2400, 10_200, 4500, h(10) + 2700 - h(6), "06:00"])
    const [a, b] = t.stops
    expect([a.arrivalS, a.waitS, a.startS, a.serviceS, a.departS]).toEqual([600, 10_200, 10_800, 1800, 12_600])
    expect([a.arrivalClock, a.startClock, a.departClock]).toEqual(["06:10", "09:00", "09:30"])
    expect(a.window).toEqual({ earliest: "09:00", latest: "10:00", slackS: 3600 })
    expect([b.waitS, b.window?.slackS, b.departClock]).toEqual([0, 1800, "10:45"])
    expect(b.loadBefore).toBe(300)
  })

  it("moves through drive, wait, service and the next drive as the cursor advances", () => {
    const t = buildTimeline(scheduledTruck, depot, places, clock)
    expect(cursorAt(t, 0)).toMatchObject({ phase: "depot", load: 500 })
    expect(cursorAt(t, 300)).toMatchObject({ phase: "drive", stopIndex: 0, fraction: 0.5 })
    expect(cursorAt(t, 600)).toMatchObject({ phase: "wait", stopIndex: 0, fraction: 0, load: 500, position: { lon: 1 } })
    expect(cursorAt(t, 5000)).toMatchObject({ phase: "wait", stopIndex: 0 })
    expect(cursorAt(t, 10_800)).toMatchObject({ phase: "service", stopIndex: 0, load: 300 })
    expect(cursorAt(t, 12_600)).toMatchObject({ phase: "service", stopIndex: 0 })
    expect(cursorAt(t, 13_500)).toMatchObject({ phase: "drive", stopIndex: 1, fraction: 0.5, position: { lon: 2 } })
    expect(cursorAt(t, 14_400)).toMatchObject({ phase: "service", stopIndex: 1, load: 0 })
    expect(cursorAt(t, 99_999)).toMatchObject({ phase: "service", stopIndex: 1, load: 0 })
  })

  it("falls back to unmodeled timing when a stop lacks time-window fields", () => {
    const partial = { ...scheduledTruck, visits: [scheduledTruck.visits[0], { ...scheduledTruck.visits[1], start_s: undefined }] }
    expect(buildTimeline(partial, depot, places, clock).scheduled).toBe(false)
  })
})
