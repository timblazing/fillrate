"use client"

import { ChevronLeft, ChevronRight, Info, Warehouse } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cursorAt, formatClock, formatDriveTime, type Timeline, type TimingSource } from "@/lib/timeline"
import { formatFeet, formatMiles } from "@/lib/units"
import { cn } from "@/lib/utils"

const METERS_PER_MILE = 1609.344

// Per-truck planned-route timeline (spec §13, M7): depot departure at 0:00, then arrival, service and the load on
// board before and after each stop, driven by a keyboard-accessible cursor. Planned durations only: service time is
// not modeled, there is no waiting, and the open route has no planned return. Not traffic or GPS.
export function TruckRouteTimeline({
  timeline,
  source,
  cursor,
  onCursorChange,
  depotLabel,
  className,
}: {
  timeline: Timeline
  source: TimingSource
  cursor: number
  onCursorChange: (seconds: number) => void
  depotLabel: string
  className?: string
}) {
  const { stops, timed, totalS } = timeline
  const state = cursorAt(timeline, cursor)
  const stepS = Math.max(1, Math.round((totalS ?? 0) / 300))
  const currentIndex = state ? (state.phase === "drive" ? (state.stopIndex ?? 0) - 1 : (state.stopIndex ?? -1)) : -2
  // Cursor stops: departure plus every arrival, de-duplicated so Previous/Next always moves.
  const marks = timed ? [0, ...stops.map((s) => s.arrivalS as number)] : []
  const previous = [...marks].reverse().find((m) => m < cursor)
  const next = marks.find((m) => m > cursor)

  const status = !state
    ? null
    : state.phase === "depot"
      ? `At ${depotLabel}, departing with ${formatFeet(state.load)} on board`
      : state.phase === "service"
        ? `At stop ${(state.stopIndex ?? 0) + 1}, ${stops[state.stopIndex ?? 0].label}: service time not modeled (0 s), ${formatFeet(state.load)} on board after delivery`
        : `Driving to stop ${(state.stopIndex ?? 0) + 1}, ${stops[state.stopIndex ?? 0].label}, ${Math.round(state.fraction * 100)}% of the leg, ${formatFeet(state.load)} on board`

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <div className="flex gap-1.5">
          <dt className="font-medium">Timing</dt>
          <dd>{timed ? source.timing : "unavailable"}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="font-medium">Path</dt>
          <dd>{source.geometry}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="font-medium">Service</dt>
          <dd>service time not modeled (0 s), no waiting</dd>
        </div>
      </dl>

      {!timed && (
        <Alert variant="warning">
          <Info aria-hidden />
          <AlertTitle>Drive times are unavailable for this shipment</AlertTitle>
          <AlertDescription>
            This result was saved before leg durations were recorded, so no arrival times or cursor are shown. Loads before and after each stop are still
            exact. Start a new run to get timing.
          </AlertDescription>
        </Alert>
      )}

      {timed && (
        <div className="bg-card flex flex-col gap-2 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-mono font-medium tabular-nums" aria-hidden>
              {formatClock(cursor)} <span className="text-muted-foreground font-sans text-xs">of {formatClock(totalS ?? 0)}</span>
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon-sm" aria-label="Previous stop" disabled={previous == null} onClick={() => previous != null && onCursorChange(previous)}>
                <ChevronLeft aria-hidden />
              </Button>
              <Button variant="outline" size="icon-sm" aria-label="Next stop" disabled={next == null} onClick={() => next != null && onCursorChange(next)}>
                <ChevronRight aria-hidden />
              </Button>
            </div>
          </div>
          <Slider
            aria-label="Route cursor"
            min={0}
            max={Math.max(totalS ?? 0, 1)}
            step={stepS}
            largeStep={stepS * 10}
            value={cursor}
            onValueChange={(v) => onCursorChange(Array.isArray(v) ? v[0] : v)}
            disabled={(totalS ?? 0) === 0}
          />
          <p className="text-muted-foreground text-xs" role="status" aria-live="polite">
            {status}
          </p>
          <p className="text-muted-foreground text-[11px]">Arrow keys move the cursor, Page Up/Down moves faster, Home and End jump to departure and the last stop.</p>
        </div>
      )}

      <ol className="flex flex-col gap-1.5" aria-label="Planned route timeline">
        <li className={cn("bg-card flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", timed && currentIndex === -1 && "border-primary ring-primary/20 ring-2")}>
          <Warehouse className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">Depart {depotLabel}</span>
          <span className="text-muted-foreground text-xs tabular-nums">{timed ? "0:00" : "—"} · {formatFeet(timeline.departLoad)} on board</span>
        </li>
        {stops.map((s, i) => {
          const active = timed && currentIndex === i
          const body = (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-muted-foreground w-5 shrink-0 text-xs tabular-nums">{s.sequence}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label}</span>
                <span className="font-mono text-xs tabular-nums">{s.arrivalS == null ? "time n/a" : formatClock(s.arrivalS)}</span>
              </div>
              <dl className="text-muted-foreground mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 pl-7 text-xs">
                <dt>Drive</dt>
                <dd className="tabular-nums">
                  {s.legS == null ? "time unavailable" : formatDriveTime(s.legS)} · {formatMiles(s.legM / METERS_PER_MILE)} {s.sequence === 1 ? "from depot" : "leg"}
                </dd>
                <dt>Service</dt>
                <dd>not modeled (0 s)</dd>
                <dt>Load</dt>
                <dd className="tabular-nums">
                  {formatFeet(s.loadBefore)} → {formatFeet(s.loadAfter)} ({formatFeet(s.delivered)} delivered)
                </dd>
              </dl>
            </>
          )
          const rowClass = cn("bg-card block w-full rounded-lg border px-3 py-2 text-left", active && "border-primary ring-primary/20 ring-2")
          return (
            <li key={s.visitId}>
              {timed ? (
                <button type="button" className={cn(rowClass, "hover:bg-accent/40 focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]")} onClick={() => onCursorChange(s.arrivalS as number)} aria-current={active ? "step" : undefined}>
                  {body}
                </button>
              ) : (
                <div className={rowClass}>{body}</div>
              )}
            </li>
          )
        })}
        <li className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
          <Warehouse className="size-4 shrink-0" aria-hidden />
          <span>Return to {depotLabel}: not planned. Open route; the solver adds no return leg, so none is timed.</span>
        </li>
      </ol>
    </div>
  )
}
