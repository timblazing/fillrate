"use client"

import { ArrowLeft, Download, Printer } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { RunSummary } from "@fillrate/contracts"

import { reasonGroup, reasonLabel, shipmentLabel, unshippedGroups } from "@/lib/copy"
import type { Sheet, SheetColumn } from "@/lib/shipment-sheet"
import { formatCount, formatFeet, formatMiles, formatMoney, formatPercent } from "@/lib/units"

export type SheetUnshipped = RunSummary["unplanned"][number] & { location: string }

const optional: { id: SheetColumn; label: string }[] = [
  { id: "location", label: "Location" },
  { id: "pieces", label: "Pieces per product" },
]

export function SheetView({
  runId,
  scenario,
  depot,
  milesNote,
  sheets,
  total,
  shipment,
  columns,
  products,
  unshipped,
}: {
  runId: string
  scenario: string
  depot: string
  milesNote: string
  sheets: Sheet[]
  total: number
  shipment: string | null
  columns: SheetColumn[]
  products: Record<string, string>
  /** Every unshipped line when printing all shipments; null for a single-shipment sheet. */
  unshipped: SheetUnshipped[] | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const productIds = [...new Set(sheets.flatMap((s) => s.stops.flatMap((x) => Object.keys(x.pieces))))].sort()
  const csv = `/api/v1/runs/${runId}/export?format=csv&table=sheet${shipment ? `&truck=${encodeURIComponent(shipment)}` : ""}${columns.length ? `&columns=${columns.join(",")}` : ""}`

  const toggle = (c: SheetColumn, on: boolean) => {
    const next = new URLSearchParams(search.toString())
    const set = new Set(columns)
    if (on) set.add(c)
    else set.delete(c)
    if (set.size) next.set("columns", [...set].join(","))
    else next.delete("columns")
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  return (
    <div className="bg-background min-h-dvh print:min-h-0 print:bg-white print:text-black">
      <style>{"@page { margin: 12mm; }"}</style>
      <div className="bg-background/90 sticky top-0 z-10 border-b backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon-sm" render={<Link href={`/runs/${runId}`} aria-label="Back to the run" />}>
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold">{shipment ? "Shipment sheet" : `Shipment sheets · ${total}`}</h1>
            <p className="text-muted-foreground font-mono text-xs">
              Run {runId.slice(0, 8)}
              {unshipped && unshipped.length > 0 && (
                <>
                  {" · "}
                  <a href="#unshipped" className="underline underline-offset-2">
                    {formatCount(unshipped.length)} unshipped {unshipped.length === 1 ? "line" : "lines"}
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {optional.map((c) => (
              <Label key={c.id} className="gap-2 text-xs font-normal">
                <Checkbox checked={columns.includes(c.id)} onCheckedChange={(on) => toggle(c.id, Boolean(on))} />
                {c.label}
              </Label>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" render={<a href={csv} download />}>
              <Download aria-hidden /> CSV
            </Button>
            <Button size="sm" onClick={() => window.print()}>
              <Printer aria-hidden /> Print
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-6 print:max-w-none print:p-0">
        {sheets.map((s) => (
          <article key={s.truckId} className="mb-10 break-after-page print:mb-0 print:[&:last-child]:break-after-auto">
            <header className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-1 border-b-2 border-current pb-2">
              <h2 className="text-2xl font-semibold tracking-tight">{shipmentLabel(s.index)}</h2>
              <span className="font-mono text-sm">{s.truckId}</span>
              <span className="text-sm">Cluster {s.clusterIndex}</span>
              <span className="ml-auto text-sm">
                {scenario} · departs {depot}
              </span>
            </header>
            {/* Black-and-white trailer bar: one numbered segment per stop in visit order, to scale. */}
            <div className="mb-4 flex h-6 overflow-hidden rounded-sm border border-current" role="img" aria-label={`Trailer: ${formatPercent(s.totals.fill)} of ${formatFeet(s.capacity, 0)}`}>
              {s.stops.map((x) => (
                <span
                  key={x.sequence}
                  className="flex items-center justify-center border-r border-current font-mono text-[10px] last:border-r-0"
                  style={{ width: `${((x.linearFeet / s.capacity) * 100).toFixed(2)}%` }}
                >
                  {x.linearFeet / s.capacity > 0.04 ? x.sequence : ""}
                </span>
              ))}
              <span className="flex-1 bg-[repeating-linear-gradient(135deg,transparent_0_4px,currentColor_4px_5px)] opacity-25" />
            </div>
            <div role="region" aria-label={`${shipmentLabel(s.index)} stops`} tabIndex={0} className="overflow-x-auto outline-none focus-visible:ring-2 print:overflow-visible">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-current text-left">
                    <th className="py-1.5 pr-3 font-semibold">#</th>
                    <th className="py-1.5 pr-3 font-semibold">Orders</th>
                    {columns.includes("location") && <th className="py-1.5 pr-3 font-semibold">Location</th>}
                    {columns.includes("pieces") &&
                      productIds.map((p) => (
                        <th key={p} className="py-1.5 pr-3 text-right font-semibold">
                          {products[p] ?? p}
                        </th>
                      ))}
                    <th className="py-1.5 pr-3 text-right font-semibold">Linear ft</th>
                    <th className="py-1.5 pr-3 text-right font-semibold">Miles from previous</th>
                    <th className="py-1.5 text-right font-semibold">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {s.stops.map((x) => (
                    <tr key={x.sequence} className="break-inside-avoid border-b border-dotted border-current/40 align-top">
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{x.sequence}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{x.orders.join(", ")}</td>
                      {columns.includes("location") && <td className="py-1.5 pr-3">{x.location}</td>}
                      {columns.includes("pieces") &&
                        productIds.map((p) => (
                          <td key={p} className="py-1.5 pr-3 text-right font-mono tabular-nums">
                            {x.pieces[p] ?? ""}
                          </td>
                        ))}
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatFeet(x.linearFeet)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {formatMiles(x.milesFromPrevious)}
                        {x.sequence === 1 && <span className="text-xs"> (depot)</span>}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{formatMoney(x.value)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-current font-semibold">
                    <td className="py-2 pr-3" colSpan={2 + (columns.includes("location") ? 1 : 0) + (columns.includes("pieces") ? productIds.length : 0)}>
                      {s.totals.stops} {s.totals.stops === 1 ? "stop" : "stops"}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {formatFeet(s.totals.linearFeet)}
                      <span className="block text-xs font-normal">
                        {formatPercent(s.totals.fill)} of {formatFeet(s.capacity, 0)}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums">
                      {formatMiles(s.totals.loadedMiles)}
                      <span className="block text-xs font-normal">loaded</span>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">{formatMoney(s.totals.value)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-xs">
              Open route: no return to the depot. {milesNote} Linear feet are the only load
              dimension; this sheet is not a packing or compliance plan.
            </p>
            <p className="mt-1 font-mono text-[10px]">
              Run {runId.slice(0, 8)} · {shipmentLabel(s.index)} of {total}
            </p>
          </article>
        ))}
        {unshipped && <UnshippedSheet runId={runId} scenario={scenario} lines={unshipped} />}
      </main>
    </div>
  )
}

/** Printed after the shipments: every unshipped line with its reason and evidence (black-and-white safe). */
function UnshippedSheet({ runId, scenario, lines }: { runId: string; scenario: string; lines: SheetUnshipped[] }) {
  const totals = new Map<string, { lines: number; pieces: number; amount: number }>()
  for (const u of lines) {
    const g = reasonGroup[u.reason]
    const x = totals.get(g) ?? { lines: 0, pieces: 0, amount: 0 }
    x.lines++
    x.pieces += u.pieces
    x.amount += u.amount_cents
    totals.set(g, x)
  }
  const groups = unshippedGroups.filter((g) => totals.has(g.id))
  return (
    <section id="unshipped" aria-labelledby="unshipped-title" className="scroll-mt-20 break-before-page">
      <header className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-1 border-b-2 border-current pb-2">
        <h2 id="unshipped-title" className="text-2xl font-semibold tracking-tight">
          Unshipped lines
        </h2>
        <span className="ml-auto text-sm">{scenario}</span>
      </header>
      {lines.length === 0 ? (
        <p className="text-sm">Every ordered piece ships.</p>
      ) : (
        <>
          <table className="mb-6 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-current text-left">
                <th className="py-1.5 pr-3 font-semibold">Reason</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Lines</th>
                <th className="py-1.5 pr-3 text-right font-semibold">Pieces</th>
                <th className="py-1.5 text-right font-semibold">Value</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const x = totals.get(g.id)!
                return (
                  <tr key={g.id} className="border-b border-dotted border-current/40 align-top">
                    <td className="py-1.5 pr-3">
                      {g.label}
                      <span className="block text-xs">{g.hint}</span>
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatCount(x.lines)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatCount(x.pieces)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{formatMoney(x.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div role="region" aria-label="Unshipped lines table" tabIndex={0} className="overflow-x-auto outline-none focus-visible:ring-2 print:overflow-visible">
            <table className="w-full min-w-xl border-collapse text-xs">
              <thead>
                <tr className="border-b border-current text-left">
                  <th className="py-1.5 pr-3 font-semibold">Line / order</th>
                  <th className="py-1.5 pr-3 font-semibold">Location</th>
                  <th className="py-1.5 pr-3 font-semibold">Product</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Pieces</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Value</th>
                  <th className="py-1.5 pr-3 font-semibold">Reason</th>
                  <th className="py-1.5 font-semibold">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((u) => (
                  <tr key={`${u.line_id}-${u.reason}`} className="break-inside-avoid border-b border-dotted border-current/40 align-top">
                    <td className="py-1.5 pr-3 font-mono whitespace-nowrap">
                      {u.line_id}
                      <span className="block">{u.order_id}</span>
                    </td>
                    <td className="py-1.5 pr-3">{u.location}</td>
                    <td className="py-1.5 pr-3">{u.product_id}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{u.pieces}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">{formatMoney(u.amount_cents)}</td>
                    <td className="py-1.5 pr-3">
                      {reasonLabel[u.reason]}
                      <span className="block">step: {u.stage}</span>
                    </td>
                    <td className="py-1.5">{u.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-3 font-mono text-[10px]">Run {runId.slice(0, 8)} · unshipped lines</p>
    </section>
  )
}
