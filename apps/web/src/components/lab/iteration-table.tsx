"use client"

import { ArrowDown, ArrowUp, Star } from "lucide-react"
import { useMemo, useState } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { BEST_TRADEOFF, BEST_TRADEOFF_HINT } from "@/lib/copy"
import type { RunMetrics } from "@/lib/fulfillment"
import { formatCount, formatMiles, formatMoney } from "@/lib/units"
import { cn } from "@/lib/utils"

import { JobStatusDot, type JobState } from "./job-status"
import { FillPercent } from "./trailer-fill"

export type IterationRow = {
  id: string
  label: string
  state: JobState
  /** `assumption`: the change alters demand, stock or how miles are measured (a changed-assumption cohort, §10). */
  changed: { field: string; value: string; assumption?: boolean }[]
  metrics: RunMetrics
  nonDominated: boolean
}

type Col = {
  key: string
  label: string
  group: "fill" | "tight" | "rev" | null
  better?: "up" | "down"
  value: (m: RunMetrics) => number | undefined
  render: (m: RunMetrics) => React.ReactNode
}

// Revenue leads (design review round one); the table sorts by planned revenue by default.
const cols: Col[] = [
  { key: "k", label: "k", group: null, value: (m) => m.k, render: (m) => m.k },
  { key: "revenue", label: "Revenue", group: "rev", better: "up", value: (m) => m.revenueShipped, render: (m) => formatMoney(m.revenueShipped, { compact: true }) },
  { key: "trucks", label: "Shipments", group: "fill", better: "down", value: (m) => m.trucks, render: (m) => formatCount(m.trucks) },
  { key: "avgFill", label: "Avg fill", group: "fill", better: "up", value: (m) => m.avgFill, render: (m) => <FillPercent fill={m.avgFill} /> },
  { key: "minFill", label: "Min fill", group: "fill", better: "up", value: (m) => m.minFill, render: (m) => <FillPercent fill={m.minFill} /> },
  { key: "centroid", label: "To centroid", group: "tight", better: "down", value: (m) => m.meanToCentroid, render: (m) => `${m.meanToCentroid.toFixed(0)} mi` },
  { key: "widest", label: "Widest pair", group: "tight", better: "down", value: (m) => m.widestPair, render: (m) => formatMiles(m.widestPair) },
  { key: "stability", label: "Stability", group: "tight", better: "up", value: (m) => m.stability, render: (m) =>
      m.stability != null ? (
        m.stability.toFixed(2)
      ) : (
        <span className="text-muted-foreground" title="Not measured: k came from auto, not the k explorer's seed sweep">
          n/a
        </span>
      ),
  },
]

const groupLabel = { fill: "Trailer fill", tight: "Cluster tightness", rev: "Revenue" }

// Iteration comparison (spec §10): one row per run with the three metric groups and the varied settings.
// ★ marks the non-dominated runs. The best value per column is emphasized; nothing is combined into one score.
export function IterationTable({
  rows,
  baselineId,
  selected = [],
  onSelectedChange,
  className,
}: {
  rows: IterationRow[]
  baselineId?: string
  /** Up to two run IDs for side-by-side comparison. */
  selected?: string[]
  onSelectedChange?: (ids: string[]) => void
  className?: string
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>({ key: "revenue", dir: -1 })
  const best = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of cols) {
      if (!c.better) continue
      const vals = rows.map((r) => c.value(r.metrics)).filter((v): v is number => v != null)
      if (vals.length) out[c.key] = c.better === "up" ? Math.max(...vals) : Math.min(...vals)
    }
    return out
  }, [rows])
  const sorted = useMemo(() => {
    if (!sort) return rows
    const c = cols.find((x) => x.key === sort.key)!
    return [...rows].sort((a, b) => ((c.value(a.metrics) ?? -Infinity) - (c.value(b.metrics) ?? -Infinity)) * sort.dir)
  }, [rows, sort])

  const toggle = (id: string) => {
    if (!onSelectedChange) return
    onSelectedChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(-2))
  }

  return (
    <div className={cn("bg-card overflow-x-auto rounded-xl border", className)}>
      <table className="w-full min-w-[56rem] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th className="w-9 py-2 pl-3" />
            <th className="w-6" aria-label={BEST_TRADEOFF} />
            <th className="px-2 py-2 text-left font-medium">Run</th>
            {cols.map((c, i) => (
              <th key={c.key} title={c.group ? groupLabel[c.group] : undefined} className={cn("px-3 py-2 text-right font-medium whitespace-nowrap", i > 0 && cols[i - 1].group !== c.group && "border-l")}>
                <button
                  type="button"
                  className="hover:text-foreground inline-flex items-center gap-0.5"
                  onClick={() => setSort(sort?.key === c.key ? (sort.dir === -1 ? { key: c.key, dir: 1 } : null) : { key: c.key, dir: -1 })}
                >
                  {c.label}
                  {sort?.key === c.key && (sort.dir === -1 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const isSel = selected.includes(r.id)
            return (
              <tr
                key={r.id}
                onClick={() => toggle(r.id)}
                className={cn(
                  "hover:bg-muted/40 cursor-pointer border-b transition-colors last:border-0",
                  isSel && "bg-muted/60",
                  r.nonDominated && "bg-[color-mix(in_oklch,var(--success)_5%,transparent)]"
                )}
              >
                <td className="py-2 pl-3" onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={isSel} onCheckedChange={() => toggle(r.id)} aria-label={`Compare ${r.label}`} />
                </td>
                <td>
                  {r.nonDominated && (
                    <Tooltip>
                      <TooltipTrigger render={<span />} className="text-success-foreground inline-flex">
                        <Star className="size-3.5 fill-current" aria-label={BEST_TRADEOFF} />
                      </TooltipTrigger>
                      <TooltipPopup>{BEST_TRADEOFF_HINT}</TooltipPopup>
                    </Tooltip>
                  )}
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <JobStatusDot state={r.state} />
                    <span className="font-medium">{r.label}</span>
                    {r.id === baselineId && <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">baseline</span>}
                  </div>
                  <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1 pl-4.5 font-mono text-[10px]">
                    {r.id}
                    {r.changed.map((c) => (
                      <span
                        key={c.field}
                        title={c.assumption ? "Changed assumption: not directly comparable with the baseline" : undefined}
                        className={cn(
                          "rounded px-1 py-px",
                          c.assumption ? "border-warning/60 text-warning-foreground border border-dashed" : "bg-muted text-foreground"
                        )}
                      >
                        {c.field} {c.value}
                        {c.assumption && <span className="font-sans"> · changed assumption</span>}
                      </span>
                    ))}
                  </div>
                </td>
                {cols.map((c, i) => {
                  const v = c.value(r.metrics)
                  const isBest = c.better && v != null && v === best[c.key] && rows.length > 1
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        "px-3 py-2 text-right font-mono text-xs tabular-nums",
                        i > 0 && cols[i - 1].group !== c.group && "border-l",
                        isBest && "font-semibold underline decoration-2 underline-offset-4 decoration-success/60"
                      )}
                    >
                      {c.render(r.metrics)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
