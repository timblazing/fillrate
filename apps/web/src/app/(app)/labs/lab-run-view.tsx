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
          {instance.depots.length > 1 ? `${instance.depots.length} depots · ` : ""}{instance.clients.length} clients · {instance.dimensions.map((d) => `${d.id} (${d.unit})`).join(", ")} · {instance.vehicle_types.map((v) => `${v.count} × ${v.id}`).join(", ")}
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
  const several = instance.depots.length > 1
  const groupedIds = new Set((instance.groups ?? []).flatMap((g) => g.members))
  const optional = instance.clients.filter((c) => c.required === false && !groupedIds.has(c.id))
  const groupOutcomes = result.groups ?? []
  const skipped = result.skipped ?? []
  const reloading = result.routes.some((r) => (r.trips?.length ?? 0) > 1)
  const label = (id: string | null | undefined) => id ?? instance.depots[0].id
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
        <StatTile label={optional.length ? "Nominal cost" : "Objective"} value={n(result.objective.total)} unit={u.cost} footnote={optional.length ? `+ ${n(result.objective.uncollected_prizes ?? 0)} uncollected prizes` : undefined} />
        <StatTile label="Routes" value={n(result.totals.routes)} footnote={`${result.totals.clients_served} of ${result.totals.clients_total} clients${skipped.length ? ` (${skipped.length} skipped)` : ""}`} />
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
                  <TableRow className="font-medium"><TableCell>{optional.length ? "Nominal cost (recomputed by Fillrate)" : "Total (recomputed by Fillrate)"}</TableCell><TableCell className="text-right tabular-nums" data-testid="lab-objective-total">{n(result.objective.total)}</TableCell></TableRow>
                  <TableRow><TableCell className="text-muted-foreground">PyVRP nominal cost (no penalties)</TableCell><TableCell className="text-muted-foreground text-right tabular-nums">{n(result.solver.nominal_cost)}</TableCell></TableRow>
                  {optional.length > 0 && (
                    <>
                      <TableRow><TableCell className="whitespace-normal">Uncollected prizes (skipped clients, not a cost)</TableCell><TableCell className="text-right tabular-nums" data-testid="lab-uncollected-prizes">{n(result.objective.uncollected_prizes ?? 0)}</TableCell></TableRow>
                      <TableRow className="font-medium"><TableCell className="whitespace-normal">Objective PyVRP minimizes (nominal cost + uncollected prizes)</TableCell><TableCell className="text-right tabular-nums" data-testid="lab-objective-with-prizes">{n(result.objective.objective_with_prizes ?? result.objective.total)}</TableCell></TableRow>
                      <TableRow><TableCell className="text-muted-foreground whitespace-normal">Prizes collected by visiting (information only)</TableCell><TableCell className="text-muted-foreground text-right tabular-nums" data-testid="lab-prizes-collected">{n(result.objective.prizes_collected ?? 0)}</TableCell></TableRow>
                    </>
                  )}
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
          {groupOutcomes.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="lab-groups">
              <h2 id="lab-groups" className="text-sm font-medium">Alternative groups (at most one member is visited)</h2>
              <div className="overflow-x-auto rounded-xl border">
                <Table data-testid="lab-groups">
                  <TableHeader>
                    <TableRow><TableHead>Group</TableHead><TableHead>Rule</TableHead><TableHead>Alternatives</TableHead><TableHead>Served by</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupOutcomes.map((g) => (
                      <TableRow key={g.group_id} data-testid={`lab-group-${g.group_id}`}>
                        <TableCell className="font-mono text-xs">{g.group_id}</TableCell>
                        <TableCell className="text-xs whitespace-normal">{g.required ? "exactly one" : "at most one"}</TableCell>
                        <TableCell className="font-mono text-xs whitespace-normal">{(instance.groups ?? []).find((x) => x.id === g.group_id)?.members.join(", ")}</TableCell>
                        <TableCell>{g.served_by ? <Badge variant="success">{g.served_by}</Badge> : <Badge variant={g.required ? "error" : "outline"}>{g.required ? "not served" : "left unserved"}</Badge>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-muted-foreground text-xs text-pretty">The members are alternatives for the same customer, so the solver visits the one that suits the routes best; the others are not skipped prizes, just not needed.</p>
            </section>
          )}
          {optional.length > 0 && (
            <section className="flex flex-col gap-2" aria-labelledby="lab-optional">
              <h2 id="lab-optional" className="text-sm font-medium">Optional clients: {optional.length - skipped.length} visited, {skipped.length} skipped</h2>
              <div className="overflow-x-auto rounded-xl border">
                <Table data-testid="lab-optional">
                  <TableHeader>
                    <TableRow><TableHead>Client</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Prize ({u.cost})</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {optional.map((c) => {
                      const isSkipped = skipped.some((s) => s.client_id === c.id)
                      return (
                        <TableRow key={c.id} data-testid={`lab-optional-${c.id}`}>
                          <TableCell className="font-mono text-xs">{c.id}</TableCell>
                          <TableCell>{isSkipped ? <Badge variant="warning">Skipped: prize missed</Badge> : <Badge variant="success">Visited: prize collected</Badge>}</TableCell>
                          <TableCell className="text-right tabular-nums">{n(c.prize ?? 0)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-muted-foreground text-xs text-pretty">A prize is what PyVRP pays to skip a client, in {u.cost}; a visited client costs the distance to reach it instead. Prizes are never part of the nominal cost. A skipped client was judged not worth its detour by a heuristic search, not proven so.</p>
            </section>
          )}
          {several && (
            <section className="flex flex-col gap-2" aria-labelledby="lab-depots">
              <h2 id="lab-depots" className="text-sm font-medium">Depots</h2>
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Depot</TableHead><TableHead>Vehicles based here (used / available)</TableHead><TableHead className="text-right">Routes</TableHead><TableHead className="text-right">Clients</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {instance.depots.map((depot) => {
                      const types = instance.vehicle_types.filter((v) => (v.start_depot ?? instance.depots[0].id) === depot.id)
                      const routes = result.routes.filter((r) => label(r.start_depot) === depot.id)
                      return (
                        <TableRow key={depot.id} data-testid={`lab-depot-${depot.id}`}>
                          <TableCell className="font-mono text-xs">{depot.id}</TableCell>
                          <TableCell className="text-xs">
                            {types.length === 0 ? "none" : types.map((v) => { const f = result.fleet.find((x) => x.vehicle_type === v.id); return `${v.id} ${f?.used ?? 0} / ${v.count}` }).join(", ")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{routes.length}</TableCell>
                          <TableCell className="text-right tabular-nums">{routes.reduce((sum, r) => sum + r.visits.length, 0)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
          {reloading && (
            <section className="flex flex-col gap-2" aria-labelledby="lab-trips">
              <h2 id="lab-trips" className="text-sm font-medium">Trips (load resets at every reload)</h2>
              <div className="overflow-x-auto rounded-xl border">
                <Table data-testid="lab-trips">
                  <TableHeader>
                    <TableRow><TableHead>Route</TableHead><TableHead>Trip</TableHead><TableHead>From → to</TableHead><TableHead>Visits</TableHead>{dims.map((d) => <TableHead key={d} className="text-right">{d}</TableHead>)}<TableHead className="text-right">Distance</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.routes.flatMap((r) => (r.trips ?? []).map((t) => (
                      <TableRow key={`${r.index}-${t.index}`} data-testid={`lab-trip-${r.index}-${t.index}`}>
                        <TableCell className="tabular-nums">{r.index + 1}</TableCell>
                        <TableCell className="tabular-nums">{t.index + 1}</TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap">{t.from_depot} → {t.to_depot}</TableCell>
                        <TableCell className="text-xs text-pretty">{t.client_ids.join(" → ")}</TableCell>
                        {dims.map((d) => <TableCell key={d} className="text-right text-xs whitespace-nowrap tabular-nums">{n(t.load[d])} / {n(capacity.get(r.vehicle_type)?.[d] ?? 0)} <span className="text-muted-foreground">({pct(t.utilization[d])})</span></TableCell>)}
                        <TableCell className="text-right tabular-nums">{n(t.distance)}</TableCell>
                      </TableRow>
                    )))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
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
                {several && <TableHead>Depot</TableHead>}
                {reloading && <TableHead className="text-right">Trips</TableHead>}
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
                  {several && <TableCell className="font-mono text-xs whitespace-nowrap">{label(r.start_depot) === label(r.end_depot) ? label(r.start_depot) : `${label(r.start_depot)} → ${label(r.end_depot)}`}</TableCell>}
                  {reloading && <TableCell className="text-right tabular-nums">{r.trips?.length ?? 1}</TableCell>}
                  <TableCell className="max-w-72 text-xs text-pretty">{r.visits.map((v) => v.client_id).join(" → ")}</TableCell>
                  {dims.map((d) => (
                    <TableCell key={d} className="text-right text-xs whitespace-nowrap tabular-nums">
                      {reloading && (r.trips?.length ?? 1) > 1 ? `${n(r.load[d])} in ${r.trips?.length ?? 1} trips of ≤ ${n(capacity.get(r.vehicle_type)?.[d] ?? 0)}` : `${n(r.load[d])} / ${n(capacity.get(r.vehicle_type)?.[d] ?? 0)}`} <span className="text-muted-foreground">({pct(r.utilization[d])}{reloading ? " fullest trip" : ""})</span>
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
        <p className="text-muted-foreground text-xs">Distance in {u.distance}, duration in {u.duration}, cost in {u.cost}. {several ? "Each route starts at its vehicle type's start depot and ends at its end depot" : "Routes return to the depot"}; {reloading ? "the load column is the total delivered over all trips, with the fullest trip's share in brackets" : "load is what the vehicle carries out"}.</p>
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
