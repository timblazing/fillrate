"use client"

import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { RouteSwatch, routeColor } from "./route-swatch"

// Times are minutes from local midnight (single-day time model, spec §5).
export type TimelineSegment = {
  kind: "drive" | "wait" | "service"
  start: number
  end: number
  stopId?: string
  window?: [number, number]
}

export type TimelineRoute = {
  route: number
  vehicle: string
  segments: TimelineSegment[]
}

export function formatClock(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

const kindLabel = { drive: "Drive", wait: "Wait", service: "Service" }

function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

/** Visits the solver left unassigned, shown as a pool row (OptimoRoute-style) so they are never invisible. */
export type UnassignedVisit = { stopId: string; window?: [number, number]; reason?: string }

// Gantt-style route timeline: drive, wait, and service per vehicle with time-window brackets.
// Selecting a stop here should select the same stable ID on the map and table (spec §4).
export function RouteTimeline({
  routes,
  from,
  to,
  selectedStop,
  onSelectStop,
  activeRoute,
  cursor,
  unassigned,
  className,
}: {
  routes: TimelineRoute[]
  unassigned?: UnassignedVisit[]
  from: number
  to: number
  selectedStop?: string | null
  onSelectStop?: (id: string) => void
  activeRoute?: number | null
  /** Playback cursor, minutes from midnight. A simulation, not live tracking. */
  cursor?: number
  className?: string
}) {
  const span = to - from
  const clamp = (t: number) => Math.min(to, Math.max(from, t))
  const pct = (t: number) => `${((clamp(t) - from) / span) * 100}%`
  const hours: number[] = []
  for (let t = Math.ceil(from / 60) * 60; t <= to; t += 60) hours.push(t)

  return (
    <div className={cn("text-xs", className)}>
      <div className="grid grid-cols-[9rem_1fr] gap-x-3">
        <div />
        <div className="relative h-5">
          {hours.map((t) => (
            <span
              key={t}
              className="text-muted-foreground absolute -translate-x-1/2 font-mono text-[10px] tabular-nums"
              style={{ left: pct(t) }}
            >
              {formatClock(t)}
            </span>
          ))}
        </div>

        {routes.map((r) => {
          const dimmed = activeRoute != null && activeRoute !== r.route
          const services = r.segments.filter((s) => s.kind === "service")
          const waited = r.segments.filter((s) => s.kind === "wait").reduce((sum, s) => sum + s.end - s.start, 0)
          return (
            <div key={r.route} className={cn("contents", dimmed && "[&>*]:opacity-40")}>
              <div className="flex items-center gap-2 py-2 transition-opacity">
                <RouteSwatch route={r.route} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.vehicle}</span>
                  <span className="text-muted-foreground block truncate text-[10px] tabular-nums">
                    {services.length} {services.length === 1 ? "stop" : "stops"} · {formatDuration(waited)} waiting
                  </span>
                </span>
              </div>
              <div className="relative h-14 overflow-hidden transition-opacity">
                {hours.map((t) => (
                  <span key={t} className="bg-border absolute inset-y-0 w-px" style={{ left: pct(t) }} />
                ))}
                {r.segments.map((s, i) => {
                  const left = pct(s.start)
                  const width = `${((s.end - s.start) / span) * 100}%`
                  const color = routeColor(r.route)
                  if (s.kind === "service" && s.stopId) {
                    const selected = selectedStop === s.stopId
                    const seq = services.indexOf(s) + 1
                    return (
                      <div key={i}>
                        {s.window && (
                          <span
                            className="absolute bottom-1 h-1.5 rounded-b-sm border-x border-b"
                            style={{
                              left: pct(s.window[0]),
                              width: `${((clamp(s.window[1]) - clamp(s.window[0])) / span) * 100}%`,
                              borderColor: color,
                            }}
                          />
                        )}
                        <Tooltip>
                          <TooltipTrigger
                            onClick={() => onSelectStop?.(s.stopId!)}
                            aria-pressed={selected}
                            aria-label={`${s.stopId}, service ${formatClock(s.start)}–${formatClock(s.end)}`}
                            className={cn(
                              "group/stop absolute top-5 h-5 min-w-1.5 rounded-[4px] shadow-sm transition-transform duration-150 hover:-translate-y-px focus-visible:outline-none",
                              selected && "ring-foreground ring-offset-background ring-2 ring-offset-1"
                            )}
                            style={{ left, width, background: color }}
                          >
                            <span
                              className={cn(
                                "text-muted-foreground group-hover/stop:text-foreground absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 font-mono text-[10px] whitespace-nowrap transition-colors",
                                selected && "text-foreground font-semibold"
                              )}
                            >
                              {s.stopId}
                            </span>
                            {s.end - s.start >= 10 && (
                              <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-semibold text-white tabular-nums">
                                {seq}
                              </span>
                            )}
                          </TooltipTrigger>
                          <TooltipPopup>
                            <div className="font-medium">
                              Stop {seq} · {s.stopId}
                            </div>
                            <div className="tabular-nums">
                              Service {formatClock(s.start)}–{formatClock(s.end)}
                              {s.window && ` · window ${formatClock(s.window[0])}–${formatClock(s.window[1])}`}
                            </div>
                          </TooltipPopup>
                        </Tooltip>
                      </div>
                    )
                  }
                  const long = s.kind === "wait" && s.end - s.start >= 30
                  return (
                    <span key={i} className="contents">
                    {long && (
                      <span
                        className="text-muted-foreground absolute top-[36px] -translate-x-1/2 text-[10px] whitespace-nowrap tabular-nums"
                        style={{ left: pct((s.start + s.end) / 2) }}
                      >
                        {formatDuration(s.end - s.start)} wait
                      </span>
                    )}
                    <span
                      title={`${kindLabel[s.kind]} ${formatClock(s.start)}–${formatClock(s.end)}`}
                      className="absolute top-[26px] h-2 rounded-[3px]"
                      style={{
                        left,
                        width,
                        background:
                          s.kind === "drive"
                            ? `color-mix(in oklch, ${color} 45%, transparent)`
                            : `repeating-linear-gradient(135deg, color-mix(in oklch, ${color} 30%, transparent) 0 3px, transparent 3px 6px)`,
                        boxShadow: s.kind === "wait" ? `inset 0 0 0 1px color-mix(in oklch, ${color} 35%, transparent)` : undefined,
                      }}
                    />
                    </span>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div />
        <div className="relative">
          {cursor != null && (
            <div
              className="bg-foreground pointer-events-none absolute w-px"
              style={{ left: pct(cursor), bottom: "100%", height: `${routes.length * 3.5}rem` }}
            >
              <span className="bg-foreground text-background absolute -top-5 -translate-x-1/2 rounded px-1 font-mono text-[10px] tabular-nums">
                {formatClock(cursor)}
              </span>
            </div>
          )}
        </div>
        {unassigned && unassigned.length > 0 && (
          <>
            <div className="flex items-center gap-2 border-t border-dashed py-2">
              <span className="border-muted-foreground/60 size-3 shrink-0 rounded-full border border-dashed" />
              <span className="min-w-0">
                <span className="text-warning-foreground block truncate font-medium">Unassigned ({unassigned.length})</span>
                <span className="text-muted-foreground block truncate text-[10px]">not on any route</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 border-t border-dashed py-2">
              {unassigned.map((u) => (
                <Tooltip key={u.stopId}>
                  <TooltipTrigger
                    onClick={() => onSelectStop?.(u.stopId)}
                    aria-pressed={selectedStop === u.stopId}
                    className={cn(
                      "bg-background hover:border-foreground/30 rounded-md border border-dashed px-1.5 py-0.5 font-mono text-[10px] transition-colors",
                      selectedStop === u.stopId && "ring-foreground ring-2"
                    )}
                  >
                    {u.stopId}
                    {u.window && (
                      <span className="text-muted-foreground ml-1 tabular-nums">
                        {formatClock(u.window[0])}–{formatClock(u.window[1])}
                      </span>
                    )}
                  </TooltipTrigger>
                  <TooltipPopup>{u.reason ?? "Not assigned to a route"}</TooltipPopup>
                </Tooltip>
              ))}
            </div>
          </>
        )}

      </div>

      <div className="text-muted-foreground mt-3 flex flex-wrap items-center gap-4 pl-[9.75rem]">
        <LegendKey label="Drive">
          <span className="bg-foreground/35 h-2 w-5 rounded-[2px]" />
        </LegendKey>
        <LegendKey label="Wait">
          <span className="h-2 w-5 rounded-[2px] bg-[repeating-linear-gradient(135deg,var(--muted-foreground)_0_2px,transparent_2px_4px)] opacity-60" />
        </LegendKey>
        <LegendKey label="Service">
          <span className="bg-foreground h-3 w-3 rounded-[3px]" />
        </LegendKey>
        <LegendKey label="Time window">
          <span className="border-foreground/60 h-1.5 w-5 rounded-b-sm border-x border-b" />
        </LegendKey>
      </div>
    </div>
  )
}

function LegendKey({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {children}
      {label}
    </span>
  )
}
