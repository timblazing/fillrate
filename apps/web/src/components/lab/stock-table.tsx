"use client"

import { ChevronRight, Info } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover"
import { formatCount, formatFeet, formatMoney, formatPercent } from "@/lib/units"
import { cn } from "@/lib/utils"

export type StockRow = {
  product: { id: string; label: string; sku?: string; lfPerPiece?: number; valuePerPiece?: number }
  /** Open ordered pieces across all lines. */
  ordered: number
  /** On-hand pieces at the depot (stock snapshot). */
  stock: number
  allocated: number
  /** Amount (cents) of ordered pieces that got no stock. */
  shortAmount: number
  /** Ordered pieces excluded before allocation (no coordinates, piece too long, excluded by the user). */
  excluded?: number
  /** Orders with at least one line of this product that got fewer pieces than ordered for lack of stock. */
  shortedOrders: string[]
}

/** Fill rate = allocated ÷ ordered pieces; null (N/A) when nothing was ordered. */
export const fillRate = (r: Pick<StockRow, "ordered" | "allocated">) => (r.ordered ? r.allocated / r.ordered : null)

// Stock coverage by product (spec §8; design review `orders.stock`): pieces short, fill rate % and which orders
// were shorted lead. On-hand vs ordered and dollars short sit in a details popover, not the default columns.
export function StockTable({ rows, onSelectOrder, className }: { rows: StockRow[]; onSelectOrder?: (orderId: string) => void; className?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className={cn("bg-card overflow-x-auto rounded-xl border", className)}>
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th className="px-3 py-2 text-left font-medium">Product</th>
            <th className="px-3 py-2 text-right font-medium">Pieces short</th>
            <th className="px-3 py-2 text-right font-medium">
              Fill rate <span className="font-normal">· allocated ÷ ordered</span>
            </th>
            <th className="px-3 py-2 text-left font-medium">Shorted orders</th>
            <th className="w-10" aria-label="Details" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rate = fillRate(r)
            const short = Math.max(0, r.ordered - (r.excluded ?? 0) - r.allocated)
            const expanded = open === r.product.id
            return (
              <tr key={r.product.id} className="border-b align-top last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.product.label}</div>
                  {r.product.sku && <div className="text-muted-foreground font-mono text-[11px]">SKU {r.product.sku}</div>}
                </td>
                <td className={cn("px-3 py-2 text-right font-mono text-xs tabular-nums", short > 0 && "text-warning-foreground font-medium")}>
                  {short > 0 ? formatCount(short) : <span className="text-muted-foreground">–</span>}
                </td>
                <td className={cn("px-3 py-2 text-right font-mono text-xs tabular-nums", rate != null && rate < 1 && "text-warning-foreground font-medium")}>
                  {rate == null ? <span className="text-muted-foreground font-sans">N/A</span> : formatPercent(rate)}
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.shortedOrders.length === 0 ? (
                    <span className="text-muted-foreground">none</span>
                  ) : (
                    <div className="space-y-1">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : r.product.id)}
                        className="hover:text-foreground text-muted-foreground inline-flex items-center gap-1"
                      >
                        <ChevronRight className={cn("size-3.5 transition-transform duration-150", expanded && "rotate-90")} />
                        {formatCount(r.shortedOrders.length)} {r.shortedOrders.length === 1 ? "order" : "orders"}
                      </button>
                      {expanded && (
                        <div className="flex max-w-md flex-wrap gap-1">
                          {r.shortedOrders.map((id) =>
                            onSelectOrder ? (
                              <button key={id} type="button" onClick={() => onSelectOrder(id)} className="bg-muted hover:bg-accent rounded px-1 py-px font-mono text-[10px]">
                                {id}
                              </button>
                            ) : (
                              <span key={id} className="bg-muted rounded px-1 py-px font-mono text-[10px]">
                                {id}
                              </span>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Popover>
                    <PopoverTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Stock details for ${r.product.label}`} />}>
                      <Info />
                    </PopoverTrigger>
                    <PopoverPopup align="end" className="w-64 text-xs">
                      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
                        <dt className="text-muted-foreground">On hand</dt>
                        <dd className="text-right font-mono">{formatCount(r.stock)}</dd>
                        <dt className="text-muted-foreground">Ordered</dt>
                        <dd className="text-right font-mono">{formatCount(r.ordered)}</dd>
                        <dt className="text-muted-foreground">Allocated</dt>
                        <dd className="text-right font-mono">{formatCount(r.allocated)}</dd>
                        {!!r.excluded && (
                          <>
                            <dt className="text-muted-foreground">Excluded before allocation</dt>
                            <dd className="text-right font-mono">{formatCount(r.excluded)}</dd>
                          </>
                        )}
                        <dt className="text-muted-foreground">Left in stock</dt>
                        <dd className="text-right font-mono">{formatCount(r.stock - r.allocated)}</dd>
                        <dt className="text-muted-foreground">Dollars short</dt>
                        <dd className="text-right font-mono">{formatMoney(r.shortAmount)}</dd>
                        {r.product.lfPerPiece != null && (
                          <>
                            <dt className="text-muted-foreground">Per piece</dt>
                            <dd className="text-right font-mono">
                              {formatFeet(r.product.lfPerPiece, 2)}
                              {r.product.valuePerPiece != null && ` · ${formatMoney(r.product.valuePerPiece)}`}
                            </dd>
                          </>
                        )}
                      </dl>
                    </PopoverPopup>
                  </Popover>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
