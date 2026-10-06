"use client"

import type { LabInstance, LabResult } from "@fillrate/contracts"
import { ArrowRight, Play, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { LabPlot } from "@/components/lab/lab-plot"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { Step, useLessonState } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.depots"
const ACTIVE = new Set(["queued", "claimed", "running"])
const n = (value: number) => value.toLocaleString("en-US")

type Job = "two" | "one"
type Detail = { id: string; status: string; instance: LabInstance; result: LabResult | null }

/** Polls one lab run until it finishes; null until the first answer (or when no run was started). */
function useLabRun(id: string | undefined) {
  const [detail, setDetail] = useState<Detail | null>(null)
  useEffect(() => {
    if (!id) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const res = await fetch(`/api/v1/lab/runs/${id}`, { cache: "no-store" }).catch(() => null)
      if (res?.ok && !stopped) {
        const next = (await res.json()) as Detail
        setDetail(next)
        if (!ACTIVE.has(next.status)) return
      }
      if (!stopped) timer = setTimeout(tick, 1_500)
    }
    void tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [id])
  return detail?.id === id ? detail : null
}

/** Which depot each route started from, and the clients it served: "west: W-3 → W-1 → W-5". */
const routeLines = (result: LabResult) => result.routes.map((r) => `${r.start_depot ?? "?"}: ${r.visits.map((v) => v.client_id).join(" → ")}`)

/**
 * The multiple depots lesson's steps (spec §13): the bundled `depots` example (two depots, two vans each) and its
 * `depots_single` twin (the same stops and four vans at the West depot only), then both persisted results side by
 * side. Started jobs are remembered per browser, with a reset.
 */
export function DepotSteps({ open, closedNote = "Starting runs is disabled on this server.", runKey }: { open: boolean; closedNote?: string; runKey?: string }) {
  const { jobs, pending, start, reset } = useLessonState<Record<string, string>, Job>(STORAGE_KEY, {}, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""
  const two = useLabRun(jobs.two)
  const one = useLabRun(jobs.one)

  const openLink = (job: Job, label: string) =>
    jobs[job] && (
      <Button variant="outline" render={<Link href={`/labs/${jobs[job]}${suffix}`} />}>
        {label} <ArrowRight aria-hidden />
      </Button>
    )

  return (
    <div className="flex flex-col gap-8">
      {!open && <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">{closedNote} The steps below are read-only.</p>}

      <Step
        n={1}
        title="Plan from two depots"
        observe={[
          "The plan is validated feasible: 4 routes, 2 from each depot. Every West van starts and ends at the West depot and every East van at the East depot.",
          "Each route serves only the stops on its own side, 3 stops and 12 parcels, so every van is full.",
          "The objective is 689 cost units: 400 of fixed van costs plus 289 of distance. Seeds 0 to 3 all find it.",
          "On the run page, the Depots table lists the vans used per depot and the route table names each route's depot.",
        ]}
      >
        <Button disabled={!open} loading={pending === "two"} onClick={() => start("two", "/api/v1/lab/runs", () => ({ example: "depots" }))}>
          <Play aria-hidden /> Run with two depots
        </Button>
        {openLink("two", "Open two-depot run")}
      </Step>

      <Step
        n={2}
        title="Plan from the West depot only"
        observe={[
          "The same 12 stops, parcels and 4 vans with 100 per van, but every van is based at the West depot.",
          "Two routes still serve the West stops; the other two drive out to the East stops and back, each longer than 200 planar units.",
          "The fixed cost is again 400, so the whole difference is distance: the objective is 1,096 cost units, over 1.5 times the two-depot plan.",
        ]}
      >
        <Button disabled={!open} loading={pending === "one"} onClick={() => start("one", "/api/v1/lab/runs", () => ({ example: "depots_single" }))}>
          <Play aria-hidden /> Run from one depot
        </Button>
        {openLink("one", "Open one-depot run")}
      </Step>

      <Step
        n={3}
        title="Compare the two runs"
        observe={[
          "The two instances have different problem fingerprints (the depots and each van's start depot are part of the problem), so the comparison is between two problems, not two seeds of one.",
          "Same stops, same vans and fixed costs: opening a second depot where the East stops are saves distance, not vehicles.",
          "Fillrate does not say a second depot is worth it; opening one has costs this model does not include (stock, staff, rent).",
        ]}
      >
        <p className="text-muted-foreground text-sm">
          {two?.result && one?.result
            ? "Both runs finished; the comparison below reads their saved results."
            : jobs.two && jobs.one
              ? "Waiting for both runs to finish…"
              : "Run steps 1 and 2 first; the comparison reads both finished runs."}
        </p>
      </Step>

      {two?.result && one?.result && <Comparison two={two} one={one} />}

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={reset}>
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Forgets which runs this browser started. Runs already made stay under Solver Lab.</p>
      </div>
    </div>
  )
}

function Comparison({ two, one }: { two: Detail; one: Detail }) {
  const cols = [
    { name: "Two depots", detail: two, key: "two" },
    { name: "West depot only", detail: one, key: "one" },
  ]
  const rows: [string, (r: LabResult) => string, string][] = [
    ["Validated", (r) => (r.validated_feasible ? "feasible" : "failed"), "validated"],
    ["Routes", (r) => n(r.totals.routes), "routes"],
    ["Fixed cost", (r) => n(r.objective.fixed_cost), "fixed"],
    ["Distance (planar units)", (r) => n(r.totals.distance), "distance"],
    ["Objective (cost units)", (r) => n(r.objective.total), "objective"],
    ["Routes by depot", (r) => routeLines(r).join("; "), "routes-by-depot"],
  ]
  return (
    <section className="flex flex-col gap-3" aria-labelledby="comparison">
      <h2 id="comparison" className="text-sm font-medium">Side by side</h2>
      <div className="overflow-x-auto rounded-xl border">
        <Table aria-label="Side-by-side comparison" data-testid="depots-comparison">
          <TableHeader>
            <TableRow>
              <TableHead />
              {cols.map((c) => <TableHead key={c.key}>{c.name}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([name, value, id]) => (
              <TableRow key={id}>
                <TableCell className="text-muted-foreground">{name}</TableCell>
                {cols.map((c) => (
                  <TableCell key={c.key} className="min-w-36 text-xs text-pretty tabular-nums" data-testid={`depots-${c.key}-${id}`}>{value(c.detail.result!)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {cols.map((c) => <LabPlot key={c.key} instance={c.detail.instance} result={c.detail.result} />)}
      </div>
    </section>
  )
}
