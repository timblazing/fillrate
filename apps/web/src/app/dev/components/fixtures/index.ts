// Gallery fixture entry point: one synthetic scenario, one baseline pipeline run, and derived lookups.

import type { StockRow } from "@/components/lab/stock-table"
import type { Location, OrderLine, Product, Stop, Truck } from "@/lib/fulfillment"

import { baseline, type PipelineResult } from "./pipeline"
import { depot, products, scenario, syntheticScenario } from "./synthetic"

export { depot, products, scenario, syntheticScenario }
export { baseline, runPipeline, defaultSettings, type PipelineResult } from "./pipeline"
export { exploreK } from "./k-explorer"
export { iterations, settingsDiff, type Iteration } from "./iterations"

export type Lookups = {
  stops: Map<string, Stop>
  lines: Map<string, OrderLine>
  trucks: Map<string, Truck>
  products: Map<string, Product>
  locations: Map<string, Location>
  /** "Nashville, TN + 9 cities" */
  clusterArea: (cluster: number) => string
}

const lookupCache = new WeakMap<PipelineResult, Lookups>()

export function lookups(run: PipelineResult = baseline()): Lookups {
  const hit = lookupCache.get(run)
  if (hit) return hit
  const stops = new Map(run.stops.map((s) => [s.id, s]))
  const out: Lookups = {
    stops,
    lines: new Map(run.lines.map((l) => [l.id, l])),
    trucks: new Map(run.trucks.map((t) => [t.id, t])),
    products: new Map(products.map((p) => [p.id, p])),
    locations: new Map(syntheticScenario().locations.map((l) => [l.id, l])),
    clusterArea: (id) => {
      const c = run.clusters.find((x) => x.id === id)
      if (!c) return ""
      const counts = new Map<string, number>()
      for (const sid of c.stops) {
        const city = stops.get(sid)!.city
        counts.set(city, (counts.get(city) ?? 0) + 1)
      }
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
      return ranked.length > 1 ? `${ranked[0][0]} + ${ranked.length - 1} more` : ranked[0][0]
    },
  }
  lookupCache.set(run, out)
  return out
}

export function stockRows(run: PipelineResult = baseline()): StockRow[] {
  return products.map((product) => {
    const lines = run.lines.filter((l) => l.productId === product.id)
    const ordered = lines.reduce((s, l) => s + l.ordered, 0)
    const allocated = lines.reduce((s, l) => s + l.allocated, 0)
    const shortAmount = run.unshipped
      .filter((u) => u.productId === product.id && u.reason === "no-stock")
      .reduce((s, u) => s + u.amount, 0)
    return { product, ordered, stock: run.stock[product.id], allocated, shortAmount }
  })
}

export const clusterIds = (run: PipelineResult = baseline()) => run.clusters.map((c) => c.id)
