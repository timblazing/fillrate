// Order-line rows for tables: one row per line, with allocation and load state resolved from the run.

import type { LineState } from "@/components/lab/line-state"
import type { CoordinateSource } from "@/components/lab/provenance-badge"

import { type PipelineResult, baseline } from "./pipeline"
import { products, syntheticScenario } from "./synthetic"


export type OrderRow = {
  id: string
  orderId: string
  orderDate: string
  account: string
  city: string
  product: string
  sku: string
  ordered: number
  allocated: number
  /** Allocated linear feet, hundredths. */
  feet: number
  /** Allocated amount, cents. */
  amount: number
  source: CoordinateSource
  state: LineState
  truck: string | null
  cluster: number | null
}

const cache = new WeakMap<PipelineResult, OrderRow[]>()

export function orderRows(run: PipelineResult = baseline()): OrderRow[] {
  const hit = cache.get(run)
  if (hit) return hit
  const locs = new Map(syntheticScenario().locations.map((l) => [l.id, l]))
  const prods = new Map(products.map((p) => [p.id, p]))
  const stopOf = new Map<string, PipelineResult["stops"][number]>()
  for (const s of run.stops) for (const id of s.lineIds) if (!stopOf.has(id)) stopOf.set(id, s)
  const excluded = new Set(run.unshipped.filter((u) => u.reason === "data-quality").map((u) => u.lineId))

  const rows = run.lines.map((l): OrderRow => {
    const loc = locs.get(l.locationId)!
    const p = prods.get(l.productId)!
    const stop = stopOf.get(l.id)
    const state: LineState = excluded.has(l.id)
      ? "excluded"
      : l.allocated === 0
        ? "short"
        : stop && stop.depotMiles > run.settings.maxLegMiles
          ? "unreachable"
          : l.allocated < l.ordered
            ? "partial"
            : "loaded"
    return {
      id: l.id,
      orderId: l.orderId,
      orderDate: l.orderDate,
      account: loc.label,
      city: `${loc.city}, ${loc.state}`,
      product: p.label,
      sku: p.sku,
      ordered: l.ordered,
      allocated: l.allocated,
      feet: l.allocated * l.lfPerPiece,
      amount: l.allocated * l.valuePerPiece,
      source: loc.source,
      state,
      truck: stop?.truck ?? null,
      cluster: stop?.cluster ?? null,
    }
  })
  cache.set(run, rows)
  return rows
}
