"use client"

import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { FILL_FULL, FILL_LOW, TRAILER_CAPACITY, fillBand, formatFeet, formatPercent, cssPercent } from "@/lib/units"
import { cn } from "@/lib/utils"

import { routeColor } from "./route-swatch"

const bandText = {
  low: "text-warning-foreground",
  fair: "text-foreground",
  full: "text-success-foreground",
}

/** Fill % colored by band: under FILL_LOW (80%) is flagged, FILL_FULL (90%) and up reads as full. */
export function FillPercent({ fill, className }: { fill: number; className?: string }) {
  return <span className={cn("font-medium tabular-nums", bandText[fillBand(fill)], className)}>{formatPercent(fill)}</span>
}

const bandColor = { low: "var(--warning)", fair: "var(--muted-foreground)", full: "var(--success)" }

/** Key for the fill bands, shown next to any fill visual so the colors explain themselves. */
export function FillBandLegend({ className }: { className?: string }) {
  const items = [
    ["low", `under ${formatPercent(FILL_LOW)}`],
    ["fair", `${formatPercent(FILL_LOW)}–${formatPercent(FILL_FULL)}`],
    ["full", `${formatPercent(FILL_FULL)}+ full`],
  ] as const
  return (
    <span className={cn("text-muted-foreground inline-flex items-center gap-3 text-[11px]", className)}>
      {items.map(([band, label]) => (
        <span key={band} className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-full" style={{ background: bandColor[band] }} aria-hidden />
          {label}
        </span>
      ))}
    </span>
  )
}

/** Compact fill bar for tables and cards. */
export function FillMeter({ fill, cluster, className }: { fill: number; cluster?: number; className?: string }) {
  const band = fillBand(fill)
  const color = cluster ? routeColor(cluster) : bandColor[band]
  return (
    <span className={cn("inline-flex min-w-24 items-center gap-2", className)}>
      <span
        className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full"
        role="meter"
        aria-valuenow={Math.round(fill * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Trailer fill"
      >
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: cssPercent(Math.min(1, fill)), background: color }} />
      </span>
      <FillPercent fill={fill} className="w-9 text-right text-xs" />
    </span>
  )
}

/**
 * The primary per-shipment visual (design review: "a plain fill % would do"): a large fill % over a thin meter.
 * The segmented `TrailerFill` belongs in the shipment detail and the shipment sheet, not in lists or cards.
 */
export function ShipmentFill({ fill, size = "md", className }: { fill: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const band = fillBand(fill)
  return (
    <span className={cn("inline-flex min-w-16 flex-col gap-1", className)}>
      <FillPercent
        fill={fill}
        className={cn("leading-none tracking-tight", size === "lg" ? "text-3xl font-semibold" : size === "md" ? "text-xl" : "text-base")}
      />
      <span
        className="bg-muted relative h-1 w-full overflow-hidden rounded-full"
        role="meter"
        aria-valuenow={Math.round(fill * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Trailer fill"
      >
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: cssPercent(Math.min(1, fill)), background: bandColor[band] }} />
      </span>
    </span>
  )
}

export type TrailerSegment = { id: string; load: number; label?: string }

// A 53 ft trailer drawn to scale: one segment per stop in visit order, ticks every 10 ft, empty floor hatched.
// Linear feet are the only capacity dimension in the primary workflow (spec §1).
export function TrailerFill({
  segments,
  cluster,
  capacity = TRAILER_CAPACITY,
  selected,
  onSelect,
  size = "md",
  className,
}: {
  segments: TrailerSegment[]
  cluster: number
  capacity?: number
  selected?: string | null
  onSelect?: (id: string) => void
  size?: "sm" | "md"
  className?: string
}) {
  const used = segments.reduce((s, x) => s + x.load, 0)
  const empty = Math.max(0, capacity - used)
  const ticks = Array.from({ length: Math.floor(capacity / 1000) }, (_, i) => (i + 1) * 1000)
  return (
    <div className={cn("space-y-1", className)}>
      <div
        className={cn(
          "bg-muted/60 relative flex overflow-hidden rounded-md border",
          size === "sm" ? "h-3" : "h-7",
          "bg-[repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_oklch,var(--border)_80%,transparent)_4px_5px)]"
        )}
      >
        {segments.map((s, i) => (
          <Tooltip key={s.id}>
            <TooltipTrigger
              render={<button type="button" />}
              onClick={() => onSelect?.(s.id)}
              aria-label={`${s.label ?? s.id}: ${formatFeet(s.load)}`}
              className={cn(
                "relative h-full border-r border-white/60 transition-[filter,opacity] duration-150 last:border-r-0 hover:brightness-110 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white dark:border-black/40",
                selected && selected !== s.id && "opacity-45"
              )}
              style={{
                width: cssPercent(s.load / capacity),
                background: `color-mix(in oklch, ${routeColor(cluster)} ${i % 2 ? 78 : 100}%, var(--background))`,
              }}
            >
              {size === "md" && s.load / capacity > 0.07 && (
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-medium text-white tabular-nums">
                  {i + 1}
                </span>
              )}
            </TooltipTrigger>
            <TooltipPopup>
              <span className="font-medium">Stop {i + 1}</span> · {s.label ?? s.id} · {formatFeet(s.load)}
            </TooltipPopup>
          </Tooltip>
        ))}
        {size === "md" && empty / capacity >= 0.15 && (
          <span
            className="text-muted-foreground pointer-events-none absolute inset-y-0 right-0 flex items-center justify-center font-mono text-[10px] tabular-nums"
            style={{ width: cssPercent(empty / capacity) }}
          >
            <span className="bg-background/80 rounded px-1">{formatFeet(empty)} empty</span>
          </span>
        )}
        {size === "md" &&
          ticks.map((t) => (
            <span key={t} className="bg-foreground/15 pointer-events-none absolute inset-y-0 w-px" style={{ left: cssPercent(t / capacity) }} />
          ))}
      </div>
      {size === "md" && (
        <div className="text-muted-foreground flex justify-between font-mono text-[10px] tabular-nums">
          <span>0 ft</span>
          <span>
            {formatFeet(used)} of {formatFeet(capacity, 0)} · <FillPercent fill={used / capacity} />
          </span>
        </div>
      )}
    </div>
  )
}
