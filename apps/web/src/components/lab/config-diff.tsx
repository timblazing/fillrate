import { cn } from "@/lib/utils"

// Configuration diff between two runs (spec §10). Unchanged rows can be shown for context.
export type DiffRow = { field: string; a: string; b: string; same?: boolean }

export function ConfigDiff({
  rows,
  labels,
  className,
}: {
  rows: DiffRow[]
  labels: [string, string]
  className?: string
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border font-mono text-xs", className)}>
      <div className="bg-muted/60 text-muted-foreground grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] border-b font-sans font-medium">
        <div className="px-3 py-2">Field</div>
        <div className="border-l px-3 py-2">{labels[0]}</div>
        <div className="border-l px-3 py-2">{labels[1]}</div>
      </div>
      {rows.map((r) => (
        <div
          key={r.field}
          className={cn(
            "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] border-b last:border-b-0",
            r.same && "text-muted-foreground"
          )}
        >
          <div className="truncate px-3 py-1.5" title={r.field}>
            {r.field}
          </div>
          <div className={cn("border-l px-3 py-1.5", !r.same && "bg-destructive/8 text-destructive-foreground")}>
            {!r.same && <span className="mr-1.5 select-none">−</span>}
            {r.a}
          </div>
          <div className={cn("border-l px-3 py-1.5", !r.same && "bg-success/10 text-success-foreground")}>
            {!r.same && <span className="mr-1.5 select-none">+</span>}
            {r.b}
          </div>
        </div>
      ))}
    </div>
  )
}
