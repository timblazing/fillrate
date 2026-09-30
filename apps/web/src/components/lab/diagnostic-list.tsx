import { CircleAlert, Info, OctagonX } from "lucide-react"

import { cn } from "@/lib/utils"

// Preflight diagnostics (spec §10): only provable issues block; observations never guess solver intent.
export type Diagnostic = {
  severity: "blocking" | "warning" | "info"
  title: string
  detail?: string
  refs?: string[]
}

const tone = {
  blocking: { icon: OctagonX, className: "text-destructive" },
  warning: { icon: CircleAlert, className: "text-route-4" },
  info: { icon: Info, className: "text-muted-foreground" },
}

export function DiagnosticList({
  items,
  onSelectRef,
  className,
}: {
  items: Diagnostic[]
  onSelectRef?: (id: string) => void
  className?: string
}) {
  return (
    <ul className={cn("divide-y overflow-hidden rounded-xl border", className)}>
      {items.map((d, i) => {
        const { icon: Icon, className: iconClass } = tone[d.severity]
        return (
          <li key={i} className="bg-card flex gap-3 p-3">
            <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="text-sm font-medium">{d.title}</div>
              {d.detail && <p className="text-muted-foreground text-xs">{d.detail}</p>}
              {d.refs && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {d.refs.map((ref) => (
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
            </div>
            <span className={cn("text-[10px] font-medium tracking-wide uppercase", iconClass)}>{d.severity}</span>
          </li>
        )
      })}
    </ul>
  )
}
