"use client"

import { Plus } from "lucide-react"
import { useState } from "react"

import { ConfigDiff, type DiffRow } from "@/components/lab/config-diff"
import { IterationTable } from "@/components/lab/iteration-table"
import { RunMetricGroups } from "@/components/lab/run-metrics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

import { defaultSettings, iterations } from "../fixtures"
import type { PipelineSettings } from "@/lib/fulfillment"
import { TradeoffChart } from "../recipes"
import { AppShell } from "./shell"

const fields: [keyof PipelineSettings, string, (v: PipelineSettings[keyof PipelineSettings]) => string][] = [
  ["k", "cluster.k", (v) => String(v)],
  ["kmeansSeed", "cluster.kmeans_seed", (v) => String(v)],
  ["nInit", "cluster.n_init", (v) => String(v)],
  ["inventoryPct", "inventory.percent", (v) => `${v}%`],
  ["strategy", "allocation.strategy", (v) => (v === "date-value" ? "order date, then value" : "first come")],
  ["circuity", "travel.circuity_factor", (v) => String(v)],
  ["maxLegMiles", "travel.max_leg_mi", (v) => String(v)],
  ["maxDiameterMiles", "cluster.max_diameter_mi", (v) => String(v)],
]

// Iteration comparison (spec §8a, §10): the sweep table, the trade-off plot, and a two-run diff with metric deltas.
export function ComparisonBlock() {
  const sweep = iterations()
  const [selected, setSelected] = useState<string[]>(["run-0212", "run-0220"])
  const [aId, bId] = selected.length === 2 ? selected : [selected[0] ?? "run-0212", selected[0] ?? "run-0212"]
  const a = sweep.find((r) => r.id === aId)!
  const b = sweep.find((r) => r.id === bId)!
  const sa = { ...defaultSettings, ...a.settings }
  const sb = { ...defaultSettings, ...b.settings }
  const diff: DiffRow[] = fields.map(([key, field, fmt]) => ({
    field,
    a: fmt(sa[key]),
    b: fmt(sb[key]),
    same: sa[key] === sb[key],
  }))

  return (
    <AppShell
      active="Experiments"
      crumb="Sweep · Sep 29"
      height="h-[1080px]"
      actions={
        <Button size="sm">
          <Plus /> Add runs
        </Button>
      }
    >
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{sweep.length} runs</span>
            <span className="text-muted-foreground">of 25 max · same scenario v14 and matrix · varied:</span>
            {["k", "k-means seed", "inventory", "strategy", "circuity", "max leg"].map((v) => (
              <Badge key={v} variant="outline">
                {v}
              </Badge>
            ))}
            <span className="text-muted-foreground ml-auto text-xs">
              ★ {sweep.filter((r) => r.nonDominated).length} non-dominated
            </span>
          </div>

          <IterationTable rows={sweep} baselineId="run-0212" selected={selected} onSelectedChange={setSelected} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <section className="bg-card space-y-2 rounded-xl border p-4">
              <h3 className="text-sm font-medium">Trade-off</h3>
              <TradeoffChart runs={sweep} highlight={selected} />
            </section>
            <section className="space-y-3">
              <h3 className="text-sm font-medium">
                {b.label} <span className="text-muted-foreground font-normal">vs</span> {a.label}
              </h3>
              <ConfigDiff rows={diff} labels={[a.id, b.id]} className="bg-card" />
            </section>
          </div>

          <RunMetricGroups metrics={b.metrics} baseline={a.metrics} maxDiameter={sb.maxDiameterMiles} />
        </div>
      </ScrollArea>
    </AppShell>
  )
}
