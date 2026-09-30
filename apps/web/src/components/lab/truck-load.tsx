"use client"

import { ChevronRight, Warehouse } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import type { OrderLine, Product, Stop, Truck } from "@/lib/fulfillment"
import { formatFeet, formatMiles, formatMoney, plural } from "@/lib/units"
import { cn } from "@/lib/utils"

import { TruckTag } from "./route-swatch"
import { FillPercent, TrailerFill } from "./trailer-fill"

// Truck load (spec §10): stop sequence and the order lines on board, with fill % and loaded miles.
// Open route: the sequence ends at the last stop; there is no return leg.
export function TruckLoad({
  truck,
  stops,
  lines,
  products,
  depotLabel,
  maxLeg,
  selectedStop,
  onSelectStop,
  defaultExpanded,
  className,
}: {
  truck: Truck
  stops: Map<string, Stop>
  lines: Map<string, OrderLine>
  products: Map<string, Product>
  depotLabel: string
  maxLeg: number
  selectedStop?: string | null
  onSelectStop?: (id: string) => void
  /** Stop ID whose order lines start expanded. */
  defaultExpanded?: string
  className?: string
}) {
  const [open, setOpen] = useState<string | null>(defaultExpanded ?? null)
  const seq = truck.stops.map((id) => stops.get(id)!)

  return (
    <div className={cn("bg-card overflow-hidden rounded-xl border", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3.5 py-2.5">
        <TruckTag id={truck.id} cluster={truck.cluster} className="text-sm" />
        <span className="text-muted-foreground text-xs tabular-nums">
          {plural(seq.length, "stop")} · {formatMiles(truck.loadedMiles)} loaded · {formatMoney(truck.value)}
        </span>
        <span className="ml-auto text-lg leading-none tracking-tight">
          <FillPercent fill={truck.fill} />
        </span>
      </div>
      <div className="px-3.5 pt-3 pb-2">
        <TrailerFill
          cluster={truck.cluster}
          segments={seq.map((s) => ({ id: s.id, load: s.load, label: `${s.label} · ${s.city}` }))}
          selected={selectedStop && truck.stops.includes(selectedStop) ? selectedStop : null}
          onSelect={onSelectStop}
        />
      </div>
      <ol className="px-3.5 pb-3 text-sm">
        <li className="text-muted-foreground flex items-center gap-2.5 py-1.5 text-xs">
          <span className="bg-foreground text-background flex size-5 items-center justify-center rounded-md">
            <Warehouse className="size-3" />
          </span>
          Departs {depotLabel}
        </li>
        {seq.map((s, i) => {
          const leg = truck.legs[i]
          const expanded = open === s.id
          const stopLines = s.lineIds.map((id) => lines.get(id)!).filter(Boolean)
          return (
            <li key={s.id} className="relative">
              <div className="text-muted-foreground flex items-center gap-2.5 py-0.5 pl-[9px] text-[11px] tabular-nums">
                <span className="bg-border h-4 w-px" />
                <span className={cn(leg > maxLeg * 0.9 && "text-warning-foreground font-medium")}>{formatMiles(leg)}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(expanded ? null : s.id)
                  onSelectStop?.(s.id)
                }}
                aria-expanded={expanded}
                className={cn(
                  "hover:bg-muted/60 -mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors",
                  selectedStop === s.id && "bg-muted"
                )}
              >
                <span className="border-foreground/20 bg-background flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {s.label}
                    {s.split && (
                      <Badge variant="outline" size="sm" className="ml-1.5 align-middle">
                        visit {s.split.index}/{s.split.of}
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {s.city} · {s.orderIds.length} {s.orderIds.length === 1 ? "order" : "orders"}
                  </span>
                </span>
                <span className="text-right font-mono text-xs tabular-nums">
                  <span className="block">{formatFeet(s.load)}</span>
                  <span className="text-muted-foreground block">{formatMoney(s.value)}</span>
                </span>
                <ChevronRight className={cn("text-muted-foreground size-4 shrink-0 transition-transform duration-150", expanded && "rotate-90")} />
              </button>
              {expanded && (
                <table className="bg-muted/40 mt-1 mb-1 ml-7 w-[calc(100%-1.75rem)] rounded-lg text-xs">
                  <thead>
                    <tr className="text-muted-foreground text-left">
                      <th className="px-2 py-1 font-normal">Line</th>
                      <th className="px-2 py-1 font-normal">Product</th>
                      <th className="px-2 py-1 text-right font-normal">Pcs</th>
                      <th className="px-2 py-1 text-right font-normal">Ft</th>
                      <th className="px-2 py-1 text-right font-normal">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {stopLines.map((l) => (
                      <tr key={l.id} className="border-t border-dashed">
                        <td className="px-2 py-1">{l.id}</td>
                        <td className="px-2 py-1 font-sans">{products.get(l.productId)?.label}</td>
                        <td className="px-2 py-1 text-right">
                          {l.allocated}
                          {l.allocated < l.ordered && <span className="text-warning-foreground">/{l.ordered}</span>}
                        </td>
                        <td className="px-2 py-1 text-right">{((l.allocated * l.lfPerPiece) / 100).toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{formatMoney(l.allocated * l.valuePerPiece)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          )
        })}
        <li className="text-muted-foreground pt-1.5 pl-7 text-[11px]">Open route · no return to depot</li>
      </ol>
    </div>
  )
}
