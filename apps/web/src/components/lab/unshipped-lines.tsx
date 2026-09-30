"use client"

import { FileWarning, PackageX, Ruler, Container } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import type { Location, Product, UnshippedLine, UnshippedReason } from "@/lib/fulfillment"
import { formatCount, formatMoney } from "@/lib/units"
import { cn } from "@/lib/utils"

export const unshippedReasons: Record<
  UnshippedReason,
  { label: string; stage: string; icon: typeof PackageX; tone: string; dot: string }
> = {
  "no-stock": { label: "No stock", stage: "Not allocated", icon: PackageX, tone: "text-warning-foreground", dot: "bg-warning" },
  unreachable: { label: "Beyond leg limit", stage: "Allocated, not loaded", icon: Ruler, tone: "text-destructive-foreground", dot: "bg-destructive" },
  "did-not-fit": { label: "Did not fit", stage: "Allocated, not loaded", icon: Container, tone: "text-destructive-foreground", dot: "bg-destructive" },
  "data-quality": { label: "Data quality", stage: "Excluded", icon: FileWarning, tone: "text-info-foreground", dot: "bg-info" },
}

// Every unshipped line with a reason (spec §10), so nobody has to reverse-engineer the output.
// Competing lines are the earlier or higher-value lines that took the stock.
export function UnshippedLines({
  items,
  products,
  locations,
  pageSize = 8,
  onSelectLine,
  className,
}: {
  items: UnshippedLine[]
  products: Map<string, Product>
  locations: Map<string, Location>
  pageSize?: number
  onSelectLine?: (lineId: string) => void
  className?: string
}) {
  const [reason, setReason] = useState<UnshippedReason | null>(null)
  const [shown, setShown] = useState(pageSize)

  const groups = useMemo(() => {
    const out = new Map<UnshippedReason, { lines: number; pieces: number; amount: number }>()
    for (const u of items) {
      const g = out.get(u.reason) ?? { lines: 0, pieces: 0, amount: 0 }
      g.lines++
      g.pieces += u.pieces
      g.amount += u.amount
      out.set(u.reason, g)
    }
    return out
  }, [items])

  const rows = useMemo(
    () => items.filter((u) => !reason || u.reason === reason).sort((a, b) => b.amount - a.amount),
    [items, reason]
  )

  return (
    <div className={cn("bg-card overflow-hidden rounded-xl border", className)}>
      <div className="grid grid-cols-2 border-b sm:grid-cols-4">
        {(Object.keys(unshippedReasons) as UnshippedReason[]).map((r) => {
          const meta = unshippedReasons[r]
          const g = groups.get(r)
          const active = reason === r
          return (
            <button
              key={r}
              type="button"
              aria-pressed={active}
              disabled={!g}
              onClick={() => {
                setReason(active ? null : r)
                setShown(pageSize)
              }}
              className={cn(
                "hover:bg-muted/50 space-y-1 border-r border-b p-3 text-left transition-colors last:border-r-0 disabled:opacity-50 sm:border-b-0 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r",
                active && "bg-muted"
              )}
            >
              <div className={cn("flex items-center gap-1.5 text-xs font-medium", meta.tone)}>
                <meta.icon className="size-3.5" /> {meta.label}
              </div>
              <div className="text-lg font-semibold tracking-tight tabular-nums">{formatMoney(g?.amount ?? 0, { compact: true })}</div>
              <div className="text-muted-foreground text-[11px] tabular-nums">
                {formatCount(g?.lines ?? 0)} lines · {formatCount(g?.pieces ?? 0)} pcs · {meta.stage.toLowerCase()}
              </div>
            </button>
          )
        })}
      </div>
      <ul className="divide-y">
        {rows.slice(0, shown).map((u) => {
          const meta = unshippedReasons[u.reason]
          const loc = locations.get(u.locationId)
          const product = products.get(u.productId)
          return (
            <li key={`${u.lineId}-${u.reason}`}>
              <button
                type="button"
                onClick={() => onSelectLine?.(u.lineId)}
                className="hover:bg-muted/40 grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-1 px-3.5 py-2.5 text-left text-sm transition-colors"
              >
                <span className={cn("mt-1.5 size-2 rounded-full", meta.dot)} aria-label={meta.label} />
                <span className="min-w-0 space-y-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-xs font-medium">{u.lineId}</span>
                    <span className="truncate">{product?.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {loc?.label} · {loc?.city}, {loc?.state} · ordered {u.orderDate}
                    </span>
                  </span>
                  <span className="text-muted-foreground block text-xs text-pretty">{u.detail}</span>
                  {u.competing && u.competing.length > 0 && (
                    <span className="text-muted-foreground flex flex-wrap items-center gap-1 pt-0.5 text-[11px]">
                      Taken by
                      {u.competing.map((c) => (
                        <span key={c} className="bg-muted rounded px-1 py-px font-mono text-[10px]">
                          {c}
                        </span>
                      ))}
                      {u.competingCount != null && u.competingCount > u.competing.length && (
                        <span>+{formatCount(u.competingCount - u.competing.length)} earlier lines</span>
                      )}
                    </span>
                  )}
                </span>
                <span className="text-right font-mono text-xs tabular-nums">
                  <span className="block font-medium">{formatMoney(u.amount)}</span>
                  <span className="text-muted-foreground block">
                    {u.pieces}/{u.ordered} pcs
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="text-muted-foreground flex items-center gap-3 border-t px-3.5 py-2 text-xs">
        <span className="tabular-nums">
          {formatCount(Math.min(shown, rows.length))} of {formatCount(rows.length)} lines
          {reason && ` · ${unshippedReasons[reason].label.toLowerCase()}`}
        </span>
        {shown < rows.length && (
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setShown((s) => s + pageSize * 2)}>
            Show more
          </Button>
        )}
      </div>
    </div>
  )
}
