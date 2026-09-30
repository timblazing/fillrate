"use client"

import { Check, CircleDashed, Loader, TriangleAlert, Ban } from "lucide-react"

import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import type { StageId } from "@/lib/fulfillment"
import { cn } from "@/lib/utils"

import type { JobState } from "./job-status"
import { JobStatusDot } from "./job-status"
import { routeColor } from "./route-swatch"

export type PipelineStage = {
  id: StageId
  label: string
  state: JobState
  /** Wall time in seconds, once known. */
  seconds?: number
  /** One line describing the stored output, e.g. "1,915 of 2,829 lines filled". */
  summary?: string
  /** The business result the stage produced, shown first, e.g. { value: "158", label: "trucks" }. */
  output?: { value: string; label: string }
  /** Fan-out jobs, e.g. one PyVRP solve per cluster. */
  jobs?: { id: string; cluster: number; state: JobState; detail?: string }[]
}

const icon: Partial<Record<JobState, typeof Check>> = {
  succeeded: Check,
  running: Loader,
  claimed: Loader,
  failed: TriangleAlert,
  cancelled: Ban,
  interrupted: TriangleAlert,
}

function StageIcon({ state }: { state: JobState }) {
  const Icon = icon[state] ?? CircleDashed
  return (
    <span
      className={cn(
        "bg-background relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-300",
        state === "succeeded" && "bg-foreground text-background border-foreground",
        (state === "running" || state === "claimed") && "border-info text-info-foreground",
        state === "failed" && "border-destructive bg-destructive/10 text-destructive-foreground",
        (state === "queued" || state === "cancelled") && "text-muted-foreground border-dashed"
      )}
    >
      <Icon className={cn("size-3.5", (state === "running" || state === "claimed") && "animate-spin motion-reduce:animate-none")} />
    </span>
  )
}

function formatSeconds(s: number) {
  return s < 1 ? `${Math.round(s * 1000)} ms` : s < 90 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

// A pipeline run's stages (spec §8a): each stage's output is stored and inspectable, so each node links to it.
// Solve fans out into one durable job per cluster (spec §9).
export function PipelineStages({
  stages,
  onSelectStage,
  className,
}: {
  stages: PipelineStage[]
  onSelectStage?: (id: StageId) => void
  className?: string
}) {
  return (
    <ol className={cn("grid gap-y-4 md:grid-flow-col md:auto-cols-fr", className)}>
      {stages.map((stage, i) => {
        const done = stage.state === "succeeded"
        return (
          <li key={stage.id} className="relative flex gap-3 md:flex-col md:gap-2.5">
            {i < stages.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-7 left-3.5 h-[calc(100%-0.75rem)] w-px md:top-3.5 md:left-7 md:h-px md:w-[calc(100%-1.75rem)]",
                  done ? "bg-foreground" : "bg-border"
                )}
              />
            )}
            <StageIcon state={stage.state} />
            <button
              type="button"
              onClick={() => onSelectStage?.(stage.id)}
              disabled={!done}
              className="hover:bg-muted/50 -m-1 min-w-0 rounded-lg p-1 pr-3 text-left transition-colors disabled:hover:bg-transparent"
            >
              <div className="flex items-baseline gap-2 text-sm font-medium">
                {stage.label}
                {stage.seconds != null && done && (
                  <span className="text-muted-foreground font-mono text-[11px] font-normal tabular-nums">{formatSeconds(stage.seconds)}</span>
                )}
              </div>
              {stage.output && (
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-medium tracking-tight tabular-nums">{stage.output.value}</span>
                  <span className="text-muted-foreground text-xs">{stage.output.label}</span>
                </div>
              )}
              <div className="text-muted-foreground text-xs text-pretty">
                {stage.summary ?? (stage.state === "queued" ? "Waiting" : stage.state === "running" ? "Running…" : "")}
              </div>
              {stage.jobs && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {stage.jobs.map((job) => (
                    <Tooltip key={job.id}>
                      <TooltipTrigger
                        render={<span />}
                        className="bg-background flex h-5 items-center gap-1 rounded-md border px-1 font-mono text-[10px] tabular-nums"
                      >
                        <span className="size-1.5 rounded-full" style={{ background: routeColor(job.cluster) }} />C{job.cluster}
                        <JobStatusDot state={job.state} />
                      </TooltipTrigger>
                      <TooltipPopup>
                        {job.id} · <span className="capitalize">{job.state}</span>
                        {job.detail && ` · ${job.detail}`}
                      </TooltipPopup>
                    </Tooltip>
                  ))}
                </div>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
