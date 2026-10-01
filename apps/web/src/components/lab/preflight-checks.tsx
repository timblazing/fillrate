"use client"

import { CircleAlert, OctagonX, Undo2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { formatCount } from "@/lib/units"
import { cn } from "@/lib/utils"

export type PreflightResolution = "excluded" | "warning"

export type PreflightCheckItem = {
  id: string
  title: string
  /** "block" checks stop the run until resolved; "warn" checks only inform (ZIP-only placement, oversize splits). */
  action: "block" | "warn"
  detail?: string
  lines: number
  locations: number
  /** A few affected line or location IDs, for jumping to them. */
  refs?: string[]
  resolution?: PreflightResolution | null
}

/** True while any blocking check is unresolved; Run pipeline stays disabled. */
export const preflightBlocked = (items: PreflightCheckItem[]) => items.some((c) => c.action === "block" && !c.resolution)

// Blocking preflight checks (spec v1.9 §15 M2 item 8, round two). Two checks stop a run by default: addresses with
// no coordinates, and stops no chain of ≤ 500 mi drives reaches. A far stop reached through another stop and a stop
// larger than one trailer (split across shipments) only warn. They are policy, not physics. Each blocking one offers the
// three resolutions: fix the data (M3 editing), exclude the lines (recorded as `excluded_by_user`), or turn the
// check into a warning (recorded in the run's settings snapshot).
export function PreflightChecks({
  items,
  onResolve,
  onSelectRef,
  className,
}: {
  items: PreflightCheckItem[]
  onResolve?: (id: string, resolution: PreflightResolution | null) => void
  onSelectRef?: (id: string) => void
  className?: string
}) {
  return (
    <ul className={cn("divide-y overflow-hidden rounded-xl border", className)}>
      {items.map((c) => {
        const blocking = c.action === "block" && !c.resolution
        const Icon = blocking ? OctagonX : CircleAlert
        return (
          <li key={c.id} className={cn("bg-card flex gap-3 p-3", blocking && "bg-[color-mix(in_oklch,var(--destructive)_5%,var(--card))]")}>
            <Icon className={cn("mt-0.5 size-4 shrink-0", blocking ? "text-destructive-foreground" : "text-warning-foreground")} aria-hidden />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{c.title}</span>
                {blocking ? (
                  <Badge variant="error" size="sm">
                    Blocks run
                  </Badge>
                ) : c.resolution === "excluded" ? (
                  <Badge variant="outline" size="sm">
                    Lines excluded
                  </Badge>
                ) : (
                  <Badge variant="warning" size="sm">
                    Warning
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {formatCount(c.lines)} {c.lines === 1 ? "line" : "lines"} at {formatCount(c.locations)} {c.locations === 1 ? "location" : "locations"}
                {c.detail && <> · {c.detail}</>}
              </p>
              {c.refs && c.refs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {c.refs.map((ref) => (
                    <button
                      key={ref}
                      type="button"
                      onClick={() => onSelectRef?.(ref)}
                      className="bg-muted hover:bg-accent rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors"
                    >
                      {ref}
                    </button>
                  ))}
                </div>
              )}
              {c.action === "block" && onResolve && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {c.resolution ? (
                    <Button size="xs" variant="ghost" onClick={() => onResolve(c.id, null)}>
                      <Undo2 /> Undo
                    </Button>
                  ) : (
                    <>
                      <Tooltip>
                        <TooltipTrigger render={<span />}>
                          <Button size="xs" variant="outline" disabled>
                            Fix the data
                          </Button>
                        </TooltipTrigger>
                        <TooltipPopup>Editing orders and locations arrives with imports (M3)</TooltipPopup>
                      </Tooltip>
                      <Button size="xs" variant="outline" onClick={() => onResolve(c.id, "excluded")}>
                        Exclude these lines and run
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => onResolve(c.id, "warning")}>
                        Turn into a warning
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
