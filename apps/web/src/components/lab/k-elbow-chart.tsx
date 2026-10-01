"use client"

import type { ExplorerSummary } from "@fillrate/contracts"
import { CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts"

import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

const config = {
  inertia: { label: "Squared-error sum (feature space)", color: "var(--muted-foreground)" },
  stability: { label: "Seed stability (mean ARI)", color: "var(--route-1)" },
} satisfies ChartConfig

/**
 * k explorer elbow (spec §8a): the mean unweighted feature-space squared-error sum per k, and seed
 * stability on its own axis. Descriptive statistics, not solver objectives. ARI can be negative, so
 * the stability axis is not clipped at zero.
 */
export function KElbowChart({ rows, chosen, onChoose, repaired = false, className }: {
  rows: ExplorerSummary["per_k"]
  chosen?: number
  onChoose?: (k: number) => void
  repaired?: boolean
  className?: string
}) {
  const data = rows.map((r) => ({ k: r.k, inertia: r.inertia_mean, stability: repaired ? r.stability_repaired : r.stability_raw }))
  const lowest = Math.min(0, ...data.map((d) => d.stability ?? 0))
  return (
    <ChartContainer config={config} className={cn("h-60 w-full", className)}>
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
        <YAxis yAxisId="i" tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => v.toPrecision(2)} />
        <YAxis yAxisId="s" orientation="right" domain={[lowest, 1]} tickLine={false} axisLine={false} width={32} tickFormatter={(v: number) => v.toFixed(1)} />
        {chosen != null && <ReferenceLine yAxisId="i" x={chosen} stroke="var(--foreground)" strokeDasharray="3 3" />}
        <ChartTooltip
          content={({ payload }) => {
            const d = payload?.[0]?.payload as (typeof data)[number] | undefined
            if (!d) return null
            return (
              <div className="bg-popover grid gap-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                <div className="font-medium">k = {d.k}</div>
                <div className="text-muted-foreground font-mono tabular-nums">
                  error sum {d.inertia.toPrecision(3)} · stability {d.stability == null ? "n/a" : d.stability.toFixed(2)}
                </div>
              </div>
            )
          }}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line yAxisId="i" dataKey="inertia" stroke="var(--color-inertia)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        <Line yAxisId="s" dataKey="stability" stroke="var(--color-stability)" strokeWidth={2} dot={{ r: 3, fill: "var(--background)", strokeWidth: 2 }} isAnimationActive={false} connectNulls />
      </ComposedChart>
    </ChartContainer>
  )
}
