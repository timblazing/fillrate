// Synthetic sample data for the component gallery only. Never real customer data (spec §14).

import type { JobState } from "@/components/lab/job-status"
import type { TimelineRoute } from "@/components/lab/route-timeline"

export type SampleStop = {
  id: string
  label: string
  longitude: number
  latitude: number
  route: number | null
  demand: number
  window: string
  source: "imported" | "census" | "zcta" | "manual"
}

export const depot = { id: "depot-1", label: "Main depot", longitude: -86.7816, latitude: 36.1627 }

export const stops: SampleStop[] = [
  { id: "c-01", label: "Stop 01", longitude: -86.8025, latitude: 36.1745, route: 1, demand: 4, window: "08:00–10:00", source: "census" },
  { id: "c-02", label: "Stop 02", longitude: -86.8201, latitude: 36.1552, route: 1, demand: 2, window: "09:00–12:00", source: "census" },
  { id: "c-03", label: "Stop 03", longitude: -86.8102, latitude: 36.1381, route: 1, demand: 6, window: "10:00–13:00", source: "zcta" },
  { id: "c-04", label: "Stop 04", longitude: -86.7612, latitude: 36.1893, route: 2, demand: 3, window: "08:30–11:00", source: "imported" },
  { id: "c-05", label: "Stop 05", longitude: -86.7401, latitude: 36.1760, route: 2, demand: 5, window: "11:00–14:00", source: "census" },
  { id: "c-06", label: "Stop 06", longitude: -86.7302, latitude: 36.1512, route: 2, demand: 1, window: "12:00–15:00", source: "manual" },
  { id: "c-07", label: "Stop 07", longitude: -86.7650, latitude: 36.1305, route: 3, demand: 7, window: "08:00–17:00", source: "census" },
  { id: "c-08", label: "Stop 08", longitude: -86.7858, latitude: 36.1198, route: 3, demand: 2, window: "13:00–16:00", source: "zcta" },
  { id: "c-09", label: "Stop 09", longitude: -86.8450, latitude: 36.1950, route: null, demand: 3, window: "09:00–10:00", source: "census" },
]

export const routeIds = [1, 2, 3] as const

export function routeCoordinates(route: number): [number, number][] {
  const visits = stops.filter((s) => s.route === route)
  return [
    [depot.longitude, depot.latitude],
    ...visits.map((s) => [s.longitude, s.latitude] as [number, number]),
    [depot.longitude, depot.latitude],
  ]
}

// Minutes from local midnight.
const h = (hh: number, mm = 0) => hh * 60 + mm

export const timelineRoutes: TimelineRoute[] = [
  {
    route: 1,
    vehicle: "Box truck A",
    segments: [
      { kind: "drive", start: h(8), end: h(8, 14) },
      { kind: "service", start: h(8, 14), end: h(8, 26), stopId: "c-01", window: [h(8), h(10)] },
      { kind: "drive", start: h(8, 26), end: h(8, 44) },
      { kind: "wait", start: h(8, 44), end: h(9) },
      { kind: "service", start: h(9), end: h(9, 8), stopId: "c-02", window: [h(9), h(12)] },
      { kind: "drive", start: h(9, 8), end: h(9, 31) },
      { kind: "wait", start: h(9, 31), end: h(10) },
      { kind: "service", start: h(10), end: h(10, 18), stopId: "c-03", window: [h(10), h(13)] },
      { kind: "drive", start: h(10, 18), end: h(10, 40) },
    ],
  },
  {
    route: 2,
    vehicle: "Cargo van B",
    segments: [
      { kind: "drive", start: h(8, 10), end: h(8, 32) },
      { kind: "service", start: h(8, 32), end: h(8, 42), stopId: "c-04", window: [h(8, 30), h(11)] },
      { kind: "drive", start: h(8, 42), end: h(9, 5) },
      { kind: "wait", start: h(9, 5), end: h(11) },
      { kind: "service", start: h(11), end: h(11, 15), stopId: "c-05", window: [h(11), h(14)] },
      { kind: "drive", start: h(11, 15), end: h(11, 40) },
      { kind: "wait", start: h(11, 40), end: h(12) },
      { kind: "service", start: h(12), end: h(12, 5), stopId: "c-06", window: [h(12), h(15)] },
      { kind: "drive", start: h(12, 5), end: h(12, 30) },
    ],
  },
  {
    route: 3,
    vehicle: "Box truck C",
    segments: [
      { kind: "drive", start: h(8), end: h(8, 20) },
      { kind: "service", start: h(8, 20), end: h(8, 45), stopId: "c-07", window: [h(8), h(17)] },
      { kind: "drive", start: h(8, 45), end: h(9, 5) },
      { kind: "wait", start: h(9, 5), end: h(13) },
      { kind: "service", start: h(13), end: h(13, 10), stopId: "c-08", window: [h(13), h(16)] },
      { kind: "drive", start: h(13, 10), end: h(13, 34) },
    ],
  },
]

// Best objective (cost, cents) by iteration, from final solver statistics. Three seeds.
export const convergence = Array.from({ length: 41 }, (_, i) => {
  const it = i * 250
  const decay = (base: number, floor: number, rate: number, jitter: number) =>
    Math.round(floor + (base - floor) * Math.exp(-rate * i) + (i % 7 === 3 ? jitter : 0))
  return {
    iteration: it,
    seed0: decay(48200, 31840, 0.16, 90),
    seed1: decay(51900, 32410, 0.12, 140),
    seed2: decay(46800, 31620, 0.2, 60),
  }
})

// Objective components in dollars for display (cents internally).
export const objectiveBreakdown = [
  { run: "Seed 0", travel: 268.4, fixed: 45, penalty: 0, reward: -13.2 },
  { run: "Seed 1", travel: 279.1, fixed: 45, penalty: 0, reward: -9.8 },
  { run: "Manual", travel: 301.7, fixed: 60, penalty: 42.5, reward: 0 },
  { run: "2 vans", travel: 244.9, fixed: 30, penalty: 18, reward: -22.1 },
]

export const capacityUtilization = [
  { route: "Route 1", weight: 92, volume: 71 },
  { route: "Route 2", weight: 68, volume: 84 },
  { route: "Route 3", weight: 81, volume: 55 },
  { route: "Route 4", weight: 43, volume: 38 },
]

export const workload = [
  { route: 1, miles: 7.4, minutes: 160, stops: 3 },
  { route: 2, miles: 6.1, minutes: 260, stops: 3 },
  { route: 3, miles: 5.2, minutes: 334, stops: 2 },
  { route: 4, miles: 9.8, minutes: 210, stops: 5 },
  { route: 5, miles: 3.9, minutes: 120, stops: 2 },
  { route: 6, miles: 8.6, minutes: 285, stops: 4 },
]

// Seed sweep for one budget: best / median / range and each run's objective.
export const seedSweep = [
  { budget: "5 s", best: 336, median: 351, worst: 372, runs: [336, 344, 351, 360, 372] },
  { budget: "30 s", best: 318, median: 324, worst: 333, runs: [318, 320, 324, 329, 333] },
  { budget: "120 s", best: 315, median: 317, worst: 321, runs: [315, 316, 317, 319, 321] },
]

// Normalized 0–100 (higher is better) for the radar comparison.
export const radarMetrics = [
  { key: "distance", label: "Distance" },
  { key: "duration", label: "Duration" },
  { key: "vehicles", label: "Vehicles" },
  { key: "utilization", label: "Utilization" },
  { key: "fulfillment", label: "Fulfillment" },
  { key: "runtime", label: "Runtime" },
]

export const radarRuns = [
  { label: "Seed 0 · 30 s", values: { distance: 84, duration: 78, vehicles: 70, utilization: 81, fulfillment: 89, runtime: 60 } },
  { label: "Manual baseline", values: { distance: 58, duration: 64, vehicles: 45, utilization: 62, fulfillment: 76, runtime: 98 } },
  { label: "2 vans · 120 s", values: { distance: 92, duration: 70, vehicles: 95, utilization: 94, fulfillment: 68, runtime: 22 } },
]

export const fulfillmentFunnel = [
  { label: "Ordered", value: 1240 },
  { label: "Allocated", value: 1085 },
  { label: "Routed", value: 1012 },
  { label: "Delivered (sim.)", value: 968 },
]

export const fulfillmentByProduct = [
  { product: "Water 24pk", ordered: 420, allocated: 420, routed: 402 },
  { product: "Rice 10kg", ordered: 310, allocated: 248, routed: 236 },
  { product: "Canned beans", ordered: 290, allocated: 247, routed: 229 },
  { product: "Diapers", ordered: 220, allocated: 170, routed: 145 },
]

export const fleetRings = [
  { label: "Orders fulfilled", value: 87, maxValue: 100 },
  { label: "Fleet utilization", value: 74, maxValue: 100 },
  { label: "Stops routed", value: 89, maxValue: 100 },
]

// Duration matrix in minutes; null = unreachable. Directed (row → column).
export const matrixNodes = ["D", "c-01", "c-02", "c-03", "c-04", "c-05", "c-06", "c-09"]
export const durationMatrix: (number | null)[][] = [
  [0, 14, 18, 21, 12, 17, 19, null],
  [15, 0, 9, 16, 22, 28, 31, null],
  [19, 8, 0, 10, 27, 33, 30, null],
  [22, 17, 11, 0, 30, 29, 24, null],
  [11, 23, 28, 31, 0, 9, 16, null],
  [18, 29, 34, 30, 10, 0, 8, null],
  [20, 30, 29, 25, 17, 9, 0, null],
  [null, null, null, null, null, null, null, 0],
]

export type SampleRun = {
  id: string
  label: string
  state: JobState
  seed: number
  budget: string
  cost?: string
  progress?: number
  finished?: string
}

export const runs: SampleRun[] = [
  { id: "run-0142", label: "Baseline · seed 0", state: "succeeded", seed: 0, budget: "30 s", cost: "$318.20", finished: "2 min ago" },
  { id: "run-0143", label: "Sweep · seed 1", state: "running", seed: 1, budget: "30 s", progress: 62 },
  { id: "run-0144", label: "Sweep · seed 2", state: "claimed", seed: 2, budget: "30 s" },
  { id: "run-0145", label: "Sweep · seed 3", state: "queued", seed: 3, budget: "30 s" },
  { id: "run-0139", label: "Road matrix test", state: "failed", seed: 0, budget: "120 s", finished: "1 h ago" },
  { id: "run-0137", label: "2 vans · tight windows", state: "cancelled", seed: 0, budget: "120 s", finished: "3 h ago" },
  { id: "run-0131", label: "Overnight sweep", state: "interrupted", seed: 4, budget: "120 s", finished: "yesterday" },
]

export const jobEvents = [
  { at: "10:42:03", text: "Claimed by worker-1 (lease 60 s, attempt 1)" },
  { at: "10:42:03", text: "Snapshot hash 9f2c…e41 · matrix haversine@25mph" },
  { at: "10:42:04", text: "Validated 9 clients, 3 vehicles, 1 depot" },
  { at: "10:42:04", text: "Solver started · PyVRP 0.14.0 · seed 1 · 30 s" },
  { at: "10:42:14", text: "Heartbeat · 33%" },
  { at: "10:42:24", text: "Heartbeat · 66%" },
]

export const configDiff = [
  { field: "fleet.vehicle_types[0].num_available", a: "3", b: "2" },
  { field: "fleet.vehicle_types[0].capacity", a: "[20, 12]", b: "[24, 12]" },
  { field: "solve.stop.max_runtime", a: "30 s", b: "120 s" },
  { field: "travel.mode", a: "haversine@25mph", b: "haversine@25mph", same: true },
  { field: "allocation.strategy", a: "priority", b: "optimized (CP-SAT)" },
]

export const pythonExport = `from pyvrp import Model
from pyvrp.stop import MaxRuntime

m = Model()
depot = m.add_depot(x=0, y=0, tw_early=28_800, tw_late=61_200)
m.add_vehicle_type(num_available=3, capacity=[20, 12])

for c in clients:  # 9 clients from scenario v13
    m.add_client(x=c.x, y=c.y, delivery=c.demand,
                 tw_early=c.tw_early, tw_late=c.tw_late)

m.add_edges(matrix)  # recorded haversine matrix, 25 mph
res = m.solve(stop=MaxRuntime(30), seed=0)
print(res)`

export const importPreview = {
  columns: ["order_id", "address", "zip", "qty_water", "qty_rice", "window"],
  mapping: ["Stop ID", "Address", "ZIP", "Product: Water 24pk", "Product: Rice 10kg", "Time window"],
  rows: [
    ["A-1001", "501 Broadway", "37203", "4", "0", "08:00–10:00"],
    ["A-1002", "1 Titans Way", "37213", "2", "1", "09:00–12:00"],
    ["A-1003", "PO Box 2241", "37202", "1", "3", "10:00–13:00"],
    ["A-1003", "700 Church St", "37203", "-2", "0", "13:00–10:00"],
  ],
  issues: {
    2: "ZIP 37202 is PO-box-only; no ZCTA fallback",
    3: "Duplicate ID A-1003 · negative quantity · window ends before it starts",
  } as Record<number, string>,
}
