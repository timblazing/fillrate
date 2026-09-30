"use client"

import { ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

export type PlanFlowStep = {
  id: string
  /** Business object, e.g. "Orders", "Trucks". */
  label: string
  value: string
  /** Context under the value, e.g. "of 2,829 lines". */
  detail?: string
  /** What left the flow at this step, e.g. "400 lines no stock". Shown in the warning tone. */
  drop?: string
}

// The run as business objects (orders → allocated lines → stops → clusters → trucks → shipped), ahead of the
// algorithm stages. Premium planners lead with these objects; the stages stay available as pipeline detail.
export function PlanFlow({
  steps,
  selected,
  onSelect,
  className,
}: {
  steps: PlanFlowStep[]
  selected?: string | null
  onSelect?: (id: string) => void
  className?: string
}) {
  return (
    <ol className={cn("bg-card grid overflow-hidden rounded-xl border sm:grid-flow-col sm:auto-cols-fr", className)}>
      {steps.map((s, i) => (
        <li key={s.id} className="relative min-w-0 border-b last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
          <button
            type="button"
            onClick={() => onSelect?.(s.id)}
            disabled={!onSelect}
            aria-pressed={onSelect ? selected === s.id : undefined}
            className={cn(
              "flex h-full w-full flex-col gap-0.5 px-3.5 py-3 text-left transition-colors",
              onSelect && "hover:bg-muted/50 focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
              selected === s.id && "bg-muted/60"
            )}
          >
            <span className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">{s.label}</span>
            <span className="text-xl font-medium tracking-tight tabular-nums">{s.value}</span>
            {s.detail && <span className="text-muted-foreground text-xs text-pretty">{s.detail}</span>}
            {s.drop && <span className="text-warning-foreground text-xs text-pretty">↘ {s.drop}</span>}
          </button>
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className="bg-card text-muted-foreground absolute top-1/2 -right-2.5 z-10 hidden size-5 -translate-y-1/2 items-center justify-center rounded-full border sm:flex"
            >
              <ChevronRight className="size-3" />
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}
