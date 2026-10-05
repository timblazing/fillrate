// Labeled gallery fixture for TruckRouteTimeline: hand-written, not solver output. Leg durations are made up.
import { buildTimeline, timingSource } from "@/lib/timeline"

const depot = { lat: 35.1495, lon: -90.049 }
const places = new Map([
  ["a", { id: "a", label: "Nashville customer 1", lat: 36.16, lon: -86.78 }],
  ["b", { id: "b", label: "Louisville customer 2", lat: 38.25, lon: -85.76 }],
  ["c", { id: "c", label: "Indianapolis customer 3", lat: 39.77, lon: -86.16 }],
])
const visit = (i: number, loc: string, leg_m: number, leg_s: number | null, load: number) => ({ visit_id: `V${i}`, location_id: loc, sequence: i, leg_m, leg_s, load })
const legs = (timed: boolean) => [visit(1, "a", 322_000, timed ? 12_600 : null, 1_800), visit(2, "b", 245_000, timed ? 8_700 : null, 1_500), visit(3, "c", 180_000, timed ? 6_300 : null, 1_200)]

export const timedTruck = buildTimeline({ id: "C1-T1", load: 4_500, visits: legs(true) }, depot, places)
export const untimedTruck = buildTimeline({ id: "C1-T2", load: 4_500, visits: legs(false) }, depot, places)
export const estimatedSource = timingSource({ mode: "estimated", provider: "haversine" })
export const importedSource = timingSource({ mode: "snapshot", provider: "imported" })
export const depotLabel = "Memphis DC"
