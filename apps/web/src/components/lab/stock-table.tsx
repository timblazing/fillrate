import type { Product } from "@/lib/fulfillment"
import { formatCount, formatFeet, formatMoney, formatPercent, cssPercent } from "@/lib/units"
import { cn } from "@/lib/utils"

export type StockRow = {
  product: Product
  /** Open ordered pieces across all lines. */
  ordered: number
  /** Available pieces at the depot. */
  stock: number
  allocated: number
  /** Amount (cents) of ordered pieces that got no stock. */
  shortAmount: number
}

// Inventory against open demand, by product (spec §8). Ordered, allocated, residual, and short are reported
// separately. The bar shows stock as a share of demand; the notch marks 100%.
export function StockTable({ rows, className }: { rows: StockRow[]; className?: string }) {
  const maxRatio = Math.max(1.2, ...rows.map((r) => r.stock / r.ordered))
  return (
    <div className={cn("bg-card overflow-x-auto rounded-xl border", className)}>
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th className="px-3 py-2 text-left font-medium">Product</th>
            <th className="px-3 py-2 text-right font-medium">Ordered</th>
            <th className="px-3 py-2 text-right font-medium">Stock</th>
            <th className="w-[28%] px-3 py-2 text-left font-medium">Coverage</th>
            <th className="px-3 py-2 text-right font-medium">Allocated</th>
            <th className="px-3 py-2 text-right font-medium">Residual</th>
            <th className="px-3 py-2 text-right font-medium">Short</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ratio = r.stock / r.ordered
            const short = Math.max(0, r.ordered - r.allocated)
            return (
              <tr key={r.product.id} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.product.label}</div>
                  <div className="text-muted-foreground font-mono text-[11px]">
                    SKU {r.product.sku} · {formatFeet(r.product.lfPerPiece, 2)}/pc · {formatMoney(r.product.valuePerPiece)} list
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{formatCount(r.ordered)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{formatCount(r.stock)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="bg-muted relative h-2 flex-1 rounded-full">
                      <div
                        className={cn("h-full rounded-full", ratio < 0.8 ? "bg-warning" : ratio < 1 ? "bg-foreground/50" : "bg-success")}
                        style={{ width: cssPercent(Math.min(ratio, maxRatio) / maxRatio) }}
                      />
                      <span className="bg-foreground absolute -inset-y-1 w-px" style={{ left: cssPercent(1 / maxRatio) }} aria-hidden />
                    </div>
                    <span className={cn("w-10 text-right font-mono text-xs tabular-nums", ratio < 0.8 && "text-warning-foreground font-medium")}>
                      {formatPercent(ratio)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{formatCount(r.allocated)}</td>
                <td className="text-muted-foreground px-3 py-2 text-right font-mono text-xs tabular-nums">{formatCount(r.stock - r.allocated)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                  {short ? (
                    <>
                      <div className="text-warning-foreground font-medium">{formatCount(short)} pcs</div>
                      <div className="text-muted-foreground">{formatMoney(r.shortAmount, { compact: true })}</div>
                    </>
                  ) : (
                    <span className="text-muted-foreground">–</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
