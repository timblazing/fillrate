import { interpolateAlong, type LonLat } from "./road-geometry"

// Planned-route timeline (spec §13, M7). Pure model: ordered arrival/service/departure, drive/wait/service
// states and supported loads before/after each stop, from a validated persisted truck. It is planned-route
// simulation from solver legs: not traffic, not GPS, and not solver-search history. Without time-window data
// (results before M6, scenarios with no time model) service is an explicit 0 s and there is no waiting. With it,
// the validator's arrival, wait, service, start and departure seconds are shown, in the scenario's timezone.

export type TimelineVisitInput = {
  visit_id: string
  location_id: string
  sequence: number
  leg_m: number
  /** Absent on results saved before leg durations were recorded. */
  leg_s?: number | null
  /** Hundredths of a linear foot delivered at this stop. */
  load: number
  /** Time-window adapter only: seconds elapsed from local midnight on the planning date. */
  arrival_s?: number | null
  wait_s?: number | null
  service_s?: number | null
  start_s?: number | null
  departure_s?: number | null
  window_earliest_s?: number | null
  window_latest_s?: number | null
}

export type TimelineTruckInput = { id: string; load: number; shift_start_s?: number | null; visits: TimelineVisitInput[] }
/** `RunSummary.time`: how elapsed seconds map to local clock time. */
export type TimelineClock = { timezone: string; planning_date: string; midnight_epoch_s: number }
export type TimelinePlace = { id: string; label: string; lat: number | null; lon: number | null }

export type TimelineStop = {
  /** Position in the route, 1-based. */
  sequence: number
  visitId: string
  locationId: string
  label: string
  /** Seconds from depot departure; null when timing is unavailable. */
  arrivalS: number | null
  /** Seconds from depot departure when service starts (after any wait) and when the truck leaves. */
  startS: number | null
  departS: number | null
  legM: number
  legS: number | null
  /** Seconds waiting for the window to open; 0 when no waiting is modeled. */
  waitS: number
  /** Modeled service duration; 0 unless the time-window adapter supplied one. */
  serviceS: number
  /** Window and slack (latest - start), local clock strings; null when the visit has no window. */
  window: { earliest: string; latest: string; slackS: number } | null
  /** Local clock strings ("HH:MM", "+1d" after midnight) when a clock is known. */
  arrivalClock: string | null
  startClock: string | null
  departClock: string | null
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
  /** True when every stop carries validated arrival/wait/service/departure from the time-window adapter. */
  scheduled: boolean
  /** Seconds from depot departure to the last departure (drive only when nothing waits or serves). The synthetic
   * return to the depot is not planned or timed. */
  totalS: number | null
  driveS: number | null
  waitS: number
  serviceS: number
  /** Local clock at depot departure, when a clock is known. */
  departClock: string | null
  /** Seconds after local midnight at depot departure (0 without the time-window adapter). */
  shiftStartS: number
  /** True when every stop and the depot have coordinates, so a position can be drawn. */
  located: boolean
  depot: { lat: number; lon: number }
  /** Valhalla road line for the leg into stop i (index 0 from the depot), when road geometry was fetched; null where
   * Valhalla found no route. Absent without road geometry: the cursor then moves along straight segments. */
  legPaths?: (LonLat[] | null)[]
}

/** The same timeline with fetched road geometry attached; the cursor then follows the road lines. */
export const withRoadPaths = (timeline: Timeline, legPaths: (LonLat[] | null)[]): Timeline => ({ ...timeline, legPaths })

const partsOf = (epochS: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(epochS * 1000))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { day: Date.UTC(get("year"), get("month") - 1, get("day")), hour: get("hour") % 24, minute: get("minute") }
}

/** Local wall-clock text for `elapsedS` seconds after local midnight of the planning date, in the scenario's timezone
 * ("06:05", "01:30 +1d"). Uses real UTC offsets, so a daylight-saving change on the planning day is honored. */
export function localClock(clock: TimelineClock | null | undefined, elapsedS: number | null | undefined): string | null {
  if (!clock || elapsedS == null) return null
  const midnight = partsOf(clock.midnight_epoch_s, clock.timezone)
  const at = partsOf(clock.midnight_epoch_s + elapsedS, clock.timezone)
  const days = Math.round((at.day - midnight.day) / 86_400_000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(at.hour)}:${pad(at.minute)}${days ? ` ${days > 0 ? "+" : ""}${days}d` : ""}`
}

export function buildTimeline(truck: TimelineTruckInput, depot: { lat: number; lon: number }, places: Map<string, TimelinePlace>, clock?: TimelineClock | null): Timeline {
  const timed = truck.visits.length > 0 && truck.visits.every((v) => typeof v.leg_s === "number")
  const scheduled = timed && typeof truck.shift_start_s === "number" && truck.visits.every((v) => typeof v.arrival_s === "number" && typeof v.start_s === "number" && typeof v.departure_s === "number")
  const shift = scheduled ? (truck.shift_start_s as number) : 0
  const rel = (n: number | null | undefined) => (typeof n === "number" ? n - shift : null)
  let onBoard = truck.visits.reduce((n, v) => n + v.load, 0)
  let driven = 0
  const stops = truck.visits
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map<TimelineStop>((v) => {
      const place = places.get(v.location_id)
      if (timed) driven += v.leg_s as number
      const arrivalS = scheduled ? rel(v.arrival_s) : timed ? driven : null
      const startS = scheduled ? rel(v.start_s) : arrivalS
      const departS = scheduled ? rel(v.departure_s) : arrivalS
      const latest = scheduled ? v.window_latest_s : null
      const stop: TimelineStop = {
        sequence: v.sequence,
        visitId: v.visit_id,
        locationId: v.location_id,
        label: place?.label ?? v.location_id,
        arrivalS,
        startS,
        departS,
        legM: v.leg_m,
        legS: typeof v.leg_s === "number" ? v.leg_s : null,
        waitS: scheduled ? (v.wait_s as number) : 0,
        serviceS: scheduled ? (v.service_s as number) : 0,
        window:
          scheduled && typeof v.window_earliest_s === "number" && typeof latest === "number"
            ? {
                earliest: localClock(clock, v.window_earliest_s) ?? formatClock(v.window_earliest_s),
                latest: localClock(clock, latest) ?? formatClock(latest),
                slackS: latest - (v.start_s as number),
              }
            : null,
        arrivalClock: scheduled ? localClock(clock, v.arrival_s) : null,
        startClock: scheduled ? localClock(clock, v.start_s) : null,
        departClock: scheduled ? localClock(clock, v.departure_s) : null,
        loadBefore: onBoard,
        loadAfter: onBoard - v.load,
        delivered: v.load,
        lon: place?.lon ?? null,
        lat: place?.lat ?? null,
      }
      onBoard -= v.load
      return stop
    })
  const last = stops[stops.length - 1]
  return {
    truckId: truck.id,
    departLoad: truck.visits.reduce((n, v) => n + v.load, 0),
    stops,
    timed,
    scheduled,
    totalS: timed ? ((last?.departS as number | null) ?? driven) : null,
    driveS: timed ? driven : null,
    waitS: stops.reduce((n, s) => n + s.waitS, 0),
    serviceS: stops.reduce((n, s) => n + s.serviceS, 0),
    departClock: scheduled ? localClock(clock, shift) : null,
    shiftStartS: shift,
    located: stops.every((s) => s.lat != null && s.lon != null),
    depot,
  }
}

export type CursorState = {
  /** `depot` at departure, `drive` between stops, `wait` for a window to open, `service` at a stop
   * (instant, 0 s, unless the time-window adapter supplied a duration). */
  phase: "depot" | "drive" | "wait" | "service"
  /** Index into `stops` of the stop reached (service) or being driven to (drive). */
  stopIndex: number | null
  /** Fraction 0..1 along the current leg while driving. */
  fraction: number
  /** Load on board at the cursor (hundredths of a foot). */
  load: number
  position: { lon: number; lat: number } | null
  /** True while driving a leg whose position is interpolated along its road line. */
  onRoad?: boolean
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
  const departS = reached < 0 ? 0 : (stops[reached].departS as number)
  if (reached >= 0) {
    const stop = stops[reached]
    if (clamped < (stop.startS as number)) {
      const span = (stop.startS as number) - (stop.arrivalS as number)
      return { phase: "wait", stopIndex: reached, fraction: (clamped - (stop.arrivalS as number)) / span, load: stop.loadBefore, position: place(reached) }
    }
    if (clamped <= departS) return { phase: "service", stopIndex: reached, fraction: 1, load: stop.loadAfter, position: place(reached) }
  }
  const load = reached < 0 ? timeline.departLoad : stops[reached].loadAfter
  if (reached < 0 && clamped === 0) return { phase: "depot", stopIndex: null, fraction: 0, load, position: place(-1) }
  const next = reached + 1
  const fraction = (clamped - departS) / ((stops[next].arrivalS as number) - departS)
  const a = place(reached)
  const b = place(next)
  const road = timeline.legPaths?.[next]
  const position = road ? interpolateAlong(road, fraction) : a && b ? { lon: a.lon + (b.lon - a.lon) * fraction, lat: a.lat + (b.lat - a.lat) * fraction } : null
  return { phase: "drive", stopIndex: next, fraction, load, position, onRoad: !!road }
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
export function timingSource(travel: { mode: "estimated" | "snapshot"; provider: string } | null | undefined, road?: string | null): TimingSource {
  const geometry = road ? `${road} — a simulation along planned leg durations (no live traffic or GPS)` : "Schematic straight-line path — road geometry not available"
  if (!travel) return { timing: "Drive time source not recorded", geometry }
  if (travel.mode === "estimated") return { timing: "Estimated drive time (constant speed)", geometry }
  if (travel.provider === "valhalla") return { timing: "Valhalla matrix durations", geometry }
  return { timing: "Imported matrix durations", geometry }
}
