"use client"

import { GitFork } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import type { Cluster, Truck } from "@/lib/fulfillment"
import { FILL_LOW, fillBand, formatCount, formatFeet, formatMiles, formatMoney, plural, cssPercent } from "@/lib/units"
import { cn } from "@/lib/utils"

import { ClusterSwatch, routeColor } from "./route-swatch"
import { FillPercent } from "./trailer-fill"

/** A measured value against a hard limit, e.g. widest pair distance against the 500 mi diameter. */
export function LimitBar({
  value,
  limit,
  label,
  format = formatMiles,
  className,
}: {
  value: number
  limit: number
  label: string
  format?: (v: number) => string
  className?: string
}) {
  const ratio = value / limit
  const over = ratio > 1
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">
          <span className={cn("font-medium", over ? "text-destructive-foreground" : ratio > 0.9 ? "text-warning-foreground" : "text-foreground")}>
            {format(value)}
          </span>
          <span className="text-muted-foreground"> / {format(limit)}</span>
        </span>
      </div>
      <div className="bg-muted relative h-1.5 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full", over ? "bg-destructive" : ratio > 0.9 ? "bg-warning" : "bg-foreground/60")}
          style={{ width: cssPercent(Math.min(1, ratio)) }}
        />
      </div>
    </div>
  )
}

/** One column per truck, sorted fullest first; height is fill. Low-fill trucks stand out at the right. */
export function TruckFillStrip({ trucks, cluster, className }: { trucks: Truck[]; cluster: number; className?: string }) {
  const sorted = [...trucks].sort((a, b) => b.fill - a.fill)
  return (
    <div className={cn("relative flex h-9 items-end gap-px", className)} role="img" aria-label={`Fill of ${plural(trucks.length, "truck")}`}>
      <span
        aria-hidden
        className="border-foreground/35 pointer-events-none absolute inset-x-0 z-10 border-t border-dashed"
        style={{ bottom: cssPercent(FILL_LOW) }}
      />
      {sorted.map((t) => (
        <Tooltip key={t.id}>
          <TooltipTrigger
            render={<span />}
            className="bg-muted relative flex h-full min-w-[3px] flex-1 items-end overflow-hidden rounded-[2px]"
          >
            <span
              className="w-full rounded-[2px]"
              style={{
                height: cssPercent(t.fill),
                background: fillBand(t.fill) === "low" ? "var(--warning)" : routeColor(cluster),
              }}
            />
          </TooltipTrigger>
          <TooltipPopup>
            <span className="font-mono">{t.id}</span> · {Math.round(t.fill * 100)}% · {plural(t.stops.length, "stop")}
          </TooltipPopup>
        </Tooltip>
      ))}
    </div>
  )
}

// Cluster card (spec §10): stops, trucks, loaded linear feet, average and minimum fill, widest pair, revenue.
export function ClusterCard({
  cluster,
  trucks,
  area,
  maxDiameter,
  selected,
  onSelect,
  className,
}: {
  cluster: Cluster
  trucks: Truck[]
  /** A human hint for where the cluster is, e.g. "Nashville, TN + 14 cities". */
  area: string
  maxDiameter: number
  selected?: boolean
  onSelect?: () => void
  className?: string
}) {
  const low = trucks.filter((t) => fillBand(t.fill) === "low").length
  const stats: [string, React.ReactNode][] = [
    ["Stops", formatCount(cluster.stops.length)],
    ["Trucks", formatCount(cluster.trucks.length)],
    ["Loaded", formatFeet(cluster.load, 0)],
    ["Avg fill", <FillPercent key="a" fill={cluster.avgFill} />],
    ["Min fill", <FillPercent key="m" fill={cluster.minFill} />],
    ["Revenue", formatMoney(cluster.value, { compact: true })],
  ]
  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? selected : undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (onSelect && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "bg-card relative space-y-3 overflow-hidden rounded-xl border p-3.5 text-left transition-[background-color,border-color] duration-150",
        onSelect && "hover:border-foreground/20 focus-visible:ring-ring/50 cursor-pointer focus-visible:ring-2 focus-visible:outline-none",
        className
      )}
      style={
        selected
          ? {
              borderColor: routeColor(cluster.id),
              backgroundColor: `color-mix(in oklab, ${routeColor(cluster.id)} 8%, var(--card))`,
            }
          : undefined
      }
    >
      <div className="flex items-start gap-2.5">
        <ClusterSwatch cluster={cluster.id} />
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-5 font-medium">Cluster {cluster.id}</div>
          <div className="text-muted-foreground truncate text-xs">{area}</div>
        </div>
        {cluster.repairedFrom != null && (
          <Tooltip>
            <TooltipTrigger render={<Badge variant="outline" size="sm" />}>
              <GitFork /> split
            </TooltipTrigger>
            <TooltipPopup>Bisected from k-means cluster {cluster.repairedFrom} to meet the diameter limit</TooltipPopup>
          </Tooltip>
        )}
      </div>
      <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
        {stats.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground text-[11px]">{label}</dt>
            <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1">
        <TruckFillStrip trucks={trucks} cluster={cluster.id} />
        <div className="text-muted-foreground flex justify-between text-[11px] tabular-nums">
          <span>{plural(trucks.length, "truck")}, fullest first</span>
          <span className={cn(low > 0 && "text-warning-foreground")}>
            {low > 0 ? `${low} under ${Math.round(FILL_LOW * 100)}%` : `none under ${Math.round(FILL_LOW * 100)}%`}
          </span>
        </div>
      </div>
      <LimitBar label="Widest pair" value={cluster.widestPair} limit={maxDiameter} />
    </div>
  )
}
