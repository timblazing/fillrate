"use client"

import type { LabInstance, LabResult } from "@fillrate/contracts"
import { ArrowLeft, Download, FileCode, X } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { JobStatusBadge, type JobState } from "@/components/lab/job-status"
import { LabPlot } from "@/components/lab/lab-plot"
import { StatTile } from "@/components/lab/stat-tile"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toastManager } from "@/components/ui/toast"
import type { LabRunDetail } from "@/lib/server/lab"

const ACTIVE = new Set(["queued", "claimed", "running"])
const n = (value: number) => value.toLocaleString("en-US")
const pct = (value: number) => `${Math.round(value * 100)}%`

function usePolled(initial: LabRunDetail) {
  const [run, setRun] = useState(initial)
  useEffect(() => {
    if (!ACTIVE.has(run.status)) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!document.hidden) {
        const res = await fetch(`/api/v1/lab/runs/${initial.id}`, { cache: "no-store" }).catch(() => null)
        if (res?.ok && !stopped) {
          const next = (await res.json()) as LabRunDetail
          setRun(next)
          if (!ACTIVE.has(next.status)) return
        }
      }
      if (!stopped) timer = setTimeout(tick, 2_000)
    }
    timer = setTimeout(tick, 1_000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [initial.id, run.status])
  return [run, setRun] as const
}

export function LabRunView({ initial, canCancel, observations, runKey }: { initial: LabRunDetail; canCancel: boolean; observations: string[]; runKey?: string }) {
  const [run, setRun] = usePolled(initial)
  const [cancelling, setCancelling] = useState(false)
  const instance = run.instance
  const keyQuery = runKey ? `?key=${encodeURIComponent(runKey)}` : ""

  async function cancel() {
    setCancelling(true)
    const res = await fetch(`/api/v1/lab/runs/${run.id}/cancel`, { method: "POST", headers: runKey ? { "x-run-key": runKey } : {} })
    const body = await res.json()
    setCancelling(false)
    if (!res.ok) return toastManager.add({ type: "error", title: "Not cancelled", description: body.error?.message })
    setRun(body as LabRunDetail)
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon-sm" render={<Link href={`/labs${run.example ? `?example=${run.example}${runKey ? `&key=${encodeURIComponent(runKey)}` : ""}` : keyQuery}`} aria-label="Back to Solver Lab" />}>
          <ArrowLeft />
        </Button>
        <h1 className="text-lg font-semibold">Lab run <span className="font-mono">{run.id.slice(0, 8)}</span></h1>
        <JobStatusBadge state={run.status as JobState} />
        {run.cancel_requested && ACTIVE.has(run.status) && <Badge variant="warning">Cancellation requested</Badge>}
        {canCancel && ACTIVE.has(run.status) && !run.cancel_requested && (
          <Button variant="outline" size="sm" onClick={cancel} loading={cancelling}>
            <X aria-hidden /> Cancel
          </Button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" render={<a href={`/api/v1/lab/runs/${run.id}/export?format=json${runKey ? `&key=${encodeURIComponent(runKey)}` : ""}`} download />}>
            <Download aria-hidden /> JSON
          </Button>
          {run.result && (
            <Button variant="outline" size="sm" render={<a href={`/api/v1/lab/runs/${run.id}/export?format=python${runKey ? `&key=${encodeURIComponent(runKey)}` : ""}`} download />}>
              <FileCode aria-hidden /> Python
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{instance.name}</span>
        <Badge variant="outline">{instance.coordinates === "planar" ? "Planar, abstract units" : "Geographic"}</Badge>
        <span className="text-muted-foreground text-xs tabular-nums">
          {instance.clients.length} clients · {instance.dimensions.map((d) => `${d.id} (${d.unit})`).join(", ")} · {instance.vehicle_types.map((v) => `${v.count} × ${v.id}`).join(", ")}
          {" · "}seed {instance.solver?.seed ?? 0}, {instance.solver?.max_iterations ? `${n(instance.solver.max_iterations)} iterations` : "runtime budget"}
        </span>
      </div>
      {ACTIVE.has(run.status) && (
        <p className="bg-card rounded-xl border p-4 text-sm" role="status">
          {run.status === "queued" ? "Waiting for a worker…" : `Solving (${String(run.progress?.stage ?? "starting")})…`}
        </p>
      )}
      {run.status === "failed" && (
        <Alert variant="error">
          <AlertTitle>{String(run.failure?.code ?? "Lab run failed")}</AlertTitle>
          <AlertDescription className="break-words">{String(run.failure?.message ?? "The worker reported a failure.")}</AlertDescription>
        </Alert>
      )}
      {run.status === "cancelled" && <p className="text-muted-foreground text-sm">Cancelled. No result was stored.</p>}
      {run.result ? <Result instance={instance} result={run.result} observations={observations} /> : <LabPlot instance={instance} result={null} className="max-w-xl" />}
    </>
  )
}

function Result({ instance, result, observations }: { instance: LabInstance; result: LabResult; observations: string[] }) {
  const dims = instance.dimensions.map((d) => d.id)
  const capacity = new Map(instance.vehicle_types.map((v) => [v.id, v.capacity]))
  const u = result.units
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2" data-testid="lab-validation">
        <Badge variant={result.validated_feasible ? "success" : "error"} size="lg">
          {result.validated_feasible ? "Validated feasible" : `Validation failed: ${result.violations.length} violation${result.violations.length === 1 ? "" : "s"}`}
        </Badge>
        <Badge variant={result.solver_feasible ? "outline" : "warning"} size="lg">PyVRP: {result.solver_feasible ? "feasible" : "infeasible"}</Badge>
        <Badge variant="outline" size="lg">Heuristic: best found, not proven optimal</Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Objective" value={n(result.objective.total)} unit={u.cost} />
        <StatTile label="Routes" value={n(result.totals.routes)} footnote={`${result.totals.clients_served} of ${result.totals.clients_total} clients`} />
        <StatTile label="Distance" value={n(result.totals.distance)} unit={u.distance} />
        <StatTile label="Duration" value={n(result.totals.duration)} unit={u.duration} footnote={`travel ${n(result.totals.travel_duration)}, service ${n(result.totals.service_duration)}`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-2" aria-labelledby="lab-objective">
            <h2 id="lab-objective" className="text-sm font-medium">Objective breakdown ({u.cost})</h2>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableBody>
                  <TableRow><TableCell>Fixed vehicle costs</TableCell><TableCell className="text-right tabular-nums">{n(result.objective.fixed_cost)}</TableCell></TableRow>
                  <TableRow><TableCell>Distance costs</TableCell><TableCell className="text-right tabular-nums">{n(result.objective.distance_cost)}</TableCell></TableRow>
                  <TableRow><TableCell>Duration costs</TableCell><TableCell className="text-right tabular-nums">{n(result.objective.duration_cost)}</TableCell></TableRow>
                  <TableRow className="font-medium"><TableCell>Total (recomputed by Fillrate)</TableCell><TableCell className="text-right tabular-nums" data-testid="lab-objective-total">{n(result.objective.total)}</TableCell></TableRow>
                  <TableRow><TableCell className="text-muted-foreground">PyVRP nominal cost (no penalties)</TableCell><TableCell className="text-muted-foreground text-right tabular-nums">{n(result.solver.nominal_cost)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </div>
            <p className="text-muted-foreground text-xs text-pretty">
              Penalized excess in PyVRP&apos;s solution: load {dims.map((d) => `${d} ${n(result.solver.excess_load[d] ?? 0)}`).join(", ")}; distance {n(result.solver.excess_distance)}; time warp{" "}
              {n(result.solver.time_warp)}. Penalty weights guide the search and are not costs, so they are not added to the objective.
            </p>
          </section>
          <section className="flex flex-col gap-2" aria-labelledby="lab-fleet">
            <h2 id="lab-fleet" className="text-sm font-medium">Fleet</h2>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Vehicle type</TableHead><TableHead className="text-right">Used</TableHead><TableHead className="text-right">Available</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {result.fleet.map((f) => (
                    <TableRow key={f.vehicle_type} data-testid={`lab-fleet-${f.vehicle_type}`}>
                      <TableCell className="font-mono text-xs">{f.vehicle_type}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.used}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.available}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
          {result.violations.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="lab-violations">
              <h2 id="lab-violations" className="text-sm font-medium">Violations</h2>
              <ul className="bg-card divide-y rounded-xl border text-sm">
                {result.violations.map((v, i) => (
                  <li key={i} className="flex flex-col gap-0.5 p-3">
                    <span className="font-mono text-xs">{v.code}{v.route != null ? ` · route ${v.route + 1}` : ""}{v.dimension ? ` · ${v.dimension}` : ""}</span>
                    <span className="text-muted-foreground text-pretty">{v.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <LabPlot instance={instance} result={result} />
      </div>
      <section className="flex flex-col gap-2" aria-labelledby="lab-routes">
        <h2 id="lab-routes" className="text-sm font-medium">Routes</h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table data-testid="lab-routes">
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Visits</TableHead>
                {dims.map((d) => <TableHead key={d} className="text-right">{d} ({u.dimensions[d]})</TableHead>)}
                <TableHead className="text-right">Distance</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.routes.map((r) => (
                <TableRow key={r.index}>
                  <TableCell className="tabular-nums">
                    <span className="mr-1.5 inline-block size-2.5 rounded-full" style={{ background: `var(--route-${(r.index % 8) + 1})` }} aria-hidden />
                    {r.index + 1}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.vehicle_type}</TableCell>
                  <TableCell className="max-w-72 text-xs text-pretty">{r.visits.map((v) => v.client_id).join(" → ")}</TableCell>
                  {dims.map((d) => (
                    <TableCell key={d} className="text-right text-xs whitespace-nowrap tabular-nums">
                      {n(r.load[d])} / {n(capacity.get(r.vehicle_type)?.[d] ?? 0)} <span className="text-muted-foreground">({pct(r.utilization[d])})</span>
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">{n(r.distance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(r.duration)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(r.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground text-xs">Distance in {u.distance}, duration in {u.duration}, cost in {u.cost}. Routes return to the depot; load is what the vehicle carries out.</p>
      </section>
      {observations.length > 0 && (
        <section className="bg-card rounded-xl border p-4">
          <h2 className="text-sm font-medium">What to look for (this example)</h2>
          <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-sm text-pretty">{observations.map((o) => <li key={o}>{o}</li>)}</ul>
        </section>
      )}
      <dl className="text-muted-foreground grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt>Problem fingerprint</dt><dd className="font-mono break-all" data-testid="lab-fingerprint">{result.problem_fingerprint}</dd>
        <dt>Solver</dt>
        <dd>
          PyVRP {result.solver.version} ({result.solver.adapter_version}), seed {result.solver.seed}, {n(result.solver.iterations)} iterations in {result.solver.runtime_s.toFixed(2)} s, stopped by{" "}
          {result.solver.stopped_by === "iterations" ? "the iteration budget (repeatable)" : "the runtime limit (machine dependent)"}
        </dd>
      </dl>
    </div>
  )
}
