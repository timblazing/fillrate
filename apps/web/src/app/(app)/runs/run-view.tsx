"use client"

import type { RunSummary } from "@fillrate/contracts"
import { ArrowLeft, Ban, Check, Download, Printer } from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

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
import { allocationObjectiveLabel, allocationSettingsLabel, COST_FALLBACK, cpSatStatusLabel, legRule, preflightChecks, reasonGroup, reasonLabel, shipmentLabel, shipments, type UnshippedGroup, unshippedGroups } from "@/lib/copy"
import type { RunDetail } from "@/lib/server/runs"
import { METERS_PER_MILE } from "@/lib/shipment-sheet"
import { FILL_LOW, fillBand, formatCount, formatFeet, formatMiles, formatMoney, formatPercent, plural } from "@/lib/units"
import { cn } from "@/lib/utils"

import { TimelinePanel } from "./timeline-panel"

const RunMap = dynamic(() => import("./run-map"), { ssr: false, loading: () => <div className="bg-muted/40 h-full animate-pulse" /> })

const STAGES = ["preflight", "allocation", "aggregation", "clustering", "travel", "solve", "validation", "summary"] as const
const ACTIVE = new Set(["queued", "claimed", "running"])
const miles = (m: number) => formatMiles(m / METERS_PER_MILE)

type PipelineDetail = Extract<RunDetail, { kind: "pipeline" }>

const strategyLabel = (summary: RunSummary) =>
  summary.clustering.strategy === "h3" ? `H3 cells · resolution ${summary.clustering.h3_resolution}`
  : summary.clustering.strategy === "none" ? "No clustering (baseline)"
  : summary.clustering.requested_k ? `k = ${summary.clustering.requested_k} (fixed)` : `Auto k = ${summary.clustering.selected_k ?? 0}`

// Polls the run every 2 s while it is active (5 s after the first minute), pausing while the tab is hidden.
function useRun(initial: PipelineDetail) {
  const [run, setRun] = useState(initial)
  useEffect(() => {
    if (!ACTIVE.has(run.status) && !run.cancel_requested) return
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
  }, [initial.id, run.status, run.cancel_requested])
  return [run, setRun] as const
}

export function RunView({ initial, canCancel, runKey }: { initial: PipelineDetail; canCancel: boolean; runKey?: string }) {
  const [run, setRun] = useRun(initial)
  const [cancelling, setCancelling] = useState(false)
  const active = ACTIVE.has(run.status)
  const listHref = `/runs${runKey ? `?key=${encodeURIComponent(runKey)}` : ""}`
  const failureCode = String(run.failure?.code ?? "error")

  async function cancel() {
    setCancelling(true)
    const res = await fetch(`/api/v1/runs/${run.id}/cancel`, { method: "POST", headers: runKey ? { "x-run-key": runKey } : {} })
    const body = await res.json()
    if (res.ok) setRun(body)
    else toastManager.add({ type: "error", title: "Could not cancel", description: body.error?.message })
    setCancelling(false)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon-sm" render={<Link href={listHref} aria-label="All runs" />}>
          <ArrowLeft />
        </Button>
        <h1 className="font-mono text-lg font-semibold">Run {run.id.slice(0, 8)}</h1>
        <JobStatusBadge state={run.status as JobState} />
        {run.cancel_requested && active && <Badge variant="warning">Cancelling…</Badge>}
        <span className="text-muted-foreground text-xs tabular-nums">
          Attempt {run.attempt} of {run.max_attempts} · {run.settings.cluster_strategy === "kmeans" ? `k ${run.settings.k ?? "auto"}` : run.settings.cluster_strategy === "h3" ? `H3 r${run.settings.h3_resolution}` : "no clustering"} · solver seed {run.settings.solver_seed}
          {run.settings.inventory_percent !== 100 && ` · inventory ${run.settings.inventory_percent}%`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {active && canCancel && !run.cancel_requested && (
            <Button variant="destructive-outline" size="sm" onClick={cancel} loading={cancelling}>
              <Ban aria-hidden /> Cancel
            </Button>
          )}
          {run.status === "succeeded" && (
            <>
              <Button variant="outline" size="sm" render={<Link href={`/runs/${run.id}/sheet`} />}>
                <Printer aria-hidden /> Shipment sheets
              </Button>
              <ExportMenu id={run.id} hasMatrix={run.summary?.travel?.mode === "snapshot"} />
            </>
          )}
        </div>
      </div>

      {active && (
        <StepsPanel>
          <Progress run={run} />
        </StepsPanel>
      )}
      {run.status === "failed" && (
        <Alert variant="error">
          <AlertTitle>{failureCode === "preflight_blocked" ? "Blocked by preflight checks" : `Run failed: ${failureCode}`}</AlertTitle>
          <AlertDescription>{String(run.failure?.message ?? "The worker reported a failure.")}</AlertDescription>
        </Alert>
      )}
      {run.status === "cancelled" && (
        <Alert>
          <AlertTitle>Cancelled</AlertTitle>
          <AlertDescription>The solver process was stopped. Nothing from this run is counted as planned.</AlertDescription>
        </Alert>
      )}
      {run.status === "interrupted" && (
        <Alert variant="warning">
          <AlertTitle>Interrupted</AlertTitle>
          <AlertDescription>The worker stopped responding on every attempt ({run.max_attempts}). Start a new run.</AlertDescription>
        </Alert>
      )}
      {run.summary && <Results summary={run.summary} run={run} />}
    </>
  )
}

function ExportMenu({ id, hasMatrix }: { id: string; hasMatrix: boolean }) {
  const href = (q: string) => `/api/v1/runs/${id}/export?${q}`
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" />}>
        <Download aria-hidden /> Export
      </MenuTrigger>
      <MenuPopup align="end">
        {[
          ["format=json", "Run JSON (inputs, stages, results)"],
          ["format=csv&table=sheet", "Shipment sheets CSV"],
          ["format=csv&table=loads", "Shipment lines CSV (loads)"],
          ["format=csv&table=unplanned", "Unshipped lines CSV (unplanned)"],
          ["format=csv&table=clusters", "Clusters CSV"],
          ["format=csv&table=products", "Stock reconciliation CSV"],
          ["format=geojson", "GeoJSON routes (schematic lines)"],
          ...(hasMatrix ? [["format=matrix&as=csv", "Travel matrix CSV"], ["format=matrix&as=json", "Travel matrix JSON (with node binding)"]] : []),
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
  const stage = String(run.progress?.stage ?? "")
  const current = STAGES.indexOf(stage as (typeof STAGES)[number])
  return (
    <ol className="bg-card flex flex-wrap gap-x-5 gap-y-2 rounded-xl border p-4 text-sm" aria-label="Pipeline steps">
      {STAGES.map((s, i) => (
        <li key={s} className={cn("flex items-center gap-1.5 capitalize", i > current && "text-muted-foreground", i === current && "font-medium")}>
          {i < current ? <Check className="text-success-foreground size-3.5" aria-hidden /> : <span className={cn("size-2 rounded-full", i === current ? "bg-info animate-pulse motion-reduce:animate-none" : "bg-muted-foreground/40")} />}
          {s}
          {s === "solve" && i === current && run.progress?.of ? (
            <span className="text-muted-foreground tabular-nums">
              {String(run.progress.index)}/{String(run.progress.of)}
            </span>
          ) : null}
        </li>
      ))}
      {run.status === "queued" && <li className="text-muted-foreground ml-auto">Waiting for a worker…</li>}
    </ol>
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
    ["Travel", `× ${summary.settings.travel_circuity}`, "haversine miles"],
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

function Results({ summary, run }: { summary: RunSummary; run: PipelineDetail }) {
  const [cluster, setCluster] = useState<string | null>(null)
  const [hexes, setHexes] = useState(false)
  const [truck, setTruck] = useState<string | null>(null)
  const [tab, setTab] = useState("map")
  const t = summary.totals
  const unplannedPieces = summary.products.reduce((n, p) => n + p.allocated_unplanned, 0)
  const clusterIndex = (id: string | null | undefined) => (id ? summary.clusters.findIndex((c) => c.id === id) + 1 : 0)
  const unshippedAmount = summary.unplanned.reduce((s, u) => s + u.amount_cents, 0)
  const lowCount = summary.trucks.filter((x) => fillBand(x.fill) === "low").length
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
        <StatTile label="Loaded miles" value={miles(t.loaded_distance_m)} footnote={`Estimated: haversine × ${summary.settings.travel_circuity}, open routes`} />
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
                <RunMap summary={summary} cluster={cluster} truck={truck} onSelectCluster={setCluster} h3Resolution={hexes ? 5 : null} />
              </div>
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                <Switch checked={hexes} onCheckedChange={setHexes} />
                H3 cells (resolution 5, shaded by stop count). A map layer only; it does not change clusters.
              </label>
            </div>
            <ClusterTable summary={summary} cluster={cluster} onSelect={setCluster} onShowShipments={() => setTab("shipments")} />
          </div>
        </TabsPanel>
        <TabsPanel value="shipments" className="pt-3">
          <ShipmentTable summary={summary} clusterIndex={clusterIndex} truck={truck} onSelect={selectTruck} cluster={cluster} onClearCluster={() => setCluster(null)} runId={run.id} />
        </TabsPanel>
        <TabsPanel value="timeline" className="pt-3">
          <TimelinePanel summary={summary} />
        </TabsPanel>
        <TabsPanel value="unshipped" className="pt-3">
          <UnshippedTable summary={summary} />
        </TabsPanel>
        <TabsPanel value="stock" className="pt-3">
          <StockCoverage summary={summary} />
        </TabsPanel>
        <TabsPanel value="provenance" className="pt-3">
          <Provenance summary={summary} run={run} />
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
  runId: string
}) {
  const number = new Map(summary.trucks.map((x, i) => [x.id, i + 1]))
  const rows = cluster ? summary.trucks.filter((x) => x.cluster_id === cluster) : summary.trucks
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
      <div className="overflow-x-auto rounded-xl border">
        <Table>
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
            {rows.map((x) => (
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
                  <Button size="icon-xs" variant="ghost" render={<Link href={`/runs/${runId}/sheet?shipment=${encodeURIComponent(x.id)}`} aria-label={`Sheet for ${shipmentLabel(number.get(x.id) ?? 0)}`} />}>
                    <Printer />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {selected ? (
        <ShipmentDetail summary={summary} truck={selected} index={number.get(selected.id) ?? 0} cluster={clusterIndex(selected.cluster_id)} runId={runId} />
      ) : (
        <p className="text-muted-foreground px-1 text-xs">Select a shipment to see its trailer and stops in visit order.</p>
      )}
    </div>
  )
}

function ShipmentDetail({ summary, truck, index, cluster, runId }: { summary: RunSummary; truck: RunSummary["trucks"][number]; index: number; cluster: number; runId: string }) {
  const labels = new Map(summary.locations.map((l) => [l.id, l.label]))
  return (
    <section className="bg-card space-y-3 rounded-xl border p-4" aria-label={`${shipmentLabel(index)} detail`}>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-medium">{shipmentLabel(index)}</h3>
        <TruckTag id={truck.id} cluster={cluster} className="text-muted-foreground" />
        <span className="text-muted-foreground text-xs tabular-nums">
          {plural(truck.visits.length, "stop")} · {miles(truck.distance_m)} loaded · {formatMoney(truck.amount_cents)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="xs" variant="outline" render={<Link href={`/runs/${runId}/sheet?shipment=${encodeURIComponent(truck.id)}`} />}>
            <Printer aria-hidden /> Print sheet
          </Button>
          <Button size="xs" variant="ghost" render={<a href={`/api/v1/runs/${runId}/export?format=csv&table=sheet&truck=${encodeURIComponent(truck.id)}`} download />}>
            <Download aria-hidden /> CSV
          </Button>
        </div>
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
        <Table>
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

/** Strategy, policy and, for CP-SAT, each stage's own status (spec §8). Runs before M5 have no record. */
function allocationProvenance(summary: RunSummary) {
  const a = summary.allocation
  if (!a) return `${allocationSettingsLabel(summary.settings)} (run predates allocation provenance)`
  const head = `${allocationSettingsLabel(summary.settings)}; ${a.kind === "cp_sat" ? "OR-Tools CP-SAT" : "deterministic heuristic"}, ${a.runtime_s.toFixed(2)} s`
  const value = (st: (typeof a.stages)[number], n: number) => (st.objective === "revenue_cents" ? formatMoney(n) : formatCount(n))
  const stages = a.stages.map((st, i) => `stage ${i + 1} ${allocationObjectiveLabel[st.objective].toLowerCase()}: ${cpSatStatusLabel[st.status]}${st.bound != null && st.status !== "optimal" ? ` (best ${value(st, st.value)}, bound ${value(st, st.bound)})` : ""}, ${st.runtime_s.toFixed(2)} s`)
  return [head, ...stages, ...a.notes].join(". ")
}

function Provenance({ summary, run }: { summary: RunSummary; run: PipelineDetail }) {
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
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Step artifact</TableHead>
              <TableHead>Output hash</TableHead>
              <TableHead>Parents</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {run.stages.map((a) => (
              <TableRow key={a.stage}>
                <TableCell className="capitalize">{a.stage}</TableCell>
                <TableCell className="font-mono text-xs">{a.output_hash.slice(0, 12)}</TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">{a.parent_hashes.map((h) => h.slice(0, 6)).join(" ")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
