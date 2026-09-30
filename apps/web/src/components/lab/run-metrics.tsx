import { ArrowDownRight, ArrowUpRight, Container, Crosshair, DollarSign } from "lucide-react"

import type { RunMetrics } from "@/lib/fulfillment"
import { formatCount, formatMiles, formatMoney, formatPercent, cssPercent } from "@/lib/units"
import { cn } from "@/lib/utils"

import { FillPercent } from "./trailer-fill"

/** Change against a base value, colored by whether it moved in the good direction. */
export function MetricDelta({ value, base, goodWhen, format }: { value: number; base?: number; goodWhen: "up" | "down"; format: (d: number) => string }) {
  if (base == null) return null
  const d = value - base
  if (Math.abs(d) < 1e-9) return <span className="text-muted-foreground text-[11px]">same</span>
  const good = goodWhen === "up" ? d > 0 : d < 0
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded px-1 text-[11px] font-medium tabular-nums",
        good ? "bg-success/10 text-success-foreground" : "bg-destructive/10 text-destructive-foreground"
      )}
    >
      {d < 0 ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}
      {format(Math.abs(d))}
    </span>
  )
}

function Row({ label, children, delta }: { label: string; children: React.ReactNode; delta?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-muted-foreground flex-1">{label}</span>
      {delta}
      <span className="font-mono font-medium tabular-nums">{children}</span>
    </div>
  )
}

function Group({ icon: Icon, title, hint, children }: { icon: typeof Container; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="bg-card space-y-3 rounded-xl border p-4">
      <header className="flex items-center gap-2">
        <span className="bg-muted flex size-6 items-center justify-center rounded-md">
          <Icon className="size-3.5" />
        </span>
        <h4 className="text-sm font-medium">{title}</h4>
        <span className="text-muted-foreground ml-auto text-[11px]">{hint}</span>
      </header>
      {children}
    </section>
  )
}

const pts = (d: number) => `${(d * 100).toFixed(1)} pts`
const mi = (d: number) => `${d.toFixed(1)} mi`

// The three metric groups from spec §8a, side by side. There is deliberately no composite score.
export function RunMetricGroups({
  metrics,
  baseline,
  maxDiameter,
  className,
}: {
  metrics: RunMetrics
  /** When set, each metric shows its change against this run. */
  baseline?: RunMetrics
  maxDiameter: number
  className?: string
}) {
  const m = metrics
  const b = baseline
  const shippedOfOrdered = m.revenueShipped / m.revenueOrdered
  const allocatedOfOrdered = m.revenueAllocated / m.revenueOrdered
  return (
    <div className={cn("grid gap-3 lg:grid-cols-3", className)}>
      <Group icon={Container} title="Truck fill" hint="higher is better">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight">
            <FillPercent fill={m.avgFill} />
          </span>
          <span className="text-muted-foreground text-xs">average fill</span>
          <span className="ml-auto">
            <MetricDelta value={m.avgFill} base={b?.avgFill} goodWhen="up" format={pts} />
          </span>
        </div>
        <div className="space-y-1.5">
          <Row label="Minimum fill" delta={<MetricDelta value={m.minFill} base={b?.minFill} goodWhen="up" format={pts} />}>
            <FillPercent fill={m.minFill} />
          </Row>
          <Row label="Trucks used" delta={<MetricDelta value={m.trucks} base={b?.trucks} goodWhen="down" format={(d) => String(d)} />}>
            {formatCount(m.trucks)}
          </Row>
        </div>
      </Group>

      <Group icon={Crosshair} title="Cluster tightness" hint="lower is better">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{Math.round(m.meanToCentroid)}</span>
          <span className="text-muted-foreground text-xs">mi mean to centroid</span>
          <span className="ml-auto">
            <MetricDelta value={m.meanToCentroid} base={b?.meanToCentroid} goodWhen="down" format={mi} />
          </span>
        </div>
        <div className="space-y-1.5">
          <Row label={`Widest pair (limit ${maxDiameter})`} delta={<MetricDelta value={m.widestPair} base={b?.widestPair} goodWhen="down" format={mi} />}>
            {formatMiles(m.widestPair)}
          </Row>
          <Row label="Loaded miles" delta={<MetricDelta value={m.loadedMiles} base={b?.loadedMiles} goodWhen="down" format={(d) => formatMiles(d)} />}>
            {formatMiles(m.loadedMiles)}
          </Row>
          <Row label={`Stability at k = ${m.k}`}>{m.stability != null ? m.stability.toFixed(2) : <span className="text-muted-foreground font-sans font-normal">auto k · not explored</span>}</Row>
        </div>
      </Group>

      <Group icon={DollarSign} title="Revenue" hint="allocated amount shipped">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{formatMoney(m.revenueShipped, { compact: true })}</span>
          <span className="text-muted-foreground text-xs">shipped</span>
          <span className="ml-auto">
            <MetricDelta value={m.revenueShipped} base={b?.revenueShipped} goodWhen="up" format={(d) => formatMoney(d, { compact: true })} />
          </span>
        </div>
        <div className="bg-muted flex h-2 overflow-hidden rounded-full" role="img" aria-label="Shipped, allocated, and ordered amounts">
          <span className="bg-foreground" style={{ width: cssPercent(shippedOfOrdered) }} />
          <span className="bg-foreground/35" style={{ width: cssPercent(allocatedOfOrdered - shippedOfOrdered) }} />
        </div>
        <div className="space-y-1.5">
          <Row label="Allocated">
            {formatMoney(m.revenueAllocated, { compact: true })} <span className="text-muted-foreground font-normal">· {formatPercent(m.revenueShipped / m.revenueAllocated)} shipped</span>
          </Row>
          <Row label="Ordered">
            {formatMoney(m.revenueOrdered, { compact: true })} <span className="text-muted-foreground font-normal">· {formatPercent(shippedOfOrdered)} shipped</span>
          </Row>
        </div>
      </Group>
    </div>
  )
}
