import type { RouteGeometryResponse } from "@fillrate/contracts"

// Client-safe helpers for Valhalla road geometry (spec §4, §10). Display only: the plan was optimized on the
// recorded matrix; these paths are Valhalla's route for the same legs.
export type LonLat = [number, number]

export const ROAD_COPY =
  "This plan was optimized on the recorded travel matrix. The drawn roads are a display of Valhalla's route for the same legs, not proof of what the solver used. Valhalla's route can differ slightly from the matrix; differences are listed below."
export const SIMULATION_COPY = "Simulation along planned leg durations, proportional to distance along the road line. No live traffic or GPS."

export const INELIGIBLE_COPY: Record<string, string> = {
  estimated_travel: "No road geometry: this run used estimated travel (straight line × circuity), not a road matrix.",
  imported_matrix: "No road geometry: this run used an imported matrix, not Valhalla.",
  provider_context_mismatch: "No road geometry: this server's Valhalla differs from the one that built the run's matrix (version, dataset, graph or costing).",
  valhalla_not_configured: "No road geometry: Valhalla is not configured on this server.",
}

export const roadLabel = (g: Pick<RouteGeometryResponse, "provider">) => `Road geometry (Valhalla truck, ${String((g.provider as { dataset_revision?: string }).dataset_revision ?? "dataset unknown")})`

/** Per-leg paths in stop order: index i is the leg into stop i (index 0 comes from the depot); null when Valhalla found no route. */
export function legPaths(g: Pick<RouteGeometryResponse, "legs">, count: number): (LonLat[] | null)[] {
  const out: (LonLat[] | null)[] = Array.from({ length: count }, () => null)
  for (const leg of g.legs) if (leg.index >= 0 && leg.index < count && leg.coordinates && leg.coordinates.length >= 2) out[leg.index] = leg.coordinates as LonLat[]
  return out
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
