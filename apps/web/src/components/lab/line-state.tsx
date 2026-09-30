import { Badge } from "@/components/ui/badge"

// Where an order line ended up in a pipeline run (spec §10). Every state other than "loaded" has a reason
// in the unshipped list.
export type LineState = "loaded" | "partial" | "short" | "unreachable" | "excluded"

const states: Record<LineState, { label: string; variant: "success" | "warning" | "error" | "info" | "outline" }> = {
  loaded: { label: "Loaded", variant: "success" },
  partial: { label: "Partly filled", variant: "warning" },
  short: { label: "No stock", variant: "warning" },
  unreachable: { label: "Beyond leg limit", variant: "error" },
  excluded: { label: "Excluded", variant: "info" },
}

export const lineStates = Object.keys(states) as LineState[]

export function LineStateBadge({ state, className }: { state: LineState; className?: string }) {
  const { label, variant } = states[state]
  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  )
}
