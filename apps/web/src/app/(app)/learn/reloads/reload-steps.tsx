"use client"

import type { LabInstance, LabResult } from "@fillrate/contracts"
import { ArrowRight, Play, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { LabPlot } from "@/components/lab/lab-plot"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { Step, useLessonState } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.reloads"
const ACTIVE = new Set(["queued", "claimed", "running"])
const n = (value: number) => value.toLocaleString("en-US")

type Job = "on" | "off"
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

/** The trips of a route as "dc → yard: R-1, R-5". */
const tripLines = (result: LabResult) => result.routes.flatMap((r) => (r.trips ?? []).map((t) => `${t.from_depot} → ${t.to_depot}: ${t.client_ids.join(", ")}`))

/**
 * The reloads lesson's steps (spec §13): the bundled `reloads` example (one van that reloads at the yard) and its
 * `reloads_off` twin (four vans, no reloading), then both persisted results side by side. Started jobs are
 * remembered per browser, with a reset.
 */
export function ReloadSteps({ open, closedNote = "Starting runs is disabled on this server.", runKey }: { open: boolean; closedNote?: string; runKey?: string }) {
  const { jobs, pending, start, reset } = useLessonState<Record<string, string>, Job>(STORAGE_KEY, {}, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""
  const on = useLabRun(jobs.on)
  const off = useLabRun(jobs.off)

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
        title="Plan with reloading allowed"
        observe={[
          "The plan is validated feasible: one route on one van, 4 trips, every trip carrying exactly 10 parcels (100% full) although the route delivers 40.",
          "Trip 1 runs from the DC to the yard, trips 2 and 3 from the yard back to the yard, and trip 4 from the yard to the DC. Each trip serves 2 stops.",
          "The objective is 533 cost units: 100 for the one van plus 433 of distance. Seeds 0 to 3 all find it.",
          "On the run page the Trips table lists each trip's load and distance, and the plot marks the yard as a reload depot.",
        ]}
      >
        <Button disabled={!open} loading={pending === "on"} onClick={() => start("on", "/api/v1/lab/runs", () => ({ example: "reloads" }))}>
          <Play aria-hidden /> Run with reloads
        </Button>
        {openLink("on", "Open reload run")}
      </Step>

      <Step
        n={2}
        title="Plan without reloading"
        observe={[
          "The same 8 stops, 5 parcels each, vans of 10 parcels and 100 per van, but no yard and no reloading, so each van makes one trip from the DC.",
          "The plan needs 4 vans of 2 stops each, with fixed costs of 400 and a distance of 780 against 433.",
          "The objective is 1,180 cost units, over twice the reloading plan. The single reloading van works for longer than any of these vans, so a route's duration limit would be what stops reloading from being free.",
        ]}
      >
        <Button disabled={!open} loading={pending === "off"} onClick={() => start("off", "/api/v1/lab/runs", () => ({ example: "reloads_off" }))}>
          <Play aria-hidden /> Run without reloads
        </Button>
        {openLink("off", "Open no-reload run")}
      </Step>

      <Step
        n={3}
        title="Compare the two runs"
        observe={[
          "The two instances have different problem fingerprints (the reload rule, the yard and the fleet size are part of the problem), so the comparison is between two problems, not two seeds of one.",
          "Same stops and parcels: reloading trades vans for time on the road. Whether the longer day is acceptable depends on a shift limit this example does not set.",
          "Fillrate does not say reloading is worth it; a yard needs stock and staff, which this model does not include.",
        ]}
      >
        <p className="text-muted-foreground text-sm">
          {on?.result && off?.result
            ? "Both runs finished; the comparison below reads their saved results."
            : jobs.on && jobs.off
              ? "Waiting for both runs to finish…"
              : "Run steps 1 and 2 first; the comparison reads both finished runs."}
        </p>
      </Step>

      {on?.result && off?.result && <Comparison on={on} off={off} />}

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={reset}>
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Forgets which runs this browser started. Runs already made stay under Solver Lab.</p>
      </div>
    </div>
  )
}

function Comparison({ on, off }: { on: Detail; off: Detail }) {
  const cols = [
    { name: "Reloads allowed", detail: on, key: "on" },
    { name: "No reloads", detail: off, key: "off" },
  ]
  const rows: [string, (r: LabResult) => string, string][] = [
    ["Validated", (r) => (r.validated_feasible ? "feasible" : "failed"), "validated"],
    ["Vans used", (r) => n(r.totals.routes), "routes"],
    ["Number of trips", (r) => n(r.routes.reduce((sum, x) => sum + (x.trips?.length ?? 1), 0)), "trips"],
    ["Fixed cost", (r) => n(r.objective.fixed_cost), "fixed"],
    ["Distance (planar units)", (r) => n(r.totals.distance), "distance"],
    ["Objective (cost units)", (r) => n(r.objective.total), "objective"],
    ["Longest route (time units)", (r) => n(Math.max(...r.routes.map((x) => x.duration))), "duration"],
    ["Trips", (r) => tripLines(r).join("; "), "trip-list"],
  ]
  return (
    <section className="flex flex-col gap-3" aria-labelledby="comparison">
      <h2 id="comparison" className="text-base font-semibold">Side by side</h2>
      <div className="overflow-x-auto rounded-xl border">
        <Table aria-label="Side-by-side comparison" data-testid="reloads-comparison">
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
                  <TableCell key={c.key} className="min-w-36 text-xs text-pretty tabular-nums" data-testid={`reloads-${c.key}-${id}`}>{value(c.detail.result!)}</TableCell>
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
