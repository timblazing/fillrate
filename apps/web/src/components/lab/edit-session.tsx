"use client"

import { ArrowRight, CircleCheck, PencilLine, RotateCcw, TriangleAlert } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatMiles } from "@/lib/units"
import { cn } from "@/lib/utils"

import { TruckTag } from "./route-swatch"
import { FillPercent } from "./trailer-fill"

export type EditChange = { id: string; text: React.ReactNode }

export type EditEvaluation = {
  /** Concrete violated bounds (leg, capacity, diameter). Empty means the edited plan passes validation. */
  violations: string[]
  trucks: { before: number; after: number }
  loadedMiles: { before: number; after: number }
  /** Fill of every truck the edit touched. `after: null` means the truck is now empty and dropped. */
  affected: { id: string; cluster: number; before: number; after: number | null }[]
}

type Phase = "editing" | "evaluated" | "saved" | "discarded"

// Manual edits as a working copy (spec §10 manual baselines; OptimoRoute/Wise pattern): changes collect on a copy
// of the run, are evaluated with the same matrices and validator, and only then saved as a manual baseline.
// The source run is never mutated.
export function EditSession({
  runId,
  changes,
  evaluation,
  className,
}: {
  runId: string
  changes: EditChange[]
  evaluation: EditEvaluation
  className?: string
}) {
  const [phase, setPhase] = useState<Phase>("editing")
  const ok = evaluation.violations.length === 0

  if (phase === "discarded") {
    return (
      <div className={cn("bg-card flex items-center gap-3 rounded-xl border p-3 text-sm", className)}>
        <span className="text-muted-foreground">Changes discarded. {runId} is unchanged.</span>
        <Button size="xs" variant="outline" className="ml-auto" onClick={() => setPhase("editing")}>
          <PencilLine /> Edit plan
        </Button>
      </div>
    )
  }

  return (
    <div className={cn("bg-card overflow-hidden rounded-xl border", className)}>
      <div className="bg-info/6 flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <PencilLine className="text-info-foreground size-4" />
        <span className="text-sm font-medium">
          {phase === "saved" ? "Saved as manual baseline" : "Editing a copy of"} <span className="font-mono">{runId}</span>
        </span>
        <Badge variant="outline" size="sm">
          {changes.length} {changes.length === 1 ? "change" : "changes"}
        </Badge>
        <span className="text-muted-foreground text-xs">{phase === "saved" ? "run-0212-m1 · original kept" : "not saved · the original run is untouched"}</span>
        {phase !== "saved" && (
          <div className="ml-auto flex gap-2">
            <Button size="xs" variant="ghost" onClick={() => setPhase("discarded")}>
              <RotateCcw /> Discard
            </Button>
            <Button size="xs" variant={phase === "editing" ? "default" : "outline"} onClick={() => setPhase("evaluated")}>
              {phase === "editing" ? "Evaluate changes" : "Re-evaluate"}
            </Button>
          </div>
        )}
      </div>

      <ol className="divide-y text-xs">
        {changes.map((c, i) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2">
            <span className="text-muted-foreground w-4 font-mono tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">{c.text}</span>
          </li>
        ))}
      </ol>

      {phase === "editing" ? (
        <p className="text-muted-foreground border-t px-3 py-2.5 text-xs">
          Evaluate re-runs the validator on the copy with the same matrix and limits before anything is compared or saved.
        </p>
      ) : (
        <div className="space-y-3 border-t p-3">
          <div className={cn("flex items-center gap-2 text-sm font-medium", ok ? "text-success-foreground" : "text-destructive-foreground")}>
            {ok ? <CircleCheck className="size-4" /> : <TriangleAlert className="size-4" />}
            {ok ? "0 violations · passes leg, capacity, and diameter checks" : `${evaluation.violations.length} violations`}
          </div>
          {!ok && (
            <ul className="text-destructive-foreground list-disc pl-5 text-xs">
              {evaluation.violations.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          )}
          <dl className="grid gap-3 text-xs sm:grid-cols-2">
            <Change label="Trucks" before={String(evaluation.trucks.before)} after={String(evaluation.trucks.after)} delta={evaluation.trucks.after - evaluation.trucks.before} goodWhen="down" />
            <Change
              label="Loaded miles"
              before={formatMiles(evaluation.loadedMiles.before)}
              after={formatMiles(evaluation.loadedMiles.after)}
              delta={Math.round(evaluation.loadedMiles.after - evaluation.loadedMiles.before)}
              goodWhen="down"
              unit=" mi"
            />
          </dl>
          <ul className="space-y-1.5 text-xs">
            {evaluation.affected.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <TruckTag id={t.id} cluster={t.cluster} />
                <FillPercent fill={t.before} />
                <ArrowRight className="text-muted-foreground size-3" />
                {t.after == null ? <span className="text-muted-foreground">empty · dropped</span> : <FillPercent fill={t.after} />}
              </li>
            ))}
          </ul>
          {phase === "evaluated" && (
            <div className="flex justify-end">
              <Button size="xs" disabled={!ok} onClick={() => setPhase("saved")}>
                Save as manual baseline
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Change({
  label,
  before,
  after,
  delta,
  goodWhen,
  unit = "",
}: {
  label: string
  before: string
  after: string
  delta: number
  goodWhen: "up" | "down"
  unit?: string
}) {
  const good = goodWhen === "up" ? delta > 0 : delta < 0
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-2 font-mono tabular-nums">
        <span className="text-muted-foreground">{before}</span>
        <ArrowRight className="text-muted-foreground size-3 self-center" />
        <span className="font-medium">{after}</span>
        {delta !== 0 && (
          <span className={cn("ml-auto font-sans font-medium", good ? "text-success-foreground" : "text-destructive-foreground")}>
            {delta > 0 ? "+" : "−"}
            {Math.abs(delta).toLocaleString("en-US")}
            {unit}
          </span>
        )}
      </dd>
    </div>
  )
}
