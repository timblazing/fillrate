"use client"

import { Upload } from "lucide-react"
import { useMemo, useState } from "react"

import { DataTable } from "@/components/lab/data-table"
import { CoordinateSourceBadge, type CoordinateSource, isCoordinateProblem } from "@/components/lab/provenance-badge"
import { StockTable } from "@/components/lab/stock-table"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Toggle } from "@/components/ui/toggle"
import { formatCount, formatMoney } from "@/lib/units"

import { baseline, stockRows, syntheticScenario } from "../fixtures"
import { orderRows } from "../fixtures/order-rows"
import { orderColumns } from "../order-columns"
import { AppShell, RunPipelineButton, type Section } from "./shell"

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-card space-y-0.5 rounded-xl border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="text-muted-foreground text-[11px]">{sub}</div>}
    </div>
  )
}

// Data + Inventory sections (spec §4, §6, §8): what was imported, where coordinates came from, and stock vs demand.
export function OrdersInventoryBlock() {
  const run = baseline()
  const scen = syntheticScenario()
  const [section, setSection] = useState<Section>("Data")
  const allRows = orderRows(run)
  const [showAllSources, setShowAllSources] = useState(false)
  const [problemsOnly, setProblemsOnly] = useState(false)
  const rows = problemsOnly ? allRows.filter((r) => isCoordinateProblem(r.source)) : allRows
  const columns = useMemo(() => orderColumns(showAllSources), [showAllSources])
  const problemCount = allRows.filter((r) => isCoordinateProblem(r.source)).length
  const sources = scen.locations.reduce<Record<CoordinateSource, number>>(
    (acc, l) => ({ ...acc, [l.source]: (acc[l.source] ?? 0) + 1 }),
    { imported: 0, census: 0, manual: 0, zcta: 0, unresolved: 0 }
  )
  const dates = scen.lines.map((l) => l.orderDate).sort()

  return (
    <AppShell
      section={section}
      onSection={setSection}
      actions={
        <>
          <Button variant="outline" size="sm">
            <Upload /> Import CSV
          </Button>
          <RunPipelineButton />
        </>
      }
    >
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Open orders" value={formatCount(scen.orderCount)} sub={`${dates[0]} → ${dates[dates.length - 1]}`} />
            <Stat label="Order lines" value={formatCount(scen.lines.length)} sub="6 SKUs · piece-level" />
            <Stat label="Accounts" value={formatCount(scen.locations.length)} sub="1 depot · Memphis DC" />
            <Stat label="Ordered amount" value={formatMoney(run.metrics.revenueOrdered, { compact: true })} sub="net value × ordered pieces" />
            <Stat
              label="Ordered linear feet"
              value={`${formatCount(Math.round(scen.lines.reduce((s, l) => s + l.ordered * l.lfPerPiece, 0) / 100))} ft`}
              sub={`≈ ${Math.ceil(scen.lines.reduce((s, l) => s + l.ordered * l.lfPerPiece, 0) / 5300)} full 53 ft trailers`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground mr-1">Coordinate problems</span>
            {(Object.keys(sources) as CoordinateSource[]).filter((s) => showAllSources || isCoordinateProblem(s)).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <CoordinateSourceBadge source={s} />
                <span className="font-mono tabular-nums">{sources[s]}</span>
              </span>
            ))}
          </div>

          {sources.unresolved > 0 && (
            <Alert variant="warning">
              <AlertTitle>{sources.unresolved} accounts have no coordinates</AlertTitle>
              <AlertDescription>
                Their ZIPs are PO-box-only, so there is no ZCTA fallback. {formatCount(run.unshipped.filter((u) => u.reason === "data-quality").length)} lines
                are excluded from allocation until they are placed.
              </AlertDescription>
              <AlertAction>
                <Button size="xs" variant="outline">
                  Review on map
                </Button>
              </AlertAction>
            </Alert>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Stock coverage at Memphis DC</h3>
            <StockTable rows={stockRows(run)} />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Order lines</h3>
            <DataTable
              columns={columns}
              data={rows}
              pageSize={10}
              filterPlaceholder="Line, account, product…"
              className="bg-card"
              toolbar={
                <>
                  <Toggle variant="outline" size="sm" pressed={problemsOnly} onPressedChange={setProblemsOnly}>
                    Coordinate problems <span className="text-muted-foreground font-mono tabular-nums">{problemCount}</span>
                  </Toggle>
                  <Label className="gap-2 text-xs font-normal">
                    <Switch checked={showAllSources} onCheckedChange={setShowAllSources} />
                    Show all sources
                  </Label>
                </>
              }
            />
          </section>
        </div>
      </ScrollArea>
    </AppShell>
  )
}
