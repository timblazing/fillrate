"use client"

import { ArrowRight, CircleCheck, TriangleAlert } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { RunMetrics } from "@/lib/fulfillment"
import { formatCount, formatMiles, formatMoney } from "@/lib/units"
import { cn } from "@/lib/utils"

import { ConfigDiff, type DiffRow } from "./config-diff"
import { MetricDelta } from "./run-metrics"
import { FillPercent } from "./trailer-fill"

export type CompareRun = {
  id: string
  label: string
  changed: { field: string; value: string }[]
  metrics: RunMetrics
}

type MetricRow = {
  label: string
  goodWhen: "up" | "down"
  value: (m: RunMetrics) => number
  render: (m: RunMetrics) => React.ReactNode
  delta: (d: number) => string
}

const pts = (d: number) => `${(d * 100).toFixed(1)} pts`
const groups: { title: string; rows: MetricRow[] }[] = [
  {
    title: "Truck fill",
    rows: [
      { label: "Trucks", goodWhen: "down", value: (m) => m.trucks, render: (m) => formatCount(m.trucks), delta: (d) => String(d) },
      { label: "Avg fill", goodWhen: "up", value: (m) => m.avgFill, render: (m) => <FillPercent fill={m.avgFill} />, delta: pts },
      { label: "Min fill", goodWhen: "up", value: (m) => m.minFill, render: (m) => <FillPercent fill={m.minFill} />, delta: pts },
    ],
  },
  {
    title: "Cluster tightness",
    rows: [
      { label: "To centroid", goodWhen: "down", value: (m) => m.meanToCentroid, render: (m) => formatMiles(m.meanToCentroid), delta: formatMiles },
      { label: "Widest pair", goodWhen: "down", value: (m) => m.widestPair, render: (m) => formatMiles(m.widestPair), delta: formatMiles },
      { label: "Loaded miles", goodWhen: "down", value: (m) => m.loadedMiles, render: (m) => formatMiles(m.loadedMiles), delta: formatMiles },
    ],
  },
  {
    title: "Revenue",
    rows: [
      {
        label: "Shipped",
        goodWhen: "up",
        value: (m) => m.revenueShipped,
        render: (m) => formatMoney(m.revenueShipped, { compact: true }),
        delta: (d) => formatMoney(d, { compact: true }),
      },
      {
        label: "Allocated",
        goodWhen: "up",
        value: (m) => m.revenueAllocated,
        render: (m) => formatMoney(m.revenueAllocated, { compact: true }),
        delta: (d) => formatMoney(d, { compact: true }),
      },
    ],
  },
]

function RunHeader({ run, tag }: { run: CompareRun; tag: string }) {
  return (
    <div className="bg-card min-w-0 flex-1 rounded-xl border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="bg-foreground text-background flex size-5 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold">
          {tag}
        </span>
        <span className="truncate text-sm font-medium">{run.label}</span>
      </div>
      <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1 font-mono text-[10px]">
        {run.id}
        {run.changed.length === 0 ? (
          <span className="bg-muted rounded px-1 py-px">baseline settings</span>
        ) : (
          run.changed.map((c) => (
            <span key={c.field} className="bg-muted text-foreground rounded px-1 py-px">
              {c.field} {c.value}
            </span>
          ))
        )}
      </div>
    </div>
  )
}

// Two runs side by side (spec §10), PTV-style: who they are, whether they can be compared directly, what the
// metrics did, and which settings produced the difference. No composite score.
export function RunCompare({
  a,
  b,
  settings,
  scenarioLabel = "Same scenario and matrix",
  className,
}: {
  a: CompareRun
  b: CompareRun
  /** Settings diff between the two runs. Rows flagged `assumption` make the pair a changed-assumption comparison. */
  settings: DiffRow[]
  scenarioLabel?: string
  className?: string
}) {
  const assumptions = settings.filter((r) => !r.same && r.assumption)
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-stretch gap-2">
        <RunHeader run={a} tag="A" />
        <ArrowRight className="text-muted-foreground size-4 shrink-0 self-center" />
        <RunHeader run={b} tag="B" />
      </div>

      {assumptions.length ? (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>Changed assumption: {assumptions.map((r) => (r.label ?? r.field).toLowerCase()).join(", ")}</AlertTitle>
          <AlertDescription>
            These runs answer different questions. Compare them side by side, but differences are not only the solver&apos;s doing.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="success">
          <CircleCheck />
          <AlertTitle>{scenarioLabel} · directly comparable</AlertTitle>
          <AlertDescription>Only solver and clustering settings differ, so every change below comes from them.</AlertDescription>
        </Alert>
      )}

      <div className="bg-card overflow-hidden rounded-xl border text-xs">
        <div className="bg-muted/60 text-muted-foreground grid grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] border-b font-medium">
          <div className="px-3 py-2">Metric</div>
          <div className="px-3 py-2 text-right">A</div>
          <div className="px-3 py-2 text-right">B</div>
          <div className="px-3 py-2 text-right">B − A</div>
        </div>
        {groups.map((g) => (
          <div key={g.title} className="border-b last:border-b-0">
            <div className="text-muted-foreground px-3 pt-2 pb-1 text-[10px] font-medium tracking-wider uppercase">{g.title}</div>
            {g.rows.map((r) => {
              const changed = Math.abs(r.value(b.metrics) - r.value(a.metrics)) > 1e-9
              return (
                <div key={r.label} className="grid grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,1fr))] items-center">
                  <div className={cn("px-3 py-1.5", changed ? "font-medium" : "text-muted-foreground")}>{r.label}</div>
                  <div className="text-muted-foreground px-3 py-1.5 text-right font-mono tabular-nums">{r.render(a.metrics)}</div>
                  <div className="px-3 py-1.5 text-right font-mono font-medium tabular-nums">{r.render(b.metrics)}</div>
                  <div className="px-3 py-1.5 text-right">
                    <MetricDelta value={r.value(b.metrics)} base={r.value(a.metrics)} goodWhen={r.goodWhen} format={r.delta} />
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <ConfigDiff rows={settings} labels={[a.id, b.id]} className="bg-card" />
    </div>
  )
}
