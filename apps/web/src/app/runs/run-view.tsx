"use client"

import type { RunSummary } from "@fillrate/contracts"
import { ArrowLeft, Ban, Check, Download } from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect, useState } from "react"

import { JobStatusBadge, type JobState } from "@/components/lab/job-status"
import { ClusterSwatch, TruckTag } from "@/components/lab/route-swatch"
import { StatTile } from "@/components/lab/stat-tile"
import { FillMeter, FillPercent } from "@/components/lab/trailer-fill"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { toastManager } from "@/components/ui/toast"
import type { RunDetail } from "@/lib/server/runs"
import { formatCount, formatFeet, formatMiles, formatMoney, formatPercent, plural } from "@/lib/units"
import { cn } from "@/lib/utils"

const RunMap = dynamic(() => import("./run-map"), { ssr: false, loading: () => <div className="bg-muted/40 h-full animate-pulse" /> })

const STAGES = ["preflight", "allocation", "aggregation", "clustering", "travel", "solve", "validation", "summary"] as const
const ACTIVE = new Set(["queued", "claimed", "running"])
const miles = (m: number) => formatMiles(m / 1609.344)

const REASONS: Record<RunSummary["unplanned"][number]["reason"], string> = {
  excluded_unresolved_coordinates: "No coordinates",
  oversize_piece: "Piece longer than a trailer",
  stock_shortage: "Stock shortage",
  unreachable: "Unreachable",
  unreachable_in_partition: "Unreachable in its cluster",
  candidate_invalid: "Failed validation",
  no_valid_candidate: "No valid load found",
}

// Polls the run every 2 s while it is active (5 s after the first minute), pausing while the tab is hidden.
function useRun(initial: RunDetail) {
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
          const next = (await res.json()) as RunDetail
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

export function RunView({ initial, canCancel, runKey }: { initial: RunDetail; canCancel: boolean; runKey?: string }) {
  const [run, setRun] = useRun(initial)
  const [cancelling, setCancelling] = useState(false)
  const active = ACTIVE.has(run.status)
  const listHref = `/runs${runKey ? `?key=${encodeURIComponent(runKey)}` : ""}`

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
          Attempt {run.attempt} of {run.max_attempts} · k {run.settings.k ?? "auto"} · solver seed {run.settings.solver_seed}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {active && canCancel && !run.cancel_requested && (
            <Button variant="destructive-outline" size="sm" onClick={cancel} loading={cancelling}>
              <Ban aria-hidden /> Cancel
            </Button>
          )}
          {run.status === "succeeded" && <ExportMenu id={run.id} />}
        </div>
      </div>

      {active && <Progress run={run} />}
      {run.status === "failed" && (
        <Alert variant="error">
          <AlertTitle>Run failed: {String(run.failure?.code ?? "error")}</AlertTitle>
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

function ExportMenu({ id }: { id: string }) {
  const href = (q: string) => `/api/v1/runs/${id}/export?${q}`
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="sm" />}>
        <Download aria-hidden /> Export
      </MenuTrigger>
      <MenuPopup align="end">
        {[
          ["format=json", "Run JSON (inputs, stages, results)"],
          ["format=csv&table=loads", "Truck loads CSV"],
          ["format=csv&table=unplanned", "Unplanned lines CSV"],
          ["format=csv&table=clusters", "Clusters CSV"],
          ["format=csv&table=products", "Product reconciliation CSV"],
        ].map(([q, label]) => (
          <MenuItem key={q} render={<a href={href(q)} download />}>
            {label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  )
}

function Progress({ run }: { run: RunDetail }) {
  const stage = String(run.progress?.stage ?? "")
  const current = STAGES.indexOf(stage as (typeof STAGES)[number])
  return (
    <ol className="bg-card flex flex-wrap gap-x-5 gap-y-2 rounded-xl border p-4 text-sm" aria-label="Pipeline progress">
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

function Results({ summary, run }: { summary: RunSummary; run: RunDetail }) {
  const [cluster, setCluster] = useState<string | null>(null)
  const [truck, setTruck] = useState<string | null>(null)
  const t = summary.totals
  const unplannedPieces = summary.products.reduce((n, p) => n + p.allocated_unplanned, 0)
  const clusterIndex = (id: string | null | undefined) => (id ? summary.clusters.findIndex((c) => c.id === id) + 1 : 0)

  return (
    <>
      <ValidityAlert summary={summary} unplannedPieces={unplannedPieces} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Planned revenue" value={formatMoney(t.planned_cents, { compact: true })} footnote={`of ${formatMoney(t.allocated_cents, { compact: true })} allocated · ${formatMoney(t.ordered_cents, { compact: true })} ordered`} />
        <StatTile label="Trucks" value={formatCount(t.trucks)} footnote={`Capacity lower bound ${t.capacity_lower_bound} (sum per cluster ${t.sum_cluster_lower_bounds})`} />
        <StatTile label="Average fill" value={t.avg_fill == null ? "n/a" : formatPercent(t.avg_fill)} footnote={t.min_fill == null ? undefined : `Lowest truck ${formatPercent(t.min_fill)}`} />
        <StatTile label="Loaded miles" value={miles(t.loaded_distance_m)} footnote={`Estimated: haversine × ${summary.settings.travel_circuity}, open routes`} />
        <StatTile label="Clusters" value={formatCount(summary.clustering.effective_cluster_count)} footnote={summary.clustering.requested_k ? `k = ${summary.clustering.requested_k} (fixed)` : `Auto k = ${summary.clustering.selected_k ?? 0}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="h-[420px] overflow-hidden rounded-xl border lg:h-auto lg:min-h-[480px]">
          <RunMap summary={summary} cluster={cluster} truck={truck} onSelectCluster={setCluster} />
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cluster</TableHead>
                <TableHead className="text-right">Stops</TableHead>
                <TableHead className="text-right">Trucks</TableHead>
                <TableHead>Fill (average, lowest)</TableHead>
                <TableHead className="text-right">Widest pair</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.clusters.map((c, i) => (
                <TableRow
                  key={c.id}
                  data-state={cluster === c.id ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => setCluster(cluster === c.id ? null : c.id)}
                >
                  <TableCell>
                    <button type="button" className="flex items-center gap-2" aria-pressed={cluster === c.id}>
                      <ClusterSwatch cluster={i + 1} size="sm" />
                      {c.status !== "validated" && (
                        <Badge variant={c.status === "nothing_to_solve" ? "warning" : "error"}>
                          {c.status === "nothing_to_solve" ? (c.visit_count ? "unreachable" : "empty") : c.status.replaceAll("_", " ")}
                        </Badge>
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.planned_visit_count}/{c.visit_count}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.trucks}
                    <span className="text-muted-foreground"> / ≥{c.capacity_lower_bound}</span>
                  </TableCell>
                  <TableCell>
                    {c.avg_fill == null ? (
                      <span className="text-muted-foreground">n/a</span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <FillMeter fill={c.avg_fill} className="w-24" />
                        <span className="text-muted-foreground text-xs">min</span> <FillPercent fill={c.min_fill ?? 0} />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{miles(c.diameter_m)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(c.planned_amount_cents, { compact: true })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Tabs defaultValue="trucks">
        <TabsList>
          <TabsTab value="trucks">Truck loads ({summary.trucks.length})</TabsTab>
          <TabsTab value="unplanned">Unplanned ({summary.unplanned.length})</TabsTab>
          <TabsTab value="products">Products</TabsTab>
          <TabsTab value="provenance">Provenance</TabsTab>
        </TabsList>
        <TabsPanel value="trucks" className="pt-3">
          <TruckTable summary={summary} clusterIndex={clusterIndex} truck={truck} onSelect={setTruck} cluster={cluster} />
        </TabsPanel>
        <TabsPanel value="unplanned" className="pt-3">
          <UnplannedTable summary={summary} />
        </TabsPanel>
        <TabsPanel value="products" className="pt-3">
          <ProductTable summary={summary} />
        </TabsPanel>
        <TabsPanel value="provenance" className="pt-3">
          <Provenance summary={summary} run={run} />
        </TabsPanel>
      </Tabs>
    </>
  )
}

function ValidityAlert({ summary, unplannedPieces }: { summary: RunSummary; unplannedPieces: number }) {
  if (summary.validity === "invalid") {
    return (
      <Alert variant="error">
        <AlertTitle>Invalid plan</AlertTitle>
        <AlertDescription>
          At least one cluster has no validated loads, so this plan is not a complete fulfillment. Validated clusters below remain inspectable.
        </AlertDescription>
      </Alert>
    )
  }
  if (summary.coverage === "partial") {
    return (
      <Alert variant="warning">
        <AlertTitle>Validated, partial coverage</AlertTitle>
        <AlertDescription>
          Every truck passed independent validation. {plural(unplannedPieces, "allocated piece")} could not be planned; see Unplanned for the reason and evidence.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="success">
      <AlertTitle>{summary.coverage === "empty" ? "Nothing to ship" : "Validated, complete"}</AlertTitle>
      <AlertDescription>
        {summary.coverage === "empty" ? "No allocated stock reached a stop." : "Every allocated piece is on a validated truck."} Truck count and miles are heuristic best-found values, not proven optimal.
      </AlertDescription>
    </Alert>
  )
}

function TruckTable({ summary, clusterIndex, truck, onSelect, cluster }: { summary: RunSummary; clusterIndex: (id: string) => number; truck: string | null; onSelect: (id: string | null) => void; cluster: string | null }) {
  const trucks = cluster ? summary.trucks.filter((t) => t.cluster_id === cluster) : summary.trucks
  const labels = new Map(summary.locations.map((l) => [l.id, l.label]))
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Truck</TableHead>
            <TableHead>Stops in order</TableHead>
            <TableHead>Fill</TableHead>
            <TableHead className="text-right">Load</TableHead>
            <TableHead className="text-right">Loaded miles</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trucks.map((t) => (
            <TableRow key={t.id} data-state={truck === t.id ? "selected" : undefined} className="cursor-pointer align-top" onClick={() => onSelect(truck === t.id ? null : t.id)}>
              <TableCell>
                <TruckTag id={t.id} cluster={clusterIndex(t.cluster_id)} />
              </TableCell>
              <TableCell className="max-w-md whitespace-normal">
                <ol className="flex flex-col gap-0.5 text-xs">
                  {t.visits.map((v) => (
                    <li key={v.visit_id}>
                      <span className="text-muted-foreground tabular-nums">{v.sequence}.</span> {labels.get(v.location_id)}{" "}
                      <span className="text-muted-foreground">
                        ({v.lines.map((l) => `${l.pieces}× ${l.product_id}`).join(", ")}; {miles(v.leg_m)} leg)
                      </span>
                    </li>
                  ))}
                </ol>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-2">
                  <FillMeter fill={t.fill} className="w-24" />
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatFeet(t.load)}</TableCell>
              <TableCell className="text-right tabular-nums">{miles(t.distance_m)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(t.amount_cents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function UnplannedTable({ summary }: { summary: RunSummary }) {
  if (!summary.unplanned.length) return <p className="text-muted-foreground text-sm">Every ordered piece is planned.</p>
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Line</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="text-right">Pieces</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Evidence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.unplanned.map((u) => (
            <TableRow key={`${u.line_id}-${u.reason}`} className="align-top">
              <TableCell className="font-mono text-xs">{u.line_id}</TableCell>
              <TableCell className="text-xs">{u.product_id}</TableCell>
              <TableCell className="text-right tabular-nums">{u.pieces}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(u.amount_cents)}</TableCell>
              <TableCell>
                <Badge variant={u.reason === "stock_shortage" ? "outline" : "warning"}>{REASONS[u.reason]}</Badge>
                <div className="text-muted-foreground mt-1 text-[11px]">stage: {u.stage}</div>
              </TableCell>
              <TableCell className="text-muted-foreground max-w-sm text-xs whitespace-normal">{u.evidence}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ProductTable({ summary }: { summary: RunSummary }) {
  const cols = [
    ["Ordered", "ordered"],
    ["Excluded", "excluded"],
    ["Short (not allocated)", "unselected"],
    ["Allocated", "allocated"],
    ["Planned", "planned"],
    ["Allocated, unplanned", "allocated_unplanned"],
    ["Stock at start", "starting_inventory"],
    ["Residual stock", "residual"],
  ] as const
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              {cols.map(([label]) => (
                <TableHead key={label} className="text-right">
                  {label}
                </TableHead>
              ))}
              <TableHead className="text-right">Planned revenue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.products.map((p) => (
              <TableRow key={p.product_id}>
                <TableCell>{p.label}</TableCell>
                {cols.map(([label, key]) => (
                  <TableCell key={label} className="text-right tabular-nums">
                    {formatCount(p[key])}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">{formatMoney(p.planned_cents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground text-xs">
        Pieces reconcile per product: ordered = excluded + short + allocated; allocated = planned + allocated-unplanned; stock at start = allocated + residual. Allocation is an experiment against a stock snapshot, not a reservation.
      </p>
    </div>
  )
}

function Provenance({ summary, run }: { summary: RunSummary; run: RunDetail }) {
  const s = summary.settings
  const rows: [string, string][] = [
    ["Objective", s.objective === "trucks_then_distance" ? "Fewest trucks, then fewest miles (derived penalty F = n·L + 1 per cluster)" : `Weighted distance (${s.weighted_truck_penalty_m} m per truck)`],
    ["Trailer", `${formatFeet(s.trailer_capacity, 0)}, linear feet only, open routes`],
    ["Leg limit", `${miles(s.max_leg_m)} per physical leg (not the return)`],
    ["Cluster diameter", `${miles(s.max_cluster_diameter_m)} widest pair (haversine × ${s.cluster_circuity})`],
    ["Clustering", `k-means on 3D unit vectors, seed ${s.kmeans_seed}, n_init ${s.kmeans_n_init}; ${summary.clustering.fits} fits${summary.clustering.repairs.length ? `, ${summary.clustering.repairs.length} repairs` : ""}`],
    ["Solver", `PyVRP ${summary.versions.pyvrp}, seed ${s.solver_seed}, ${s.solver_max_iterations ? `${s.solver_max_iterations} iterations or ` : ""}${s.solver_time_limit_s} s per cluster`],
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
              <TableHead>Stage artifact</TableHead>
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
