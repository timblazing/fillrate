import { Lock, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Where a resolved setting came from (spec §11): default → workspace → scenario → run; deployment limits bound all.
export type SettingSource = "default" | "workspace" | "scenario" | "run" | "deployment"

const sources: Record<SettingSource, { label: string; className: string; hint: string }> = {
  default: { label: "Default", className: "text-muted-foreground border-border", hint: "Built-in default" },
  workspace: { label: "Workspace", className: "text-route-6 border-route-6/40 bg-route-6/5", hint: "Workspace setting" },
  scenario: { label: "Scenario", className: "text-route-1 border-route-1/40 bg-route-1/5", hint: "Scenario override" },
  run: { label: "Run", className: "text-route-5 border-route-5/40 bg-route-5/5", hint: "Explicit run override" },
  deployment: {
    label: "Deployment",
    className: "text-muted-foreground border-dashed",
    hint: "Set by environment variable; read-only",
  },
}

export function SettingSourceBadge({ source }: { source: SettingSource }) {
  const { label, className, hint } = sources[source]
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className={cn(
          "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium tracking-wide uppercase",
          className
        )}
      >
        {source === "deployment" && <Lock className="size-2.5" />}
        {label}
      </TooltipTrigger>
      <TooltipPopup>{hint}</TooltipPopup>
    </Tooltip>
  )
}

// One settings row: label + description, source indicator, control, and reset-to-inherited.
export function SettingRow({
  label,
  description,
  source,
  onReset,
  children,
}: {
  label: string
  description?: string
  source: SettingSource
  onReset?: () => void
  children: React.ReactNode
}) {
  const overridden = source === "scenario" || source === "run"
  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2 text-sm font-medium">
          {label}
          <SettingSourceBadge source={source} />
        </div>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        {children}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Reset ${label}`}
          disabled={!overridden}
          onClick={onReset}
          className={cn(!overridden && "invisible")}
        >
          <RotateCcw />
        </Button>
      </div>
    </div>
  )
}
