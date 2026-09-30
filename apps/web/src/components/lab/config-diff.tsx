"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

// Configuration diff between two runs (spec §10). Changed rows lead; unchanged rows stay one click away.
export type DiffRow = {
  /** Model field, e.g. "travel.max_leg_mi". */
  field: string
  /** Human label, e.g. "Max leg". Falls back to the field. */
  label?: string
  a: string
  b: string
  same?: boolean
  /** The setting changes an assumption (demand, stock, or how miles are measured), not just a solver knob. */
  assumption?: boolean
}

const grid = "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]"

export function ConfigDiff({
  rows,
  labels,
  showUnchanged: initialShowUnchanged = false,
  className,
}: {
  rows: DiffRow[]
  labels: [string, string]
  /** Start with unchanged rows visible. */
  showUnchanged?: boolean
  className?: string
}) {
  const [showUnchanged, setShowUnchanged] = useState(initialShowUnchanged)
  const changed = rows.filter((r) => !r.same)
  const unchanged = rows.filter((r) => r.same)
  const shown = showUnchanged ? [...changed, ...unchanged] : changed
  return (
    <div className={cn("overflow-hidden rounded-xl border text-xs", className)}>
      <div className={cn(grid, "bg-muted/60 text-muted-foreground border-b font-medium")}>
        <div className="px-3 py-2">
          Setting <span className="font-normal">· {changed.length} changed</span>
        </div>
        <div className="border-l px-3 py-2 font-mono">{labels[0]}</div>
        <div className="border-l px-3 py-2 font-mono">{labels[1]}</div>
      </div>
      {changed.length === 0 && <div className="text-muted-foreground border-b px-3 py-2">Same settings</div>}
      {shown.map((r) => (
        <div key={r.field} className={cn(grid, "border-b last:border-b-0", r.same && "text-muted-foreground")}>
          <div className="min-w-0 px-3 py-1.5" title={r.field}>
            <div className={cn("truncate", !r.same && "font-medium")}>{r.label ?? r.field}</div>
            {r.label && <div className="text-muted-foreground truncate font-mono text-[10px]">{r.field}</div>}
          </div>
          <div className={cn("border-l px-3 py-1.5 font-mono", !r.same && "bg-destructive/8 text-destructive-foreground")}>
            {!r.same && <span className="mr-1.5 select-none">−</span>}
            {r.a}
          </div>
          <div className={cn("border-l px-3 py-1.5 font-mono", !r.same && "bg-success/10 text-success-foreground")}>
            {!r.same && <span className="mr-1.5 select-none">+</span>}
            {r.b}
          </div>
        </div>
      ))}
      {unchanged.length > 0 && (
        <button
          type="button"
          onClick={() => setShowUnchanged(!showUnchanged)}
          className="text-muted-foreground hover:text-foreground hover:bg-muted/40 w-full border-t px-3 py-1.5 text-left transition-colors"
        >
          {showUnchanged ? "Hide unchanged" : `Show ${unchanged.length} unchanged`}
        </button>
      )}
    </div>
  )
}
