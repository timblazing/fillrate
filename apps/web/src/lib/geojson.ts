import type { RouteGeometryResponse, RunSummary } from "@fillrate/contracts"

export const GEOJSON_EXPORT_VERSION = 1
export const GEOMETRY_NOTE = "Straight lines between stops in visit order for orientation only; this is not road geometry. Open route: the synthetic return to the depot is not included."

export const ROAD_NOTE = "Valhalla's route for the same legs, for display. The plan was optimized on the recorded travel matrix; these paths do not prove which roads the solver used. No live traffic."

type Position = [number, number]
type Properties = Record<string, unknown>
export type RouteFeature =
  | { type: "Feature"; geometry: { type: "Point"; coordinates: Position }; properties: Properties }
  | { type: "Feature"; geometry: { type: "LineString"; coordinates: Position[] }; properties: Properties }

/**
 * RFC 7946 FeatureCollection for a succeeded run (spec §13): the depot, one Point per planned stop location and
 * one LineString per truck (depot, then each physical visit in order). The open-route return to the depot is
 * never part of the planned service, so it is never drawn. Coordinates are [lon, lat], exactly as stored.
 */
export function buildRouteGeoJson(runId: string, summary: RunSummary, roads?: Map<string, RouteGeometryResponse>) {
  const places = new Map(summary.locations.map(l => [l.id, l]))
  const stops = new Map<string, { trucks: Set<string>; visits: number; pieces: number; linear_feet_hundredths: number; amount_cents: number }>()
  let omitted = 0
  const lines: RouteFeature[] = []
  const depot: Position = [summary.depot.lon, summary.depot.lat]
  const travel = summary.travel
  for (const truck of summary.trucks) {
    const coordinates: Position[] = [depot]
    let used = 0
    for (const visit of [...truck.visits].sort((a, b) => a.sequence - b.sequence)) {
      const place = places.get(visit.location_id)
      const entry = stops.get(visit.location_id) ?? { trucks: new Set<string>(), visits: 0, pieces: 0, linear_feet_hundredths: 0, amount_cents: 0 }
      stops.set(visit.location_id, entry)
      entry.trucks.add(truck.id)
      entry.visits += 1
      for (const line of visit.lines) { entry.pieces += line.pieces; entry.linear_feet_hundredths += line.linear_feet; entry.amount_cents += line.amount_cents }
      if (place?.lat == null || place.lon == null) { omitted += 1; continue }
      coordinates.push([place.lon, place.lat])
      used += 1
    }
    if (used === 0) continue
    const road = roads?.get(truck.id)
    if (road) {
      // One LineString per leg, labeled as Valhalla road geometry; legs Valhalla could not route are absent, not straight.
      const provider = road.provider as Record<string, unknown>
      for (const leg of road.legs) {
        if (!leg.coordinates) continue
        lines.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: leg.coordinates as Position[] },
          properties: {
            role: "route_leg", truck_id: truck.id, cluster_id: truck.cluster_id, leg_index: leg.index, from_id: leg.from_id, to_id: leg.to_id,
            geometry: "valhalla_road", provider: "valhalla", provider_version: provider.version, dataset_revision: provider.dataset_revision,
            graph_config_hash: provider.graph_config_hash, costing: provider.costing, costing_options: provider.costing_options,
            route_m: leg.route_m, route_s: leg.route_s, matrix_m: leg.matrix_m, matrix_s: leg.matrix_s, delta_m: leg.delta_m, delta_s: leg.delta_s,
            relative_m: leg.relative_m, relative_s: leg.relative_s, discrepancy_notable: leg.notable, leg_status: leg.status, note: ROAD_NOTE,
          },
        })
      }
      continue
    }
    lines.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: {
        role: "route", truck_id: truck.id, cluster_id: truck.cluster_id, stops: truck.visits.length, distance_m: truck.distance_m,
        ...(truck.drive_s != null ? { drive_s: truck.drive_s } : {}),
        travel_provider: travel?.provider ?? "estimated", travel_mode: travel?.mode ?? "estimated",
        geometry: "schematic_straight_line", note: GEOMETRY_NOTE,
      },
    })
  }
  const points: RouteFeature[] = [{ type: "Feature", geometry: { type: "Point", coordinates: depot }, properties: { role: "depot", id: summary.depot.id, label: summary.depot.label } }]
  let unlocated = 0
  for (const [id, entry] of [...stops].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const place = places.get(id)
    if (place?.lat == null || place.lon == null) { unlocated += 1; continue }
    points.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [place.lon, place.lat] },
      properties: { role: "stop", location_id: id, label: place.label, cluster_id: place.cluster_id, trucks: [...entry.trucks].sort(), visits: entry.visits, pieces: entry.pieces, linear_feet_hundredths: entry.linear_feet_hundredths, amount_cents: entry.amount_cents },
    })
  }
  const planned = new Set(stops.keys())
  const roadTrucks = [...(roads?.keys() ?? [])].filter(id => summary.trucks.some(t => t.id === id)).sort()
  return {
    type: "FeatureCollection" as const,
    fillrate: {
      kind: "fillrate.routes", export_version: GEOJSON_EXPORT_VERSION, run_id: runId,
      units: { distance: "meters", duration: "seconds", linear_feet: "hundredths of a foot", money: "cents" },
      coordinates: "[longitude, latitude] (WGS 84), as stored",
      geometry: roadTrucks.length ? "mixed" : "schematic_straight_line", geometry_note: GEOMETRY_NOTE,
      ...(roadTrucks.length ? {
        road_geometry: {
          note: ROAD_NOTE, trucks: roadTrucks,
          legs_without_route: Object.fromEntries(roadTrucks.map(id => [id, roads!.get(id)!.legs.filter(l => !l.coordinates).map(l => ({ leg_index: l.index, from_id: l.from_id, to_id: l.to_id, status: l.status, error: l.error ?? null }))])),
          summary: Object.fromEntries(roadTrucks.map(id => [id, roads!.get(id)!.summary])),
        },
      } : {}),
      travel: travel ? { mode: travel.mode, provider: travel.provider, provider_version: travel.provider_version, snapshot_id: travel.snapshot_id ?? null, circuity: travel.circuity ?? null } : { mode: "estimated", provider: "estimated" },
      counts: { trucks: summary.trucks.length, routes: lines.filter(f => f.properties.role === "route").length, road_legs: lines.filter(f => f.properties.role === "route_leg").length, planned_stops: points.length - 1 },
      omitted: { planned_locations_without_coordinates: unlocated, visits_without_coordinates: omitted, unplanned_or_unrouted_locations: summary.locations.filter(l => !planned.has(l.id)).length },
    },
    features: [...points, ...lines],
  }
}
