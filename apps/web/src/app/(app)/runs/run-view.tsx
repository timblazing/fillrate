"use client"

import type { RunSummary } from "@fillrate/contracts"
import { ArrowLeft, Ban, Check, Download, Loader, Pencil, Printer } from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { PageTitle } from "@/components/app/page"
import { JobStatusBadge, type JobState } from "@/components/lab/job-status"
import { StepsPanel } from "@/components/lab/pipeline-stages"
import { CoordinateSourceFlag } from "@/components/lab/provenance-badge"
import { ClusterSwatch, TruckTag } from "@/components/lab/route-swatch"
import { StatTile } from "@/components/lab/stat-tile"
import { type StockRow, StockTable } from "@/components/lab/stock-table"
import { FillBandLegend, FillPercent, ShipmentFill, TrailerFill } from "@/components/lab/trailer-fill"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { toastManager } from "@/components/ui/toast"
import { allocationSettingsLabel, COST_FALLBACK, legRule, preflightChecks, reasonGroup, reasonLabel, shipmentLabel, shipments, type UnshippedGroup, unshippedGroups } from "@/lib/copy"
import type { RunDetail } from "@/lib/server/runs"
import { METERS_PER_MILE } from "@/lib/shipment-sheet"
import { FILL_LOW, fillBand, formatCount, formatFeet, formatMiles, formatMoney, formatPercent, plural, travelBasis } from "@/lib/units"
import { cn } from "@/lib/utils"


import { type RoadGeometry, RoadGeometryControl, useRoadGeometry } from "./road-geometry"
import { TimelinePanel } from "./timeline-panel"
import { type Rerun, RerunButton } from "./rerun-button"

const RunMap = dynamic(() => import("./run-map"), { ssr: false, loading: () => <div className="bg-muted/40 h-full animate-pulse" /> })

const ACTIVE = new Set(["queued", "running"])
const SHIPMENT_PAGE_SIZE = 50
const miles = (m: number) => formatMiles(m / METERS_PER_MILE)

type PipelineDetail = Extract<RunDetail, { kind: "pipeline" }>

export type { Rerun }

const strategyLabel = (summary: RunSummary) =>
  summary.clustering.strategy === "h3" ? `H3 cells · resolution ${summary.clustering.h3_resolution}`
  : summary.clustering.strategy === "none" ? "No clustering (baseline)"
  : summary.clustering.requested_k ? `k = ${summary.clustering.requested_k} (fixed)` : `Auto k = ${summary.clustering.selected_k ?? 0}`

// Polls the run every 2 s while it is active (5 s after the first minute), pausing while the tab is hidden.
function useRun(initial: PipelineDetail) {
  const [run, setRun] = useState(initial)
  useEffect(() => {
    if (!ACTIVE.has(run.status)) return
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout>
    let stopped = false
    const tick = async () => {
      if (!document.hidden) {
        const res = await fetch(`/api/v1/runs/${initial.id}`, { cache: "no-store" }).catch(() => null)
        if (res?.ok && !stopped) {
          const next = (await res.json()) as PipelineDetail
          setRun(next)
          if (!ACTIVE.has(next.status)) return
        }
      }
      if (!stopped) timer = setTimeout(tick, Date.now() - started > 60_000 ? 5_000 : 2_000)
    }
    timer = setTimeout(tick, 1_000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [initial.id, run.status])
  return [run, setRun] as const
}

export function RunView({ initial, rerun, scenarioHref = null }: { initial: PipelineDetail; rerun?: Rerun | null; scenarioHref?: string | null }) {
  const [run, setRun] = useRun(initial)
  const [cancelling, setCancelling] = useState(false)
  const active = ACTIVE.has(run.status)
  const failureCode = String(run.failure?.code ?? "error")
  const ended = !active
  const failure = failureCopy(failureCode)
  const geo = useRoadGeometry()

  async function cancel() {
    setCancelling(true)
    const res = await fetch(`/api/v1/runs/${run.id}/cancel`, { method: "POST" })
    const body = await res.json()
    if (res.ok) setRun(body)
    else toastManager.add({ type: "error", title: "Could not cancel", description: body.error?.message })
    setCancelling(false)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon-sm" render={<Link href="/runs" aria-label="All runs" />}>
          <ArrowLeft />
        </Button>
        <PageTitle className="font-mono">Run {run.id.slice(0, 8)}</PageTitle>
        <JobStatusBadge state={run.status as JobState} />
        <span className="text-muted-foreground text-xs tabular-nums">
          {run.settings.cluster_strategy === "kmeans" ? `k ${run.settings.k ?? "auto"}` : run.settings.cluster_strategy === "h3" ? `H3 r${run.settings.h3_resolution}` : "no clustering"} · solver seed {run.settings.solver_seed}
          {run.settings.inventory_percent !== 100 && ` · inventory ${run.settings.inventory_percent}%`}
        </span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {active && (
            <Button variant="destructive-outline" size="sm" onClick={cancel} loading={cancelling}>
              <Ban aria-hidden /> Cancel
            </Button>
          )}
          {run.status === "succeeded" && (
            <>
              <Button variant="outline" size="sm" render={<Link href={`/runs/${run.id}/sheet`} />}>
                <Printer aria-hidden /> Shipment sheets
              </Button>
              <ExportMenu id={run.id} />
            </>
          )}
          {ended && scenarioHref && (
            <Button variant="outline" size="sm" render={<Link href={scenarioHref} />}>
              <Pencil aria-hidden /> Open scenario
            </Button>
          )}
          {ended && rerun && <RerunButton rerun={rerun} variant={run.status === "failed" && failure.fixFirst ? "outline" : "default"} />}
        </div>
      </div>

      {active && (
        <Progress run={run} />
      )}
      {run.status === "failed" && (
        <Alert variant="error">
          <AlertTitle>{failure.title}</AlertTitle>
          <AlertDescription>
            <p>{String(run.failure?.message ?? "The optimizer reported a failure.")}</p>
            <p>
              {failure.next}
              {!rerun && " Start a new run from the scenario."}
            </p>
            <p className="font-mono text-[11px]">code {failureCode}</p>
          </AlertDescription>
        </Alert>
      )}
      {run.status === "cancelled" && (
        <Alert>
          <AlertTitle>Cancelled</AlertTitle>
          <AlertDescription>The solver process was stopped. Nothing from this run is counted as planned.{rerun ? " Run again starts a new run with the same version and settings." : ""}</AlertDescription>
        </Alert>
      )}
      {run.summary && <Results summary={run.summary} runId={run.id} geo={geo} />}
    </>
  )
}

/** Actionable copy for a failed run's code; `fixFirst` means rerunning the same input fails the same way. */
function failureCopy(code: string): { title: string; next: string; fixFirst: boolean } {
  if (code === "preflight_blocked")
    return { title: "Blocked by preflight checks", next: "Open the scenario to fix or exclude the flagged stops, or change the check to a warning, then run again. Running the same version again is blocked the same way.", fixFirst: true }
  if (code === "interrupted")
    return { title: "Interrupted by a restart", next: "The server restarted while this run was in progress. Run again to start it over.", fixFirst: false }
  if (code === "optimizer_unavailable")
    return { title: "Optimizer not running", next: "Start the optimizer service (bun run optimizer), then run again.", fixFirst: false }
  if (code === "run_wall_limit")
    return { title: "Stopped at the run time limit", next: "Lower the solve time per cluster or split the work into more clusters, then run again.", fixFirst: true }
  return { title: "Run failed", next: "Run again to retry with the same version and settings. If it fails the same way, the input or settings need to change.", fixFirst: false }
}

function ExportMenu({ id }: { id: string }) {
  const href = (q: string) => `/api/v1/runs/${id}/export?${q}`
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" />}>
        <Download aria-hidden /> Export
      </MenuTrigger>
      <MenuPopup align="end">
        {[
          ["format=json", "Run JSON (inputs, results)"],
          ["format=csv&table=sheet", "Shipment sheets CSV"],
          ["format=csv&table=loads", "Shipment lines CSV (loads)"],
          ["format=csv&table=unplanned", "Unshipped lines CSV (unplanned)"],
          ["format=csv&table=clusters", "Clusters CSV"],
          ["format=csv&table=products", "Stock reconciliation CSV"],
          ["format=geojson", "GeoJSON routes (schematic lines)"],
          ["format=python", "Python replay bundle (.zip)"],
        ].map(([q, label]) => (
          <MenuItem key={q} render={<a href={href(q)} download />}>
            {label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}

function Progress({ run }: { run: PipelineDetail }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const timer = setInterval(tick, 1_000)
    return () => clearInterval(timer)
  }, [])
  const seconds = now === null ? 0 : Math.max(0, Math.round((now - run.created_at) / 1_000))
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border p-4 text-sm" role="status">
      <Loader className="text-info size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      {run.status === "queued" ? "Waiting for the earlier runs to finish…" : "Solving…"}
      <span className="text-muted-foreground tabular-nums">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
    </div>
  )
}

/** Each completed step with the business output it produced. */
function CompletedSteps({ summary }: { summary: RunSummary }) {
  const t = summary.totals
  const allocated = summary.products.reduce((n, p) => n + p.allocated, 0)
  const ordered = summary.products.reduce((n, p) => n + p.ordered, 0)
  const flagged = (summary.preflight ?? []).length
  const steps: [string, string, string][] = [
    ["Preflight", flagged ? `${flagged} ${flagged === 1 ? "check" : "checks"} flagged` : "no issues", "data and policy checks"],
    ["Allocation", `${formatCount(allocated)} of ${formatCount(ordered)}`, `pieces · ${allocationSettingsLabel(summary.settings)}`],
    ["Aggregation", formatCount(t.visits), t.visits === 1 ? "stop" : "stops"],
    ["Clustering", formatCount(summary.clustering.effective_cluster_count), `clusters · ${strategyLabel(summary)}`],
    ["Travel", travelBasis(summary.travel, summary.settings.travel_circuity).step, travelBasis(summary.travel, summary.settings.travel_circuity).unit],
    ["Solve", formatCount(t.trucks), t.trucks === 1 ? "shipment" : "shipments"],
    ["Validation", summary.validity === "valid" ? "valid" : "invalid", `coverage ${summary.coverage}`],
    ["Summary", formatMoney(t.planned_cents, { compact: true }), "planned revenue"],
  ]
  return (
    <ol className="bg-card grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border p-4 sm:grid-cols-4 lg:grid-cols-8" aria-label="Pipeline steps">
      {steps.map(([label, value, detail]) => (
        <li key={label} className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Check className="text-success-foreground size-3.5 shrink-0" aria-hidden />
            {label}
          </div>
          <div className="truncate text-base font-medium tracking-tight tabular-nums">{value}</div>
          <div className="text-muted-foreground truncate text-[11px]">{detail}</div>
        </li>
      ))}
    </ol>
  )
}

/** `runId` is null for results that are not stored (the playground), which hides the links into stored runs. */
export function Results({ summary, runId, geo }: { summary: RunSummary; runId: string | null; geo: RoadGeometry }) {
  const [cluster, setCluster] = useState<string | null>(null)
  const [hexes, setHexes] = useState(false)
  const [truck, setTruck] = useState<string | null>(null)
  const [tab, setTab] = useState("map")
  const t = summary.totals
  const unplannedPieces = summary.products.reduce((n, p) => n + p.allocated_unplanned, 0)
  const clusterIndex = (id: string | null | undefined) => (id ? summary.clusters.findIndex((c) => c.id === id) + 1 : 0)
  const unshippedAmount = summary.unplanned.reduce((s, u) => s + u.amount_cents, 0)
  const lowCount = summary.trucks.filter((x) => fillBand(x.fill) === "low").length
  const road = useMemo(() => (geo.shown.size ? Object.fromEntries([...geo.shown].map((id) => [id, geo.paths[id].legs])) : null), [geo.shown, geo.paths])
  const selectTruck = (id: string | null) => {
    setTruck(id)
    if (id) setCluster(summary.trucks.find((x) => x.id === id)?.cluster_id ?? null)
  }

  return (
    <>
      <ValidityAlert summary={summary} unplannedPieces={unplannedPieces} />

      {/* Revenue leads (design review `results.judge`): planned revenue, then trailer fill, then tightness. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1.4fr_repeat(4,minmax(0,1fr))]">
        <div className="bg-card col-span-2 flex flex-col gap-2 rounded-xl border p-4 lg:col-span-1">
          <span className="text-muted-foreground text-xs font-medium">Planned revenue</span>
          <span className="text-3xl font-semibold tracking-tight tabular-nums">{formatMoney(t.planned_cents)}</span>
          <div className="bg-muted flex h-2 overflow-hidden rounded-full" role="img" aria-label="Planned, allocated and ordered amounts">
            <span className="bg-foreground" style={{ width: `${((t.planned_cents / Math.max(1, t.ordered_cents)) * 100).toFixed(2)}%` }} />
            <span className="bg-foreground/35" style={{ width: `${(((t.allocated_cents - t.planned_cents) / Math.max(1, t.ordered_cents)) * 100).toFixed(2)}%` }} />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatMoney(t.allocated_cents, { compact: true })} allocated · {formatMoney(t.ordered_cents, { compact: true })} ordered
          </span>
        </div>
        <StatTile label="Shipments" value={formatCount(t.trucks)} footnote={<BoundsNote total={t.capacity_lower_bound} perCluster={t.sum_cluster_lower_bounds} trucks={t.trucks} />} />
        <StatTile
          label="Trailer fill"
          value={t.avg_fill == null ? "n/a" : formatPercent(t.avg_fill)}
          footnote={t.min_fill == null ? undefined : `Lowest ${formatPercent(t.min_fill)} · ${lowCount} under ${formatPercent(FILL_LOW)}`}
        />
        <StatTile label="Loaded miles" value={miles(t.loaded_distance_m)} footnote={travelBasis(summary.travel, summary.settings.travel_circuity).note} />
        <StatTile label="Clusters" value={formatCount(summary.clustering.effective_cluster_count)} footnote={strategyLabel(summary)} />
      </div>

      <PreflightNotes summary={summary} />

      <StepsPanel>
        <CompletedSteps summary={summary} />
      </StepsPanel>

      {/* Map first (design review `workbench.first`): the cluster map is the initial tab at every width. */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTab value="map">Map</TabsTab>
            <TabsTab value="shipments">Shipments ({summary.trucks.length})</TabsTab>
            <TabsTab value="timeline">Timeline</TabsTab>
            <TabsTab value="unshipped">
              Unshipped{unshippedAmount ? ` (${formatMoney(unshippedAmount, { compact: true })})` : ""}
            </TabsTab>
            <TabsTab value="stock">Stock</TabsTab>
            <TabsTab value="provenance">Provenance</TabsTab>
          </TabsList>
        </div>
        <TabsPanel value="map" className="pt-3">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-2">
              <div className="h-[360px] overflow-hidden rounded-xl border sm:h-[440px] xl:h-auto xl:min-h-[480px] xl:flex-1">
                <RunMap summary={summary} cluster={cluster} truck={truck} onSelectCluster={setCluster} h3Resolution={hexes ? 5 : null} road={road} />
              </div>
              <RoadGeometryControl geo={geo} summary={summary} truckId={truck} />
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                <Switch checked={hexes} onCheckedChange={setHexes} />
                H3 cells (resolution 5, shaded by stop count). A map layer only; it does not change clusters.
              </label>
            </div>
            <ClusterTable summary={summary} cluster={cluster} onSelect={setCluster} onShowShipments={() => setTab("shipments")} />
          </div>
        </TabsPanel>
        <TabsPanel value="shipments" className="pt-3">
          <ShipmentTable summary={summary} clusterIndex={clusterIndex} truck={truck} onSelect={selectTruck} cluster={cluster} onClearCluster={() => setCluster(null)} runId={runId} />
        </TabsPanel>
        <TabsPanel value="timeline" className="pt-3">
          <TimelinePanel key={truck ?? ""} summary={summary} geo={geo} truckId={truck} onSelectTruck={selectTruck} />
        </TabsPanel>
        <TabsPanel value="unshipped" className="pt-3">
          <UnshippedTable summary={summary} />
        </TabsPanel>
        <TabsPanel value="stock" className="pt-3">
          <StockCoverage summary={summary} />
        </TabsPanel>
        <TabsPanel value="provenance" className="pt-3">
          <Provenance summary={summary} />
        </TabsPanel>
      </Tabs>
    </>
  )
}

/** Capacity lower bounds (spec §8a): their difference is the increase in the bound from partitioning, not proof of extra trucks. */
function BoundsNote({ total, perCluster, trucks }: { total: number; perCluster: number; trucks: number }) {
  const extra = perCluster - total
  return (
    <span title="ceil(total load ÷ trailer) and the sum of the same bound per cluster. Equality with the shipment count certifies the count, not the miles.">
      At least {total} by trailer capacity
      {extra > 0 ? `; ${perCluster} summed per cluster (+${extra} from partitioning)` : ""}
      {trucks === perCluster ? " · count at the bound" : ""}
    </span>
  )
}

function ValidityAlert({ summary, unplannedPieces }: { summary: RunSummary; unplannedPieces: number }) {
  if (summary.validity === "invalid") {
    return (
      <Alert variant="error">
        <AlertTitle>Invalid plan</AlertTitle>
        <AlertDescription>
          At least one cluster has no validated shipments, so this plan is not a complete fulfillment. Validated clusters below remain inspectable.
        </AlertDescription>
      </Alert>
    )
  }
  if (summary.coverage === "partial") {
    return (
      <Alert variant="warning">
        <AlertTitle>Validated, partial coverage</AlertTitle>
        <AlertDescription>
          Every shipment passed independent validation. {plural(unplannedPieces, "allocated piece")} could not be shipped; see Unshipped for the reason and evidence.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="success">
      <AlertTitle>{summary.coverage === "empty" ? "Nothing to ship" : "Validated, complete"}</AlertTitle>
      <AlertDescription>
        {summary.coverage === "empty" ? "No allocated stock reached a stop." : "Every allocated piece is on a validated shipment."} Shipment count and miles are heuristic best-found values, not proven optimal.
      </AlertDescription>
    </Alert>
  )
}

/** Preflight checks this run recorded. A blocked run fails before this point, so these ran as warnings. */
function PreflightNotes({ summary }: { summary: RunSummary }) {
  const found = summary.preflight ?? []
  if (!found.length) return null
  return (
    <div className="bg-card rounded-xl border p-3 text-sm">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <span className="font-medium">Preflight</span>
        <span className="text-muted-foreground text-xs">These checks were set to warn for this run, so it ran; each is recorded in the settings snapshot.</span>
      </div>
      <ul className="flex flex-col gap-1">
        {found.map((f) => (
          <li key={f.check} className="flex flex-wrap items-baseline gap-2 text-xs">
            <Badge variant="warning" size="sm">
              {preflightChecks[f.check].blocking ? "Blocking check, warned" : "Warning"}
            </Badge>
            <span className="font-medium">{preflightChecks[f.check].title}</span>
            <span className="text-muted-foreground">{f.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ClusterTable({ summary, cluster, onSelect, onShowShipments }: { summary: RunSummary; cluster: string | null; onSelect: (id: string | null) => void; onShowShipments: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cluster</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">Shipments</TableHead>
              <TableHead>Fill (avg · lowest)</TableHead>
              <TableHead className="text-right">Stops</TableHead>
              <TableHead className="text-right">Widest pair</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.clusters.map((c, i) => (
              <TableRow key={c.id} data-state={cluster === c.id ? "selected" : undefined} className="cursor-pointer" onClick={() => onSelect(cluster === c.id ? null : c.id)}>
                <TableCell>
                  <button
                    type="button"
                    className="focus-visible:ring-ring/50 flex items-center gap-2 rounded outline-none focus-visible:ring-2"
                    aria-pressed={cluster === c.id}
                    aria-label={`Cluster ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(cluster === c.id ? null : c.id)
                    }}
                  >
                    <ClusterSwatch cluster={i + 1} size="sm" />
                    {c.status !== "validated" && (
                      <Badge variant={c.status === "nothing_to_solve" ? "warning" : "error"}>
                        {c.status === "nothing_to_solve" ? (c.visit_count ? "unreachable" : "empty") : c.status.replaceAll("_", " ")}
                      </Badge>
                    )}
                  </button>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(c.planned_amount_cents, { compact: true })}</TableCell>
                <TableCell className="text-right tabular-nums">{c.trucks}</TableCell>
                <TableCell>
                  {c.avg_fill == null ? (
                    <span className="text-muted-foreground">n/a</span>
                  ) : (
                    <span className="flex items-baseline gap-1.5 text-xs">
                      <FillPercent fill={c.avg_fill} className="text-sm" />
                      <span className="text-muted-foreground">·</span>
                      <FillPercent fill={c.min_fill ?? 0} />
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.planned_visit_count}/{c.visit_count}
                </TableCell>
                <TableCell className="text-right tabular-nums">{miles(c.diameter_m)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-1">
        <FillBandLegend />
        <Button size="xs" variant="ghost" className="ml-auto" onClick={onShowShipments}>
          {cluster ? "Shipments in this cluster" : "All shipments"}
        </Button>
      </div>
      <p className="text-muted-foreground px-1 text-xs">
        {legRule()} Widest pair is a tightness measure, not a limit
        {summary.settings.max_cluster_diameter_m ? ` (the optional diameter policy is on: ${miles(summary.settings.max_cluster_diameter_m)})` : ""}.
      </p>
    </div>
  )
}

function ShipmentTable({
  summary,
  clusterIndex,
  truck,
  onSelect,
  cluster,
  onClearCluster,
  runId,
}: {
  summary: RunSummary
  clusterIndex: (id: string) => number
  truck: string | null
  onSelect: (id: string | null) => void
  cluster: string | null
  onClearCluster: () => void
  runId: string | null
}) {
  const [pagination, setPagination] = useState({ cluster, page: 0 })
  const page = pagination.cluster === cluster ? pagination.page : 0
  const setPage = (nextPage: number) => setPagination({ cluster, page: nextPage })
  const number = new Map(summary.trucks.map((x, i) => [x.id, i + 1]))
  const rows = cluster ? summary.trucks.filter((x) => x.cluster_id === cluster) : summary.trucks
  const pageCount = Math.max(1, Math.ceil(rows.length / SHIPMENT_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visibleRows = rows.slice(currentPage * SHIPMENT_PAGE_SIZE, (currentPage + 1) * SHIPMENT_PAGE_SIZE)
  const firstShown = rows.length ? currentPage * SHIPMENT_PAGE_SIZE + 1 : 0
  const lastShown = Math.min((currentPage + 1) * SHIPMENT_PAGE_SIZE, rows.length)
  const labels = new Map(summary.locations.map((l) => [l.id, l.label]))
  const selected = summary.trucks.find((x) => x.id === truck)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {cluster ? (
          <>
            <span className="flex items-center gap-1.5">
              <ClusterSwatch cluster={clusterIndex(cluster)} size="sm" /> {shipments(rows.length)} in this cluster
            </span>
            <Button size="xs" variant="ghost" onClick={onClearCluster}>
              Show all
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">{shipments(rows.length)}</span>
        )}
        <FillBandLegend className="ml-auto" />
      </div>
      <Table
        className="min-w-[48rem]"
        render={<div className="relative w-full overflow-x-auto rounded-xl border focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2" role="region" aria-label="Shipment results table" tabIndex={0} />}
      >
          <TableHeader>
            <TableRow>
              <TableHead>Shipment</TableHead>
              <TableHead>Trailer fill</TableHead>
              <TableHead>Stops</TableHead>
              <TableHead className="text-right">Linear ft</TableHead>
              <TableHead className="text-right">Loaded miles</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Sheet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.map((x) => (
              <TableRow key={x.id} data-state={truck === x.id ? "selected" : undefined} className="cursor-pointer" onClick={() => onSelect(truck === x.id ? null : x.id)}>
                <TableCell>
                  <button
                    type="button"
                    className="focus-visible:ring-ring/50 flex flex-col items-start rounded text-left outline-none focus-visible:ring-2"
                    aria-pressed={truck === x.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(truck === x.id ? null : x.id)
                    }}
                  >
                    <span className="font-medium">{shipmentLabel(number.get(x.id) ?? 0)}</span>
                    <TruckTag id={x.id} cluster={clusterIndex(x.cluster_id)} className="text-muted-foreground text-[11px] font-normal" />
                  </button>
                </TableCell>
                <TableCell>
                  <ShipmentFill fill={x.fill} size="sm" className="w-16" />
                </TableCell>
                <TableCell className="max-w-xs text-xs whitespace-normal">
                  {x.visits.length} · {labels.get(x.visits[0]?.location_id ?? "")}
                  {x.visits.length > 1 && <span className="text-muted-foreground"> → {labels.get(x.visits[x.visits.length - 1].location_id)}</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatFeet(x.load)}</TableCell>
                <TableCell className="text-right tabular-nums">{miles(x.distance_m)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(x.amount_cents)}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  {runId && (
                    <Button size="icon-xs" variant="ghost" render={<Link href={`/runs/${runId}/sheet?shipment=${encodeURIComponent(x.id)}`} aria-label={`Sheet for ${shipmentLabel(number.get(x.id) ?? 0)}`} />}>
                      <Printer />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
      </Table>
      {rows.length > SHIPMENT_PAGE_SIZE && (
        <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Shipment pages">
          <span className="text-muted-foreground text-xs tabular-nums" role="status" aria-live="polite">
            Showing {firstShown}–{lastShown} of {formatCount(rows.length)} shipments
          </span>
          <div className="flex items-center gap-2">
            <Button size="xs" variant="outline" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0}>
              Previous shipments
            </Button>
            <span className="text-muted-foreground text-xs tabular-nums">
              <span className="sr-only">Page </span>{currentPage + 1}
              <span aria-hidden> / </span><span className="sr-only"> of </span>{pageCount}
            </span>
            <Button size="xs" variant="outline" onClick={() => setPage(currentPage + 1)} disabled={currentPage + 1 === pageCount}>
              Next shipments
            </Button>
          </div>
        </nav>
      )}
      {selected ? (
        <ShipmentDetail summary={summary} truck={selected} index={number.get(selected.id) ?? 0} cluster={clusterIndex(selected.cluster_id)} runId={runId} />
      ) : (
        <p className="text-muted-foreground px-1 text-xs">Select a shipment to see its trailer and stops in visit order.</p>
      )}
    </div>
  )
}

function ShipmentDetail({ summary, truck, index, cluster, runId }: { summary: RunSummary; truck: RunSummary["trucks"][number]; index: number; cluster: number; runId: string | null }) {
  const labels = new Map(summary.locations.map((l) => [l.id, l.label]))
  return (
    <section className="bg-card space-y-3 rounded-xl border p-4" aria-label={`${shipmentLabel(index)} detail`}>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-medium">{shipmentLabel(index)}</h3>
        <TruckTag id={truck.id} cluster={cluster} className="text-muted-foreground" />
        <span className="text-muted-foreground text-xs tabular-nums">
          {plural(truck.visits.length, "stop")} · {miles(truck.distance_m)} loaded · {formatMoney(truck.amount_cents)}
        </span>
        {runId && <div className="ml-auto flex items-center gap-2">
          <Button size="xs" variant="outline" render={<Link href={`/runs/${runId}/sheet?shipment=${encodeURIComponent(truck.id)}`} />}>
            <Printer aria-hidden /> Print sheet
          </Button>
          <Button size="xs" variant="ghost" render={<a href={`/api/v1/runs/${runId}/export?format=csv&table=sheet&truck=${encodeURIComponent(truck.id)}`} download />}>
            <Download aria-hidden /> CSV
          </Button>
        </div>}
      </div>
      <TrailerFill
        cluster={cluster}
        capacity={summary.settings.trailer_capacity}
        segments={truck.visits.map((v) => ({ id: v.visit_id, load: v.load, label: labels.get(v.location_id) }))}
      />
      <ol className="divide-y text-sm">
        {truck.visits.map((v) => (
          <li key={v.visit_id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-1.5">
            <span className="text-muted-foreground font-mono text-xs tabular-nums">{v.sequence}</span>
            <span className="min-w-0">
              <span className="block truncate">{labels.get(v.location_id)}</span>
              <span className="text-muted-foreground block truncate font-mono text-[11px]">{[...new Set(v.lines.map((l) => l.order_id))].join(", ")}</span>
            </span>
            <span className="text-right font-mono text-xs tabular-nums">
              {formatFeet(v.load)} · {miles(v.leg_m)} {v.sequence === 1 ? "from depot" : "leg"}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground text-[11px]">Open route: no return to the depot.</p>
    </section>
  )
}

function UnshippedTable({ summary }: { summary: RunSummary }) {
  const [group, setGroup] = useState<UnshippedGroup | null>(null)
  const sources = new Map(summary.locations.map((l) => [l.id, l]))
  const totals = useMemo(() => {
    const out = new Map<UnshippedGroup, { lines: number; pieces: number; amount: number }>()
    for (const u of summary.unplanned) {
      const g = reasonGroup[u.reason]
      const x = out.get(g) ?? { lines: 0, pieces: 0, amount: 0 }
      x.lines++
      x.pieces += u.pieces
      x.amount += u.amount_cents
      out.set(g, x)
    }
    return out
  }, [summary])
  if (!summary.unplanned.length) return <p className="text-muted-foreground text-sm">Every ordered piece ships.</p>
  const groups = unshippedGroups.filter((g) => g.id !== "other" || totals.has("other"))
  const rows = summary.unplanned.filter((u) => !group || reasonGroup[u.reason] === group)
  return (
    <div className="flex flex-col gap-3">
      <div className={cn("grid gap-2", groups.length > 4 ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-4")}>
        {groups.map((g) => {
          const x = totals.get(g.id)
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={group === g.id}
              disabled={!x}
              title={g.hint}
              onClick={() => setGroup(group === g.id ? null : g.id)}
              className={cn(
                "bg-card hover:bg-muted/50 focus-visible:ring-ring/50 space-y-1 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 disabled:opacity-50",
                group === g.id && "border-foreground/40 bg-muted"
              )}
            >
              <div className="text-xs font-medium">{g.label}</div>
              <div className="text-lg font-semibold tracking-tight tabular-nums">{formatMoney(x?.amount ?? 0, { compact: true })}</div>
              <div className="text-muted-foreground text-[11px] tabular-nums">
                {formatCount(x?.lines ?? 0)} lines · {formatCount(x?.pieces ?? 0)} pcs
              </div>
            </button>
          )
        })}
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table render={<div role="region" aria-label="Unshipped lines table" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />}>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Pieces</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => {
              const loc = sources.get(u.location_id)
              return (
                <TableRow key={`${u.line_id}-${u.reason}`} className="align-top">
                  <TableCell className="font-mono text-xs">
                    {u.line_id}
                    <span className="text-muted-foreground block text-[10px]">order {u.order_id}</span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {loc?.label ?? u.location_id}
                    {loc && <CoordinateSourceFlag source={loc.coordinate_source} className="mt-1 flex w-fit" />}
                  </TableCell>
                  <TableCell className="text-xs">{u.product_id}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.pieces}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(u.amount_cents)}</TableCell>
                  <TableCell>
                    <Badge variant={u.reason === "stock_shortage" ? "outline" : "warning"}>{reasonLabel[u.reason]}</Badge>
                    <div className="text-muted-foreground mt-1 text-[11px]">step: {u.stage}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-sm text-xs whitespace-normal">{u.evidence}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function StockCoverage({ summary }: { summary: RunSummary }) {
  const rows: StockRow[] = summary.products.map((p) => {
    const short = summary.unplanned.filter((u) => u.product_id === p.product_id && u.reason === "stock_shortage")
    return {
      product: { id: p.product_id, label: p.label, sku: p.product_id },
      ordered: p.ordered,
      stock: p.starting_inventory,
      allocated: p.allocated,
      excluded: p.excluded,
      shortAmount: short.reduce((s, u) => s + u.amount_cents, 0),
      shortedOrders: [...new Set(short.map((u) => u.order_id))].sort(),
    }
  })
  return (
    <div className="flex flex-col gap-2">
      <StockTable rows={rows} />
      <p className="text-muted-foreground text-xs">
        Fill rate is allocated ÷ ordered pieces (N/A when nothing was ordered). Pieces reconcile per product: ordered = excluded + short + allocated;
        allocated = shipped + allocated-unshipped; on hand = allocated + left in stock. Allocation is an experiment against a stock snapshot, not a
        reservation. The details button has on-hand vs ordered and dollars short.
      </p>
    </div>
  )
}

/** Strategy, policy and run time (spec §8). Runs before M5 have no record. */
function allocationProvenance(summary: RunSummary) {
  const a = summary.allocation
  if (!a) return `${allocationSettingsLabel(summary.settings)} (run predates allocation provenance)`
  return `${allocationSettingsLabel(summary.settings)}; deterministic heuristic, ${a.runtime_s.toFixed(2)} s`
}

function Provenance({ summary }: { summary: RunSummary }) {
  const s = summary.settings
  const policy = s.preflight
  const rows: [string, string][] = [
    [
      "Objective",
      s.objective === "trucks_then_distance"
        ? `Fewest trucks, then fewest miles (derived penalty F = n·L + 1 per cluster). ${COST_FALLBACK}`
        : s.objective === "cost"
          ? `Lowest cost: ${formatMoney(s.cost_per_truck_cents ?? 0)} per truck, ${formatMoney(s.cost_per_mile_cents ?? 0)} per mile`
          : `Weighted distance (${s.weighted_truck_penalty_m} m per truck)`,
    ],
    ["Allocation", allocationProvenance(summary)],
    ["Trailer", `${formatFeet(s.trailer_capacity, 0)}, linear feet only, open routes`],
    [
      "Travel",
      summary.travel && summary.travel.mode !== "estimated"
        ? "Recorded travel matrix (an older version of Fillrate)"
        : `Estimated: haversine × ${s.travel_circuity} at a constant speed`,
    ],
    ["Max single drive", `${miles(s.max_leg_m)}, including depot → first stop (not the return)`],
    ["Cluster diameter", s.max_cluster_diameter_m ? `Optional policy on: ${miles(s.max_cluster_diameter_m)} widest pair (haversine × ${s.cluster_circuity})` : "Off (optional policy)"],
    [
      "Preflight",
      policy
        ? `No coordinates: ${policy.missing_coordinates} · no route within 500 mi per drive: ${policy.far_from_depot} · stop over one trailer: ${policy.oversize_stop} · placed by ZIP only: ${policy.approximate_coordinates ?? "warn"} · reached through another stop: warn`
        : "Not recorded",
    ],
    ["Excluded by user", s.excluded_line_ids?.length ? plural(s.excluded_line_ids.length, "line") : "none"],
    ["Clustering", `k-means on 3D unit vectors, seed ${s.kmeans_seed}, n_init ${s.kmeans_n_init}; ${summary.clustering.fits} fits${summary.clustering.repairs.length ? `, ${summary.clustering.repairs.length} repairs` : ""}`],
    ["Solver", `PyVRP ${summary.versions.pyvrp}, seed ${s.solver_seed}, ${s.solver_max_iterations ? `${s.solver_max_iterations} iterations or ` : ""}${s.solver_time_limit_s} s per cluster`],
    ["Display", `Low fill under ${formatPercent(FILL_LOW)} (display setting, never sent to the solver)`],
    ["Versions", Object.entries(summary.versions).map(([k, v]) => `${k} ${v}`).join(" · ")],
  ]
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border p-4 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {summary.diagnostics.map((d) => (
          <div key={d.code} className="contents">
            <dt className="text-muted-foreground">Note</dt>
            <dd>{d.message}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
