"use client"

import { useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"

import { FunnelChart } from "@/components/charts/funnel-chart"
import { RadarArea } from "@/components/charts/radar-area"
import { RadarAxis } from "@/components/charts/radar-axis"
import { RadarChart } from "@/components/charts/radar-chart"
import { RadarGrid } from "@/components/charts/radar-grid"
import { RadarLabels } from "@/components/charts/radar-labels"
import { Ring } from "@/components/charts/ring"
import { RingChart } from "@/components/charts/ring-chart"
import { ClusterSwatch, routeColor } from "@/components/lab/route-swatch"
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { formatMiles, formatMoney } from "@/lib/units"
import { cn } from "@/lib/utils"

import { baseline, exploreK, iterations, lookups, products } from "../fixtures"
import { ChartTip as Tip, KElbowChart, TradeoffChart } from "../recipes"
import { Group, Specimen } from "../specimen"

function ChartCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("bg-background rounded-xl border p-4", className)}>{children}</div>
}


const fillConfig = {
  baseline: { label: "Baseline · k = 6", color: "var(--muted-foreground)" },
  k8: { label: "k = 8", color: "var(--route-1)" },
} satisfies ChartConfig

const productConfig = {
  ordered: { label: "Ordered", color: "var(--muted-foreground)" },
  allocated: { label: "Allocated", color: "var(--route-6)" },
  loaded: { label: "Loaded", color: "var(--route-1)" },
} satisfies ChartConfig

const radarColors = ["var(--muted-foreground)", "var(--route-1)", "var(--route-5)"]
const ringColors = ["var(--route-1)", "var(--route-3)", "var(--route-5)"]

export function Charts() {
  const run = baseline()
  const sweep = iterations()
  const explorer = exploreK()
  const look = lookups(run)
  const k8 = sweep.find((r) => r.id === "run-0214")!.result
  const [radarHover, setRadarHover] = useState<number | null>(null)
  const [ringHover, setRingHover] = useState<number | null>(null)

  const fillBuckets = (() => {
    const bucket = (fills: number[]) => {
      const out = Array.from({ length: 10 }, () => 0)
      for (const f of fills) out[Math.min(9, Math.floor(f * 10))]++
      return out
    }
    const a = bucket(run.trucks.map((t) => t.fill))
    const b = bucket(k8.trucks.map((t) => t.fill))
    return a.map((n, i) => ({ bucket: `${i * 10}–${i * 10 + 10}%`, low: i < 6, baseline: n, k8: b[i] }))
  })()


  const clusterPoints = run.clusters.map((c) => ({
    id: c.id,
    widest: Math.round(c.widestPair),
    fill: +(c.avgFill * 100).toFixed(1),
    revenue: c.value / 100,
    trucks: c.trucks.length,
  }))

  const excludedAmount = run.unshipped.filter((u) => u.reason === "data-quality").reduce((s, u) => s + u.amount, 0)
  const funnel = [
    { label: "Ordered", value: run.metrics.revenueOrdered / 100 },
    { label: "Eligible", value: (run.metrics.revenueOrdered - excludedAmount) / 100 },
    { label: "Allocated", value: run.metrics.revenueAllocated / 100 },
    { label: "Loaded", value: run.metrics.revenueShipped / 100 },
  ]

  const byProduct = products.map((p) => {
    const lines = run.lines.filter((l) => l.productId === p.id)
    const loadedLines = new Set(run.stops.filter((s) => s.truck).flatMap((s) => s.lineIds))
    return {
      product: p.label.split(",")[0],
      ordered: lines.reduce((s, l) => s + l.ordered, 0),
      allocated: lines.reduce((s, l) => s + l.allocated, 0),
      loaded: lines.filter((l) => loadedLines.has(l.id)).reduce((s, l) => s + l.allocated, 0),
    }
  })

  const radarRuns = ["run-0212", "run-0214", "run-0220"].map((id) => sweep.find((r) => r.id === id)!)
  const radarMetrics = [
    { key: "avgFill", label: "Avg fill" },
    { key: "minFill", label: "Min fill" },
    { key: "trucks", label: "Fewer trucks" },
    { key: "tight", label: "Tightness" },
    { key: "revenue", label: "Revenue" },
  ]
  const raw = (m: (typeof sweep)[number]["metrics"]) => ({
    avgFill: m.avgFill,
    minFill: m.minFill,
    trucks: -m.trucks,
    tight: -m.meanToCentroid,
    revenue: m.revenueShipped,
  })
  const radarData = radarRuns.map((r, i) => {
    const values = Object.fromEntries(
      radarMetrics.map(({ key }) => {
        const all = sweep.map((s) => raw(s.metrics)[key as keyof ReturnType<typeof raw>])
        const v = raw(r.metrics)[key as keyof ReturnType<typeof raw>]
        const lo = Math.min(...all)
        const hi = Math.max(...all)
        return [key, Math.round(40 + ((v - lo) / (hi - lo || 1)) * 60)]
      })
    )
    return { label: r.label, values, color: radarColors[i] }
  })

  const loadedStops = run.stops.filter((s) => s.truck).length
  const rings = [
    { label: "Average truck fill", value: Math.round(run.metrics.avgFill * 100), maxValue: 100 },
    { label: "Allocated amount shipped", value: Math.round((run.metrics.revenueShipped / run.metrics.revenueAllocated) * 100), maxValue: 100 },
    { label: "Stops loaded", value: Math.round((loadedStops / run.stops.length) * 100), maxValue: 100 },
  ]

  // Per-cluster best cost by iteration. Cost = $850 fixed per truck + $2.10 per loaded mile, the fixture's objective.
  const convergence = Array.from({ length: 41 }, (_, i) => {
    const row: Record<string, number> = { iteration: i * 50 }
    for (const c of run.clusters) {
      const final = c.trucks.length * 850 + c.loadedMiles * 2.1
      const step = Math.floor(i / (2 + (c.id % 3))) * (2 + (c.id % 3))
      row[`c${c.id}`] = Math.round(final * (1 + 0.32 * Math.exp(-0.09 * step * (1 + c.id / 10))))
    }
    return row
  })
  const convConfig = Object.fromEntries(
    run.clusters.map((c) => [`c${c.id}`, { label: `Cluster ${c.id}`, color: routeColor(c.id) }])
  ) satisfies ChartConfig

  return (
    <Group
      id="charts"
      load="windowed"
      index={4}
      title="Charts"
      description="shadcn Chart (Recharts) for axis charts; bklit for radar, funnel, and rings. Every chart reads the same fixture run. Clusters keep their series color in every view."
    >
      <div className="grid gap-10 xl:grid-cols-2 [&>*]:min-w-0">
        <Specimen
          id="fill-distribution"
          title="Fill distribution"
          description="Trucks per 10% fill bucket for two runs. The shaded area is the under-60% band the user wants to shrink."
        >
          <ChartCard>
            <ChartContainer config={fillConfig} className="h-72 w-full">
              <BarChart data={fillBuckets} barGap={1} margin={{ top: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval={0} />
                <YAxis tickLine={false} axisLine={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => `${l} full`} />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="baseline" fill="var(--color-baseline)" fillOpacity={0.45} radius={[3, 3, 0, 0]} />
                <Bar dataKey="k8" fill="var(--color-k8)" radius={[3, 3, 0, 0]}>
                  {fillBuckets.map((b) => (
                    <Cell key={b.bucket} fill={b.low ? "var(--warning)" : "var(--color-k8)"} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Specimen>

        <Specimen
          id="k-elbow"
          title="k explorer: elbow & stability"
          description="Within-cluster variance falls as k grows; stability is the mean adjusted Rand index over seeds 0–9. The row below counts clusters that need diameter repair."
        >
          <ChartCard>
            <KElbowChart rows={explorer.rows} chosen={7} />
          </ChartCard>
        </Specimen>

        <Specimen
          id="tradeoff"
          title="Iteration trade-off"
          description="Each run: average fill against shipped revenue; bubble size is mean distance to centroid (smaller is tighter). ★ runs are non-dominated, joined as the front."
        >
          <ChartCard>
            <TradeoffChart runs={sweep} />
          </ChartCard>
        </Specimen>

        <Specimen
          id="cluster-scatter"
          title="Cluster tightness vs fill"
          description="One bubble per cluster: widest pair against average fill, sized by revenue. The dashed line is the 500 mi diameter limit."
        >
          <ChartCard>
            <ChartContainer config={{}} className="h-72 w-full">
              <ScatterChart margin={{ top: 16, right: 16 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="widest" domain={[250, 520]} tickLine={false} axisLine={false} unit=" mi" name="Widest pair" />
                <YAxis type="number" dataKey="fill" domain={[70, 90]} tickLine={false} axisLine={false} width={40} unit="%" />
                <ZAxis type="number" dataKey="revenue" range={[160, 900]} />
                <ReferenceLine x={500} stroke="var(--destructive)" strokeDasharray="4 4" label={{ value: "limit", position: "insideTopRight", fontSize: 10, fill: "var(--destructive)" }} />
                <ChartTooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload as (typeof clusterPoints)[number] | undefined
                    if (!d) return null
                    return (
                      <Tip title={<><ClusterSwatch cluster={d.id} size="sm" /> {look.clusterArea(d.id)}</>}>
                        {formatMiles(d.widest)} wide · {d.fill}% avg fill · {d.trucks} trucks · {formatMoney(d.revenue * 100, { compact: true })}
                      </Tip>
                    )
                  }}
                />
                <Scatter data={clusterPoints}>
                  {clusterPoints.map((d) => (
                    <Cell key={d.id} fill={routeColor(d.id)} fillOpacity={0.75} stroke={routeColor(d.id)} />
                  ))}
                  <LabelList dataKey="id" position="center" fontSize={10} fill="white" formatter={(v) => `C${v}`} />
                </Scatter>
              </ScatterChart>
            </ChartContainer>
          </ChartCard>
        </Specimen>

        <Specimen id="revenue-funnel" title="Revenue funnel" description="Ordered → eligible (has coordinates) → allocated → loaded on a truck, in dollars.">
          <ChartCard className="h-80">
            <FunnelChart
              data={funnel}
              color="var(--route-1)"
              layers={3}
              className="h-full"
              formatValue={(v) => formatMoney(v * 100, { compact: true })}
              grid
            />
          </ChartCard>
        </Specimen>

        <Specimen id="rings" title="Headline rings" description="Run headline ratios. Hover a ring.">
          <ChartCard className="flex h-80 items-center justify-center gap-8">
            <div className="relative">
              <RingChart
                data={rings.map((r, i) => ({ ...r, color: ringColors[i] }))}
                size={220}
                strokeWidth={12}
                ringGap={6}
                baseInnerRadius={56}
                hoveredIndex={ringHover}
                onHoverChange={setRingHover}
              >
                {rings.map((r, i) => (
                  <Ring key={r.label} index={i} />
                ))}
              </RingChart>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-semibold tracking-tight tabular-nums">{rings[ringHover ?? 0].value}%</span>
                <span className="text-muted-foreground max-w-24 text-center text-[11px] leading-tight">{rings[ringHover ?? 0].label}</span>
              </div>
            </div>
            <ul className="space-y-1">
              {rings.map((r, i) => (
                <li
                  key={r.label}
                  onMouseEnter={() => setRingHover(i)}
                  onMouseLeave={() => setRingHover(null)}
                  className={cn("flex items-center gap-2.5 rounded-md px-2 py-1 text-sm transition-opacity", ringHover != null && ringHover !== i && "opacity-50")}
                >
                  <span className="size-2.5 rounded-full" style={{ background: ringColors[i] }} />
                  <span className="flex-1">{r.label}</span>
                  <span className="text-muted-foreground font-mono text-xs tabular-nums">{r.value}%</span>
                </li>
              ))}
            </ul>
          </ChartCard>
        </Specimen>

        <Specimen
          id="by-product"
          title="Allocation by product"
          description="Ordered, allocated, and loaded pieces per SKU, reported separately. Mattresses and patio sets are short on stock."
          className="xl:col-span-2"
        >
          <ChartCard>
            <ChartContainer config={productConfig} className="h-72 w-full">
              <BarChart data={byProduct} barGap={2} margin={{ top: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="product" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => v.toLocaleString("en-US")} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="ordered" fill="var(--color-ordered)" fillOpacity={0.35} radius={[3, 3, 0, 0]} />
                <Bar dataKey="allocated" fill="var(--color-allocated)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="loaded" fill="var(--color-loaded)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Specimen>

        <Specimen
          id="radar"
          title="Iteration radar"
          description="Three runs scored relative to this sweep only (40 = worst run, 100 = best). Shape, not a score: the axes are never summed."
          className="xl:col-span-2"
        >
          <ChartCard className="grid items-center gap-6 md:grid-cols-[1fr_18rem] md:pr-10">
            <div className="mx-auto h-[24rem] w-full max-w-lg">
              <RadarChart data={radarData} metrics={radarMetrics} hoveredIndex={radarHover} onHoverChange={setRadarHover} margin={64} className="h-full">
                <RadarGrid />
                <RadarAxis />
                <RadarLabels />
                {radarData.map((r, i) => (
                  <RadarArea key={r.label} index={i} />
                ))}
              </RadarChart>
            </div>
            <ul className="space-y-1">
              {radarRuns.map((r, i) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setRadarHover(i)}
                    onMouseLeave={() => setRadarHover(null)}
                    onFocus={() => setRadarHover(i)}
                    onBlur={() => setRadarHover(null)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-[background-color,opacity]",
                      radarHover === i && "bg-muted",
                      radarHover != null && radarHover !== i && "opacity-50"
                    )}
                  >
                    <span className="size-2.5 rounded-full" style={{ background: radarColors[i] }} />
                    <span className="flex-1">{r.label}</span>
                    <span className="text-muted-foreground font-mono text-xs">{r.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </ChartCard>
        </Specimen>

        <Specimen
          id="convergence"
          title="Per-cluster convergence"
          description="Best cost by iteration for each cluster's PyVRP solve, read from final solver statistics after the run. Never live telemetry."
          className="xl:col-span-2"
        >
          <ChartCard>
            <ChartContainer config={convConfig} className="h-64 w-full">
              <LineChart data={convergence} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="iteration" tickLine={false} axisLine={false} minTickGap={32} />
                <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, p) => `Iteration ${p?.[0]?.payload?.iteration?.toLocaleString("en-US")}`} />} />
                <ChartLegend content={<ChartLegendContent />} />
                {run.clusters.map((c) => (
                  <Line key={c.id} dataKey={`c${c.id}`} type="stepAfter" stroke={`var(--color-c${c.id})`} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ChartContainer>
          </ChartCard>
        </Specimen>
      </div>
    </Group>
  )
}
