import type { RunSummary } from "@fillrate/contracts"

// Display-only road paths from the public Valhalla server, fetched by the browser for one selected shipment.
// The plan is always optimized on estimated travel (haversine × circuity); these lines never feed back into it.
export type LonLat = [number, number]

export const VALHALLA_URL = process.env.NEXT_PUBLIC_VALHALLA_URL || "https://valhalla1.openstreetmap.de/route"
/** The public server limits locations per request; longer routes are fetched in overlapping chunks. */
export const MAX_LOCATIONS = 20
export const ROAD_CREDIT = "Routing © Valhalla / FOSSGIS, data © OpenStreetMap contributors"
export const ROAD_COPY = "Road path is a display of Valhalla's route for the same stops. The plan was optimized on estimated distances, so road miles can differ."
export const SIMULATION_COPY = "Simulation along planned leg durations, proportional to distance along the road line. No live traffic or GPS."

/** A fetched road path for one shipment: `legs[i]` is the line into stop i (index 0 from the depot). */
export type RoadPath = { legs: LonLat[][]; miles: number }

/** Depot, then the shipment's stops in route order, as [lon, lat]; null when any stop has no coordinates. */
export function routeStops(summary: RunSummary, truckId: string | null): LonLat[] | null {
  const truck = summary.trucks.find((t) => t.id === truckId)
  if (!truck) return null
  const places = new globalThis.Map(summary.locations.map((l) => [l.id, l]))
  const stops: LonLat[] = [[summary.depot.lon, summary.depot.lat]]
  for (const visit of [...truck.visits].sort((a, b) => a.sequence - b.sequence)) {
    const place = places.get(visit.location_id)
    if (place?.lat == null || place.lon == null) return null
    stops.push([place.lon, place.lat])
  }
  return stops
}

/** Decodes an encoded polyline with 6 digits of precision (Valhalla) into [lon, lat] pairs. */
export function decodePolyline6(encoded: string): LonLat[] {
  const out: LonLat[] = []
  let index = 0, lat = 0, lon = 0
  const next = () => {
    let result = 0, shift = 0, byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    return result & 1 ? ~(result >> 1) : result >> 1
  }
  while (index < encoded.length) {
    lat += next()
    lon += next()
    out.push([lon / 1e6, lat / 1e6])
  }
  return out
}

/** Consecutive chunks of at most `size` locations; the last location of one chunk is the first of the next. */
export function chunkLocations<T>(locations: T[], size = MAX_LOCATIONS): T[][] {
  const chunks: T[][] = []
  for (let start = 0; start < locations.length - 1; start += size - 1) chunks.push(locations.slice(start, start + size))
  return chunks
}

/** Truck-costing road path through `stops` (depot first, in route order; open route, no return). One request per chunk, in sequence. */
export async function fetchRoadPath(stops: LonLat[], signal?: AbortSignal): Promise<RoadPath> {
  const legs: LonLat[][] = []
  let miles = 0
  for (const chunk of chunkLocations(stops)) {
    const res = await fetch(VALHALLA_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locations: chunk.map(([lon, lat]) => ({ lat, lon })), costing: "truck", units: "miles", directions_type: "none" }),
      signal,
    })
    if (!res.ok) throw new Error(res.status === 400 ? "Valhalla found no route for these stops." : `Valhalla returned HTTP ${res.status}.`)
    const trip = ((await res.json()) as { trip?: { legs?: { shape: string }[]; summary?: { length?: number } } }).trip
    if (!trip?.legs || trip.legs.length !== chunk.length - 1) throw new Error("Valhalla returned an unexpected route.")
    for (const leg of trip.legs) legs.push(decodePolyline6(leg.shape))
    miles += trip.summary?.length ?? 0
  }
  return { legs, miles }
}

const meters = (a: LonLat, b: LonLat) => {
  const k = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * 111_195
}

/** The point `fraction` (0..1) of the way along the line by distance. */
export function interpolateAlong(path: LonLat[], fraction: number): { lon: number; lat: number } {
  const f = Math.min(1, Math.max(0, fraction))
  const lengths = path.slice(1).map((p, i) => meters(path[i], p))
  const total = lengths.reduce((n, l) => n + l, 0)
  if (total === 0) return { lon: path[0][0], lat: path[0][1] }
  let remaining = f * total
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] === 0 ? 0 : Math.min(1, remaining / lengths[i])
      return { lon: path[i][0] + (path[i + 1][0] - path[i][0]) * t, lat: path[i][1] + (path[i + 1][1] - path[i][1]) * t }
    }
    remaining -= lengths[i]
  }
  const last = path[path.length - 1]
  return { lon: last[0], lat: last[1] }
}
