import { Ban, Check, CircleDashed, Loader, TriangleAlert, Unplug } from "lucide-react"

import { cn } from "@/lib/utils"

// Run states. "interrupted" only appears on runs made before direct solves.
export type JobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"

const states: Record<JobState, { label: string; icon: typeof Check; className: string }> = {
  queued: { label: "Queued", icon: CircleDashed, className: "text-muted-foreground bg-muted" },
  running: { label: "Running", icon: Loader, className: "text-info-foreground bg-info/12" },
  succeeded: { label: "Succeeded", icon: Check, className: "text-success-foreground bg-success/10" },
  failed: { label: "Failed", icon: TriangleAlert, className: "text-destructive-foreground bg-destructive/10" },
  cancelled: { label: "Cancelled", icon: Ban, className: "text-muted-foreground bg-muted" },
  interrupted: { label: "Interrupted", icon: Unplug, className: "text-warning-foreground bg-warning/10" },
}

export const jobStates = Object.keys(states) as JobState[]

export function JobStatusBadge({ state, className }: { state: JobState; className?: string }) {
  const { label, icon: Icon, className: tone } = states[state]
  return (
    <span
      data-state={state}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        tone,
        className
      )}
    >
      <Icon className={cn("size-3.5", state === "running" && "animate-spin motion-reduce:animate-none")} />
      {label}
    </span>
  )
}

// Compact dot for dense tables and run lists.
export function JobStatusDot({ state }: { state: JobState }) {
  const live = state === "running"
  return (
    <span className="relative inline-flex size-2.5" aria-label={states[state].label} role="img">
      {live && (
        <span className="bg-info absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden" />
      )}
      <span
        className={cn(
          "relative size-2.5 rounded-full",
          {
            queued: "border-muted-foreground border-2 border-dashed",
            running: "bg-info",
            succeeded: "bg-success",
            failed: "bg-destructive",
            cancelled: "bg-muted-foreground/50",
            interrupted: "bg-warning",
          }[state]
        )}
      />
    </span>
  )
}
