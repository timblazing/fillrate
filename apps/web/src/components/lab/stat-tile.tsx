import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/utils"

// Headline result metric. `delta` compares against a baseline run; `goodWhen` sets which direction is green.
export function StatTile({
  label,
  value,
  unit,
  delta,
  goodWhen = "down",
  footnote,
  badge,
  trend,
  className,
}: {
  label: string
  value: string
  unit?: string
  delta?: number
  goodWhen?: "up" | "down"
  footnote?: string
  badge?: React.ReactNode
  trend?: number[]
  className?: string
}) {
  const good = delta != null && (goodWhen === "down" ? delta < 0 : delta > 0)
  return (
    <div className={cn("bg-card relative flex flex-col gap-2 overflow-hidden rounded-xl border p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">{label}</span>
        {badge}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
        {unit && <span className="text-muted-foreground text-sm">{unit}</span>}
        {delta != null && delta !== 0 && (
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
              good ? "text-success-foreground bg-success/10" : "text-destructive-foreground bg-destructive/10"
            )}
          >
            {delta < 0 ? <ArrowDownRight className="size-3" /> : <ArrowUpRight className="size-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      {trend && <Sparkline values={trend} />}
      {footnote && <span className="text-muted-foreground text-xs">{footnote}</span>}
    </div>
  )
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 26}`)
    .join(" ")
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("text-route-1 h-8 w-full", className)} aria-hidden>
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,30 ${points} 100,30`} fill="url(#spark-fill)" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
