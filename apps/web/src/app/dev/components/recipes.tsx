"use client"

// Chart recipes shared by the Charts section and the Blocks. They stay gallery recipes until the API
// contracts exist (M3); then they move to src/components/lab.

import { CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine, Scatter, XAxis, YAxis, ZAxis } from "recharts"

import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

import type { Iteration } from "./fixtures"
import type { KRow } from "./fixtures/k-explorer"

export function ChartTip({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-popover grid gap-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
      <div className="flex items-center gap-1.5 font-medium">{title}</div>
      <div className="text-muted-foreground font-mono tabular-nums">{children}</div>
    </div>
  )
}

const kConfig = {
  inertia: { label: "Within-cluster variance", color: "var(--muted-foreground)" },
  stability: { label: "Seed stability (ARI)", color: "var(--route-1)" },
} satisfies ChartConfig

/** Inertia (elbow) and seed stability per k, with a repair-count strip. Click a k to choose it. */
export function KElbowChart({
  rows,
  chosen,
  onChoose,
  className,
}: {
  rows: KRow[]
  chosen?: number
  onChoose?: (k: number) => void
  className?: string
}) {
  const data = rows.map((r) => ({ ...r, inertia: r.inertia / 1_000_000 }))
  return (
    <div className={className}>
      <ChartContainer config={kConfig} className="h-60 w-full">
        <ComposedChart
          data={data}
          margin={{ top: 12, right: 4 }}
          onClick={(e) => {
            const k = (e as { activeLabel?: number | string } | null)?.activeLabel
            if (k != null) onChoose?.(Number(k))
          }}
          className={cn(onChoose && "cursor-pointer")}
        >
          <CartesianGrid vertical={false} />
          <XAxis dataKey="k" tickLine={false} axisLine={false} tickFormatter={(k: number) => `k=${k}`} />
          <YAxis yAxisId="i" tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => `${v.toFixed(0)}M`} />
          <YAxis yAxisId="s" orientation="right" domain={[0.5, 1]} tickLine={false} axisLine={false} width={32} tickFormatter={(v: number) => v.toFixed(1)} />
          {chosen != null && (
            <ReferenceLine
              yAxisId="i"
              x={chosen}
              stroke="var(--foreground)"
              strokeDasharray="3 3"
              label={{ value: `k = ${chosen}`, position: "insideTopLeft", fontSize: 10, fill: "var(--foreground)" }}
            />
          )}
          <ChartTooltip
            content={({ payload }) => {
              const d = payload?.[0]?.payload as (typeof data)[number] | undefined
              if (!d) return null
              return (
                <ChartTip title={`k = ${d.k}`}>
                  variance {d.inertia.toFixed(1)}M mi² · stability {d.stability.toFixed(2)} · {d.repairs} need repair
                </ChartTip>
              )
            }}
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line yAxisId="i" dataKey="inertia" stroke="var(--color-inertia)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          <Line
            yAxisId="s"
            dataKey="stability"
            stroke="var(--color-stability)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--background)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>
      <div className="text-muted-foreground mt-1 flex items-center gap-2 pr-8 text-[10px]">
        <span className="w-7 shrink-0 text-right leading-tight">repair</span>
        <div className="grid flex-1 gap-px" style={{ gridTemplateColumns: `repeat(${rows.length}, 1fr)` }}>
          {rows.map((r) => (
            <button
              key={r.k}
              type="button"
              onClick={() => onChoose?.(r.k)}
              disabled={!onChoose}
              className={cn(
                "flex h-6 items-center justify-center rounded font-mono tabular-nums transition-shadow",
                r.repairs ? "bg-warning/15 text-warning-foreground" : "bg-muted text-muted-foreground",
                r.k === chosen && "ring-foreground/40 ring-1"
              )}
              title={`${r.repairs} clusters over the diameter limit at k = ${r.k}`}
            >
              {r.repairs || "✓"}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Average fill against shipped revenue per run; bubble = mean distance to centroid. Non-dominated runs are joined. */
export function TradeoffChart({ runs, highlight, className }: { runs: Iteration[]; highlight?: string[]; className?: string }) {
  const points = runs.map((r) => ({
    id: r.id,
    label: r.label,
    fill: +(r.metrics.avgFill * 100).toFixed(1),
    revenue: +(r.metrics.revenueShipped / 100_000_000).toFixed(3),
    centroid: r.metrics.meanToCentroid,
    nd: r.nonDominated,
    // Only non-dominated and highlighted runs are labeled; dominated runs name themselves in the tooltip.
    tag: r.nonDominated || highlight?.includes(r.id) ? r.label : "",
  }))
  // Runs at the same point share one label instead of printing over each other.
  const seen = new Map<string, (typeof points)[number]>()
  for (const p of points) {
    if (!p.tag) continue
    const key = `${p.fill}:${p.revenue}`
    const first = seen.get(key)
    if (first) {
      first.tag = `${first.tag} · ${p.tag}`
      p.tag = ""
    } else seen.set(key, p)
  }
  const front = points.filter((t) => t.nd).sort((a, b) => a.fill - b.fill)
  return (
    <div className={cn("relative", className)}>
    <span className="text-muted-foreground pointer-events-none absolute top-1 right-6 z-10 text-[10px]">better ↗</span>
    <ChartContainer config={{ nd: { label: "Non-dominated", color: "var(--success)" } }} className="h-72 w-full">
      <ComposedChart margin={{ top: 16, right: 24, left: 16, bottom: 12 }}>
        <CartesianGrid />
        <XAxis
          type="number"
          dataKey="fill"
          domain={[78, 86]}
          tickLine={false}
          axisLine={false}
          unit="%"
          name="Avg fill"
          label={{ value: "Average fill →", position: "insideBottom", offset: -8, fontSize: 10, fill: "var(--muted-foreground)" }}
        />
        <YAxis
          type="number"
          dataKey="revenue"
          domain={[3.9, 4.7]}
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(v: number) => `$${v.toFixed(1)}M`}
          label={{ value: "Shipped revenue →", angle: -90, position: "insideLeft", offset: -10, fontSize: 10, fill: "var(--muted-foreground)", style: { textAnchor: "middle" } }}
        />
        <ZAxis type="number" dataKey="centroid" range={[80, 420]} />
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={({ payload }) => {
            const d = payload?.[0]?.payload as (typeof points)[number] | undefined
            if (!d?.id) return null
            return (
              <ChartTip title={`${d.nd ? "★ " : ""}${d.label}`}>
                {d.fill}% fill · ${d.revenue.toFixed(2)}M · {d.centroid.toFixed(0)} mi to centroid
              </ChartTip>
            )
          }}
        />
        <Line data={front} dataKey="revenue" stroke="var(--success)" strokeDasharray="4 3" dot={false} isAnimationActive={false} legendType="none" />
        <Scatter data={points}>
          {points.map((d) => (
            <Cell
              key={d.id}
              fill={d.nd ? "var(--success)" : "var(--muted-foreground)"}
              fillOpacity={d.nd ? 0.75 : 0.4}
              stroke={highlight?.includes(d.id) ? "var(--foreground)" : "none"}
              strokeWidth={2}
            />
          ))}
          <LabelList
            dataKey="tag"
            content={(p) => {
              // Custom label: Recharts' default wraps scatter labels to the dot's width.
              const { x, y, width, value } = p as { x?: number; y?: number; width?: number; value?: string }
              if (!value || x == null || y == null) return null
              return (
                <text x={x + (width ?? 0) / 2} y={y - 6} textAnchor="middle" fontSize={10} fill="var(--foreground)">
                  {value}
                </text>
              )
            }}
          />
        </Scatter>
      </ComposedChart>
    </ChartContainer>
    </div>
  )
}
