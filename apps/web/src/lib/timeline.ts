// Planned-route timeline (spec §13, M7). Pure model: ordered arrival/service/departure, drive/wait/service
// states and supported loads before/after each stop, from a validated persisted truck. It is planned-route
// simulation from solver legs: not traffic, not GPS, and not solver-search history. Service time and time
// windows are not modeled, so service is an explicit 0 s and there is no waiting.

export type TimelineVisitInput = {
  visit_id: string
  location_id: string
  sequence: number
  leg_m: number
  /** Absent on results saved before leg durations were recorded. */
  leg_s?: number | null
  /** Hundredths of a linear foot delivered at this stop. */
  load: number
}

export type TimelineTruckInput = { id: string; load: number; visits: TimelineVisitInput[] }
export type TimelinePlace = { id: string; label: string; lat: number | null; lon: number | null }

export type TimelineStop = {
  /** Position in the route, 1-based. */
  sequence: number
  visitId: string
  locationId: string
  label: string
  /** Seconds from depot departure; null when timing is unavailable. */
  arrivalS: number | null
  legM: number
  legS: number | null
  /** Modeled service duration. Always 0: service time is not modeled. */
  serviceS: 0
  loadBefore: number
  loadAfter: number
  delivered: number
  lon: number | null
  lat: number | null
}

export type Timeline = {
  truckId: string
  /** Load on board when leaving the depot (hundredths of a foot). */
  departLoad: number
  stops: TimelineStop[]
  /** True when every leg has a recorded duration. */
  timed: boolean
  /** Drive seconds, depot to the last stop. The synthetic return to the depot is not planned or timed. */
  totalS: number | null
  /** True when every stop and the depot have coordinates, so a position can be drawn. */
  located: boolean
  depot: { lat: number; lon: number }
}

export function buildTimeline(truck: TimelineTruckInput, depot: { lat: number; lon: number }, places: Map<string, TimelinePlace>): Timeline {
  const timed = truck.visits.length > 0 && truck.visits.every((v) => typeof v.leg_s === "number")
  let onBoard = truck.visits.reduce((n, v) => n + v.load, 0)
  let clock = 0
  const stops = truck.visits
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map<TimelineStop>((v) => {
      const place = places.get(v.location_id)
      if (timed) clock += v.leg_s as number
      const stop: TimelineStop = {
        sequence: v.sequence,
        visitId: v.visit_id,
        locationId: v.location_id,
        label: place?.label ?? v.location_id,
        arrivalS: timed ? clock : null,
        legM: v.leg_m,
        legS: typeof v.leg_s === "number" ? v.leg_s : null,
        serviceS: 0,
        loadBefore: onBoard,
        loadAfter: onBoard - v.load,
        delivered: v.load,
        lon: place?.lon ?? null,
        lat: place?.lat ?? null,
      }
      onBoard -= v.load
      return stop
    })
  return {
    truckId: truck.id,
    departLoad: truck.visits.reduce((n, v) => n + v.load, 0),
    stops,
    timed,
    totalS: timed ? clock : null,
    located: stops.every((s) => s.lat != null && s.lon != null),
    depot,
  }
}

export type CursorState = {
  /** `depot` at departure, `drive` between stops, `service` at a stop (0 s, not modeled). */
  phase: "depot" | "drive" | "service"
  /** Index into `stops` of the stop reached (service) or being driven to (drive). */
  stopIndex: number | null
  /** Fraction 0..1 along the current leg while driving. */
  fraction: number
  /** Load on board at the cursor (hundredths of a foot). */
  load: number
  position: { lon: number; lat: number } | null
}

/** Where the truck is at `t` seconds, interpolating linearly along the straight segment between stops. */
export function cursorAt(timeline: Timeline, t: number): CursorState | null {
  if (!timeline.timed || timeline.totalS == null || timeline.stops.length === 0) return null
  const clamped = Math.min(Math.max(t, 0), timeline.totalS)
  const { stops, depot } = timeline
  const place = (i: number) => {
    const p = i < 0 ? depot : stops[i]
    return p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : null
  }
  // The last stop reached. Arrival times never decrease, and a zero-second leg arrives with the previous stop.
  let reached = -1
  for (let i = 0; i < stops.length; i++) if ((stops[i].arrivalS as number) <= clamped) reached = i
  const departS = reached < 0 ? 0 : (stops[reached].arrivalS as number)
  const load = reached < 0 ? timeline.departLoad : stops[reached].loadAfter
  if (reached >= 0 && clamped === departS) return { phase: "service", stopIndex: reached, fraction: 1, load, position: place(reached) }
  if (reached < 0 && clamped === 0) return { phase: "depot", stopIndex: null, fraction: 0, load, position: place(-1) }
  const next = reached + 1
  const fraction = (clamped - departS) / ((stops[next].arrivalS as number) - departS)
  const a = place(reached)
  const b = place(next)
  const position = a && b ? { lon: a.lon + (b.lon - a.lon) * fraction, lat: a.lat + (b.lat - a.lat) * fraction } : null
  return { phase: "drive", stopIndex: next, fraction, load, position }
}

/** "0:00", "12:05", "1:04:09". */
export function formatClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`
}

/** "42 min", "3 h 05 min" for prose. */
export function formatDriveTime(seconds: number) {
  const s = Math.round(seconds)
  if (s < 60) return `${s} s`
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`
}

export type TimingSource = { timing: string; geometry: string }

/** Labels for where durations and geometry come from. Road geometry is never available yet. */
export function timingSource(travel: { mode: "estimated" | "snapshot"; provider: string } | null | undefined): TimingSource {
  const geometry = "Schematic straight-line path — road geometry not available"
  if (!travel) return { timing: "Drive time source not recorded", geometry }
  if (travel.mode === "estimated") return { timing: "Estimated drive time (constant speed)", geometry }
  if (travel.provider === "valhalla") return { timing: "Valhalla matrix durations", geometry }
  return { timing: "Imported matrix durations", geometry }
}
