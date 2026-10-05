"use client"

import type { RunSummary } from "@fillrate/contracts"
import { ArrowDown, ArrowUp, ArrowRightLeft, RotateCcw, Scale } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { ClusterSwatch } from "@/components/lab/route-swatch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu"
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { shipmentLabel } from "@/lib/copy"
import { fillBand, formatFeet, formatPercent } from "@/lib/units"
import { cn } from "@/lib/utils"

import { type Evaluation, PlanComparison } from "./plan-comparison"

type Visit = { visit_id: string; location_id: string; load: number }
type Context = { cluster_id: string; objective: string; visits: Visit[]; blocked: (Visit & { reason: string })[]; solve_status: string; reference_routes: string[][] | null }
type Focus = { visit: string; action: "up" | "down" | "move" } | null

const moveWithin = (routes: string[][], truck: number, from: number, to: number) =>
  routes.map((r, i) => {
    if (i !== truck) return r
    const next = [...r]
    const [id] = next.splice(from, 1)
    next.splice(to, 0, id)
    return next
  })

/** Moves a visit to the end of another shipment (`to` = routes.length starts a new one); empty shipments are removed. */
const moveAcross = (routes: string[][], from: number, visit: string, to: number) => {
  const next = routes.map((r) => [...r])
  next[from] = next[from].filter((v) => v !== visit)
  if (to === next.length) next.push([visit])
  else next[to].push(visit)
  return next.filter((r) => r.length)
}

/**
 * Manual plan mode for one cluster (spec §10): reorder stops, move a stop to another shipment in the cluster or
 * to a new one, then evaluate it against the run's recorded problem next to the optimized routes. Every
 * control is a button or menu, so the editor works from the keyboard.
 */
export function ManualPlanPanel({ summary, runId, runKey, canEvaluate }: { summary: RunSummary; runId: string; runKey?: string; canEvaluate: boolean }) {
  const clusters = summary.clusters.filter((c) => c.visit_count > 0 && c.status !== "nothing_to_solve")
  const [clusterId, setClusterId] = useState(clusters[0]?.id ?? "")
  const [context, setContext] = useState<Context | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [routes, setRoutes] = useState<string[][]>([])
  const [result, setResult] = useState<{ evaluation: Evaluation; plan: string } | null>(null)
  const [evaluating, setEvaluating] = useState(false)
  const [evalError, setEvalError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const focus = useRef<Focus>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const headers = useMemo((): Record<string, string> => (runKey ? { "x-run-key": runKey } : {}), [runKey])
  const places = useMemo(() => new Map(summary.locations.map((l) => [l.id, l.label])), [summary])

  useEffect(() => {
    if (!clusterId) return
    let cancelled = false
    fetch(`/api/v1/runs/${runId}/evaluate?cluster=${encodeURIComponent(clusterId)}`, { headers, cache: "no-store" })
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error?.message ?? "Could not load the cluster.")
        return body as Context
      })
      .then((ctx) => {
        if (cancelled) return
        setContext(ctx)
        setLoadError(null)
        setRoutes(initialRoutes(ctx))
        setResult(null)
        setEvalError(null)
      })
      .catch((error: Error) => !cancelled && setLoadError(error.message))
    return () => {
      cancelled = true
    }
  }, [clusterId, runId, headers])

  // Keyboard users keep their place: after a move, focus returns to the moved stop's control.
  useEffect(() => {
    const target = focus.current
    if (!target) return
    focus.current = null
    listRef.current?.querySelector<HTMLElement>(`[data-visit="${CSS.escape(target.visit)}"][data-action="${target.action}"]:not(:disabled)`)?.focus()
  }, [routes])

  if (!clusters.length) {
    return (
      <Empty className="rounded-xl border">
        <EmptyHeader>
          <EmptyTitle>No cluster to plan by hand</EmptyTitle>
          <EmptyDescription>This run has no cluster with stops the solver could reach.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const visits = new Map((context?.visits ?? []).map((v) => [v.visit_id, v]))
  const label = (id: string) => places.get(visits.get(id)?.location_id ?? "") ?? id
  const capacity = summary.settings.trailer_capacity
  const planKey = JSON.stringify(routes)
  const changed = context ? planKey !== JSON.stringify(initialRoutes(context)) : false
  const clusterIndex = summary.clusters.findIndex((c) => c.id === clusterId) + 1
  const items = clusters.map((c) => ({ value: c.id, label: `Cluster ${summary.clusters.indexOf(c) + 1} · ${c.visit_count} ${c.visit_count === 1 ? "stop" : "stops"}` }))

  function update(next: string[][], message: string, nextFocus: Focus) {
    setRoutes(next)
    setAnnouncement(message)
    focus.current = nextFocus
  }

  async function evaluate() {
    setEvaluating(true)
    setEvalError(null)
    try {
      const res = await fetch(`/api/v1/runs/${runId}/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ cluster_id: clusterId, routes }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error?.message ?? "Evaluation failed.")
      setResult({ evaluation: body as Evaluation, plan: planKey })
      setAnnouncement((body as Evaluation).manual.valid ? "Evaluated: the manual plan is valid." : `Evaluated: the manual plan has ${(body as Evaluation).manual.violations.length} violations.`)
    } catch (error) {
      setEvalError(error instanceof Error ? error.message : "Evaluation failed.")
    } finally {
      setEvaluating(false)
    }
  }

  function reset() {
    if (!context) return
    setRoutes(initialRoutes(context))
    setResult(null)
    setEvalError(null)
    setAnnouncement("Manual plan reset to the optimized routes.")
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {clusters.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Cluster</span>
            <Select value={clusterId} onValueChange={(v) => setClusterId(v as string)} items={items}>
              <SelectTrigger size="sm" className="w-52" aria-label="Cluster">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {items.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </label>
        ) : (
          <span className="flex items-center gap-2 text-sm font-medium">
            <ClusterSwatch cluster={clusterIndex} size="sm" /> Cluster {clusterIndex}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={reset} disabled={!context || (!changed && !result)}>
            <RotateCcw aria-hidden /> Reset
          </Button>
          <Button size="sm" onClick={evaluate} loading={evaluating} disabled={!context || !canEvaluate || !routes.length}>
            <Scale aria-hidden /> Evaluate
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-xs text-pretty">
        Start from this run&apos;s routes, reorder stops or move them between shipments, then evaluate. Moving a shipment&apos;s last stop away removes it; &quot;New shipment&quot; adds
        one. Stops stay in this cluster. {!canEvaluate && "Evaluating needs the same access as starting runs on this server."}
      </p>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {loadError && (
        <Alert variant="error">
          <AlertTitle>Could not load this cluster</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}
      {!context && !loadError && <Skeleton className="h-40 rounded-xl" />}

      {context && (
        <>
          {context.blocked.length > 0 && (
            <p className="text-muted-foreground text-xs">
              Not plannable in this run: {context.blocked.map((b) => places.get(b.location_id) ?? b.location_id).join(", ")} (no chain of legs within the leg limit from the depot).
            </p>
          )}
          {!context.reference_routes && (
            <Alert variant="warning">
              <AlertTitle>No optimized routes to compare</AlertTitle>
              <AlertDescription>The solver returned no candidate for this cluster ({context.solve_status.replaceAll("_", " ")}), so the plan starts with one shipment per stop.</AlertDescription>
            </Alert>
          )}
          <div ref={listRef} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {routes.map((route, t) => {
              const load = route.reduce((n, id) => n + (visits.get(id)?.load ?? 0), 0)
              const fill = load / capacity
              return (
                <section key={t} className="bg-card flex min-w-0 flex-col rounded-xl border" aria-label={`Manual ${shipmentLabel(t + 1)}`}>
                  <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-3 py-2">
                    <h4 className="text-sm font-medium">{shipmentLabel(t + 1)}</h4>
                    <span className={cn("text-xs tabular-nums", fill > 1 ? "text-destructive-foreground font-medium" : fillBand(fill) === "low" ? "text-warning-foreground" : "text-muted-foreground")}>
                      {formatFeet(load)} of {formatFeet(capacity, 0)} · {formatPercent(fill)}
                    </span>
                  </header>
                  <ol className="divide-y">
                    {route.map((id, i) => (
                      <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        <span className="text-muted-foreground w-5 shrink-0 font-mono text-xs tabular-nums">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{label(id)}</span>
                          <span className="text-muted-foreground block text-[11px] tabular-nums">{formatFeet(visits.get(id)?.load ?? 0)}</span>
                        </span>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Move ${label(id)} earlier`}
                          data-visit={id}
                          data-action="up"
                          disabled={i === 0}
                          onClick={() => update(moveWithin(routes, t, i, i - 1), `${label(id)} is now stop ${i} of ${shipmentLabel(t + 1)}.`, { visit: id, action: i - 1 === 0 ? "down" : "up" })}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Move ${label(id)} later`}
                          data-visit={id}
                          data-action="down"
                          disabled={i === route.length - 1}
                          onClick={() => update(moveWithin(routes, t, i, i + 1), `${label(id)} is now stop ${i + 2} of ${shipmentLabel(t + 1)}.`, { visit: id, action: i + 1 === route.length - 1 ? "up" : "down" })}
                        >
                          <ArrowDown />
                        </Button>
                        <Menu>
                          <MenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={`Move ${label(id)} to another shipment`} data-visit={id} data-action="move" />}>
                            <ArrowRightLeft />
                          </MenuTrigger>
                          <MenuPopup align="end">
                            {routes.map((_, j) =>
                              j === t ? null : (
                                <MenuItem
                                  key={j}
                                  onClick={() => {
                                    const next = moveAcross(routes, t, id, j)
                                    update(next, `${label(id)} moved to the end of ${shipmentLabel(next.findIndex((r) => r.includes(id)) + 1)}.`, { visit: id, action: "move" })
                                  }}
                                >
                                  To {shipmentLabel(j + 1)}
                                </MenuItem>
                              ),
                            )}
                            {routes.length > 1 && <MenuSeparator />}
                            <MenuItem
                              disabled={route.length === 1}
                              onClick={() => update(moveAcross(routes, t, id, routes.length), `${label(id)} moved to a new ${shipmentLabel(routes.length + 1)}.`, { visit: id, action: "move" })}
                            >
                              To a new shipment
                            </MenuItem>
                          </MenuPopup>
                        </Menu>
                      </li>
                    ))}
                  </ol>
                </section>
              )
            })}
          </div>
          {evalError && (
            <Alert variant="error">
              <AlertTitle>Not evaluated</AlertTitle>
              <AlertDescription>{evalError}</AlertDescription>
            </Alert>
          )}
          {result && <PlanComparison result={result.evaluation} places={places} stale={result.plan !== planKey} />}
        </>
      )}
    </div>
  )
}

/** The run's optimized routes or, without a candidate, one shipment per stop. */
function initialRoutes(context: Context) {
  return context.reference_routes?.map((r) => [...r]) ?? context.visits.map((v) => [v.visit_id])
}
