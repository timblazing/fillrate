"use client"

import { useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
import { RouteSwatch, routeColor } from "@/components/lab/route-swatch"
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"

import {
  capacityUtilization,
  convergence,
  fleetRings,
  fulfillmentByProduct,
  fulfillmentFunnel,
  objectiveBreakdown,
  radarMetrics,
  radarRuns,
  seedSweep,
  workload,
} from "../sample-data"
import { Group, Specimen } from "../specimen"

const dollars = (cents: number) => `$${(cents / 100).toFixed(0)}`

const convergenceConfig = {
  seed0: { label: "Seed 0", color: "var(--route-1)" },
  seed1: { label: "Seed 1", color: "var(--route-5)" },
  seed2: { label: "Seed 2", color: "var(--route-3)" },
} satisfies ChartConfig

const objectiveConfig = {
  travel: { label: "Travel cost", color: "var(--route-1)" },
  fixed: { label: "Fixed vehicle cost", color: "var(--route-6)" },
  penalty: { label: "Infeasibility penalty", color: "var(--destructive)" },
  reward: { label: "Collected reward", color: "var(--route-3)" },
} satisfies ChartConfig

const capacityConfig = {
  weight: { label: "Weight", color: "var(--route-1)" },
  volume: { label: "Volume", color: "var(--route-6)" },
} satisfies ChartConfig

const workloadConfig = {
  minutes: { label: "Route duration", color: "var(--route-1)" },
} satisfies ChartConfig

const sweepConfig = {
  range: { label: "Best–worst", color: "var(--route-5)" },
  median: { label: "Median", color: "var(--foreground)" },
} satisfies ChartConfig

const productConfig = {
  ordered: { label: "Ordered", color: "var(--muted-foreground)" },
  allocated: { label: "Allocated", color: "var(--route-6)" },
  routed: { label: "Routed", color: "var(--route-1)" },
} satisfies ChartConfig

const runColors = ["var(--route-1)", "var(--muted-foreground)", "var(--route-5)"]
const ringColors = ["var(--route-3)", "var(--route-1)", "var(--route-5)"]

function ChartCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("bg-background rounded-xl border p-4", className)}>{children}</div>
}

export function Charts() {
  const [radarHover, setRadarHover] = useState<number | null>(null)
  const [ringHover, setRingHover] = useState<number | null>(null)
  const best = Math.min(...convergence.map((c) => Math.min(c.seed0, c.seed1, c.seed2)))

  return (
    <Group
      id="charts"
      index={4}
      title="Charts"
      description="shadcn Chart (Recharts) for axis charts; bklit (visx + motion) in src/components/charts for radar, funnel, and rings. Series use the route palette so a run or route keeps one color across every view."
    >
      <div className="grid gap-10 xl:grid-cols-2 [&>*]:min-w-0">
        <Specimen
          id="convergence"
          title="Convergence"
          source="recharts LineChart"
          spec="§9 §10"
          description="Best objective by iteration, from final solver statistics. Never live telemetry."
          className="xl:col-span-2"
        >
          <ChartCard>
            <ChartContainer config={convergenceConfig} className="h-72 w-full">
              <LineChart data={convergence} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="iteration"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : String(v))}
                  minTickGap={32}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  domain={[28000, 54000]}
                  ticks={[30000, 36000, 42000, 48000, 54000]}
                  tickFormatter={dollars}
                />
                <ReferenceLine
                  y={best}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="4 4"
                  label={{ value: `best ${dollars(best)}`, position: "insideBottomRight", fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, p) => `Iteration ${p?.[0]?.payload?.iteration?.toLocaleString()}`}
                      formatter={(v, name) => (
                        <div className="flex w-full items-center gap-2">
                          <span className="size-2 rounded-full" style={{ background: `var(--color-${name})` }} />
                          {convergenceConfig[name as keyof typeof convergenceConfig].label}
                          <span className="ml-auto font-mono tabular-nums">{dollars(Number(v))}</span>
                        </div>
                      )}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                {(["seed0", "seed1", "seed2"] as const).map((k) => (
                  <Line key={k} dataKey={k} type="stepAfter" stroke={`var(--color-${k})`} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ChartContainer>
          </ChartCard>
        </Specimen>

        <Specimen
          id="objective"
          title="Objective breakdown"
          source="recharts BarChart · stackOffset=sign"
          spec="§10"
          description="Nominal cost, infeasibility penalties, and collected rewards kept apart."
        >
          <ChartCard>
            <ChartContainer config={objectiveConfig} className="h-72 w-full">
              <BarChart data={objectiveBreakdown} layout="vertical" stackOffset="sign" margin={{ left: 4, right: 12 }}>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(v: number) => (v < 0 ? `−$${-v}` : `$${v}`)} />
                <YAxis type="category" dataKey="run" tickLine={false} axisLine={false} width={64} />
                <ReferenceLine x={0} stroke="var(--foreground)" strokeOpacity={0.4} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="travel" stackId="o" fill="var(--color-travel)" />
                <Bar dataKey="fixed" stackId="o" fill="var(--color-fixed)" />
                <Bar dataKey="penalty" stackId="o" fill="var(--color-penalty)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="reward" stackId="o" fill="var(--color-reward)" radius={[4, 0, 0, 4]} />
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Specimen>

        <Specimen
          id="utilization"
          title="Capacity utilization"
          source="recharts BarChart"
          spec="§10"
          description="Peak load per route and load dimension, as a share of vehicle capacity."
        >
          <ChartCard>
            <ChartContainer config={capacityConfig} className="h-72 w-full">
              <BarChart data={capacityUtilization} margin={{ top: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="route" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={36} domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
                <ReferenceLine y={100} stroke="var(--destructive)" strokeDasharray="4 4" />
                <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="weight" fill="var(--color-weight)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="volume" fill="var(--color-volume)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Specimen>

        <Specimen
          id="workload"
          title="Workload distribution"
          source="recharts ScatterChart"
          spec="§10"
          description="Distance against duration per route; bubble size is stop count. Spread shows imbalance."
        >
          <ChartCard>
            <ChartContainer config={workloadConfig} className="h-72 w-full">
              <ScatterChart margin={{ top: 12, right: 12 }}>
                <CartesianGrid />
                <XAxis type="number" dataKey="miles" name="Distance" unit=" mi" tickLine={false} axisLine={false} domain={[0, 12]} />
                <YAxis type="number" dataKey="minutes" name="Duration" tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `${Math.round(v / 60)}h`} />
                <ZAxis type="number" dataKey="stops" range={[120, 520]} name="Stops" />
                <ChartTooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload as (typeof workload)[number] | undefined
                    if (!d) return null
                    return (
                      <div className="bg-popover grid gap-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                        <div className="flex items-center gap-1.5 font-medium">
                          <RouteSwatch route={d.route} size="sm" /> Route {d.route}
                        </div>
                        <div className="text-muted-foreground font-mono tabular-nums">
                          {d.miles} mi · {d.minutes} min · {d.stops} stops
                        </div>
                      </div>
                    )
                  }}
                />
                <Scatter data={workload}>
                  {workload.map((d) => (
                    <Cell key={d.route} fill={routeColor(d.route)} fillOpacity={0.8} stroke={routeColor(d.route)} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ChartContainer>
          </ChartCard>
        </Specimen>

        <Specimen
          id="sweep"
          title="Seed sweep"
          source="recharts ComposedChart"
          spec="§10"
          description="Best, median, and range over seeds 0–4 for each search budget."
        >
          <ChartCard>
            <ChartContainer config={sweepConfig} className="h-72 w-full">
              <ComposedChart data={seedSweep.map((s) => ({ ...s, range: [s.best, s.worst] }))} margin={{ top: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="budget" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} width={44} domain={[300, 380]} tickFormatter={(v: number) => `$${v}`} />
                <ChartTooltip
                  content={({ payload }) => {
                    const d = payload?.[0]?.payload as (typeof seedSweep)[number] | undefined
                    if (!d) return null
                    return (
                      <div className="bg-popover grid gap-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                        <div className="font-medium">{d.budget} budget · 5 seeds</div>
                        <div className="text-muted-foreground font-mono tabular-nums">
                          best ${d.best} · median ${d.median} · worst ${d.worst}
                        </div>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="range" fill="var(--color-range)" fillOpacity={0.25} stroke="var(--color-range)" radius={6} barSize={44} />
                <Line dataKey="median" stroke="var(--color-median)" strokeWidth={2} dot={{ r: 4, fill: "var(--background)", strokeWidth: 2 }} />
                <ChartLegend content={<ChartLegendContent />} />
              </ComposedChart>
            </ChartContainer>
          </ChartCard>
        </Specimen>


        <Specimen
          id="radar"
          title="Run comparison radar"
          source="@bklit/radar-chart"
          spec="§10"
          description="Normalized 0–100, higher is better. Only for runs with compatible matrices and objectives."
          className="xl:col-span-2"
        >
          <ChartCard className="grid items-center gap-6 md:grid-cols-[1fr_18rem] md:pr-10">
            <div className="mx-auto h-[26rem] w-full max-w-lg">
              <RadarChart
                data={radarRuns.map((r, i) => ({ ...r, color: runColors[i] }))}
                metrics={radarMetrics}
                hoveredIndex={radarHover}
                onHoverChange={setRadarHover}
                margin={64}
                className="h-full"
              >
                <RadarGrid />
                <RadarAxis />
                <RadarLabels />
                {radarRuns.map((r, i) => (
                  <RadarArea key={r.label} index={i} />
                ))}
              </RadarChart>
            </div>
            <ul className="space-y-1">
              {radarRuns.map((r, i) => {
                const mean = Math.round(Object.values(r.values).reduce((a, b) => a + b, 0) / radarMetrics.length)
                return (
                  <li key={r.label}>
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
                      <span className="size-2.5 rounded-full" style={{ background: runColors[i] }} />
                      <span className="flex-1">{r.label}</span>
                      <span className="text-muted-foreground font-mono text-xs tabular-nums">{mean}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </ChartCard>
        </Specimen>

        <Specimen
          id="funnel"
          title="Fulfillment funnel"
          source="@bklit/funnel-chart"
          spec="§8"
          description="Ordered → allocated → routed → delivered in simulation, all products."
        >
          <ChartCard className="h-80">
            <FunnelChart data={fulfillmentFunnel} color="var(--route-1)" layers={3} className="h-full" grid />
          </ChartCard>
        </Specimen>

        <Specimen id="rings" title="Progress rings" source="@bklit/ring-chart" description="Headline ratios for a results header. Hover a ring.">
          <ChartCard className="flex h-80 items-center justify-center gap-8">
            <div className="relative">
              <RingChart
                data={fleetRings.map((r, i) => ({ ...r, color: ringColors[i] }))}
                size={220}
                strokeWidth={12}
                ringGap={6}
                baseInnerRadius={56}
                hoveredIndex={ringHover}
                onHoverChange={setRingHover}
              >
                {fleetRings.map((r, i) => (
                  <Ring key={r.label} index={i} />
                ))}
              </RingChart>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-semibold tracking-tight tabular-nums">{fleetRings[ringHover ?? 0].value}%</span>
                <span className="text-muted-foreground text-xs">{fleetRings[ringHover ?? 0].label}</span>
              </div>
            </div>
            <ul className="space-y-1">
              {fleetRings.map((r, i) => (
                <li
                  key={r.label}
                  onMouseEnter={() => setRingHover(i)}
                  onMouseLeave={() => setRingHover(null)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1 text-sm transition-opacity",
                    ringHover != null && ringHover !== i && "opacity-50"
                  )}
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
          id="fulfillment"
          title="Fulfillment by product"
          source="recharts BarChart"
          spec="§8"
          description="Ordered, allocated, and routed quantities reported separately per product."
          className="xl:col-span-2"
        >
          <ChartCard>
            <ChartContainer config={productConfig} className="h-72 w-full">
              <BarChart data={fulfillmentByProduct} barGap={2} margin={{ top: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="product" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} width={36} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="ordered" fill="var(--color-ordered)" fillOpacity={0.35} radius={[3, 3, 0, 0]} />
                <Bar dataKey="allocated" fill="var(--color-allocated)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="routed" fill="var(--color-routed)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </ChartCard>
        </Specimen>
      </div>
    </Group>
  )
}
