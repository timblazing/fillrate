// A bounded sweep (spec §8a "Iterations are experiments"): each row is a real fixture pipeline run with one
// or two settings changed from the baseline. Non-dominated = no other run is at least as good on all three
// metric groups and better on one.

import type { JobState } from "@/components/lab/job-status"
import type { PipelineSettings, RunMetrics } from "@/lib/fulfillment"

import { exploreK } from "./k-explorer"
import { type PipelineResult, runPipeline } from "./pipeline"

export type Iteration = {
  id: string
  label: string
  changed: { field: string; value: string }[]
  settings: Partial<PipelineSettings>
  state: JobState
  metrics: RunMetrics
  nonDominated: boolean
  finished: string
  result: PipelineResult
}

const plan: { id: string; label: string; settings: Partial<PipelineSettings>; changed: Iteration["changed"]; finished: string }[] = [
  { id: "run-0212", label: "Baseline", settings: {}, changed: [], finished: "18 min ago" },
  { id: "run-0213", label: "k = 7 (explorer)", settings: { k: 7 }, changed: [{ field: "k", value: "7" }], finished: "16 min ago" },
  { id: "run-0214", label: "k = 8", settings: { k: 8 }, changed: [{ field: "k", value: "8" }], finished: "15 min ago" },
  { id: "run-0215", label: "k = 10", settings: { k: 10 }, changed: [{ field: "k", value: "10" }], finished: "14 min ago" },
  { id: "run-0216", label: "k = 7 · seed 9, n_init 1", settings: { k: 7, kmeansSeed: 9, nInit: 1 }, changed: [{ field: "k", value: "7" }, { field: "k-means seed", value: "9" }, { field: "n_init", value: "1" }], finished: "13 min ago" },
  { id: "run-0217", label: "Inventory 120%", settings: { inventoryPct: 120 }, changed: [{ field: "Inventory", value: "120%" }], finished: "11 min ago" },
  { id: "run-0218", label: "Circuity 1.3", settings: { circuity: 1.3 }, changed: [{ field: "Circuity", value: "1.3" }], finished: "9 min ago" },
  { id: "run-0219", label: "First-come", settings: { strategy: "first-come" }, changed: [{ field: "Strategy", value: "first-come" }], finished: "7 min ago" },
  { id: "run-0220", label: "Max leg 550 mi", settings: { maxLegMiles: 550 }, changed: [{ field: "Max leg", value: "550 mi" }], finished: "6 min ago" },
]

/** Higher is better for each of the three groups; tightness uses mean distance to centroid (lower is better). */
export function dominates(a: RunMetrics, b: RunMetrics) {
  const ge = a.avgFill >= b.avgFill && a.meanToCentroid <= b.meanToCentroid && a.revenueShipped >= b.revenueShipped
  const gt = a.avgFill > b.avgFill || a.meanToCentroid < b.meanToCentroid || a.revenueShipped > b.revenueShipped
  return ge && gt
}

let cached: Iteration[] | null = null

export function iterations(): Iteration[] {
  if (cached) return cached
  const explorer = exploreK()
  const rows = plan.map((p) => {
    const result = runPipeline(p.settings)
    const stability = explorer.rows.find((r) => r.k === result.metrics.k && p.settings.k != null)?.stability
    return { ...p, result, metrics: { ...result.metrics, stability }, state: "succeeded" as JobState }
  })
  cached = rows.map((r) => ({
    ...r,
    nonDominated: !rows.some((o) => o !== r && dominates(o.metrics, r.metrics)),
  }))
  return cached
}
