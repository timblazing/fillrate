"use client"

import type { RunSummary } from "@fillrate/contracts"
import { ArrowRight, Play, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { METERS_PER_MILE } from "@/lib/shipment-sheet"
import { formatCount, formatMiles, formatMoney } from "@/lib/units"

import { Step, useLessonState, wholeNumber } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.road-matrices"
const ACTIVE = new Set(["queued", "claimed", "running"])

type Params = { seed: string }
type Job = "estimated" | "recorded"
type Detail = { id: string; status: string; summary: RunSummary | null }

/** Polls one run until it finishes; null until the first answer (or when no run was started). */
function useRunDetail(id: string | undefined, runKey?: string) {
  const [detail, setDetail] = useState<Detail | null>(null)
  useEffect(() => {
    if (!id) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const res = await fetch(`/api/v1/runs/${id}`, { cache: "no-store", headers: runKey ? { "x-run-key": runKey } : {} }).catch(() => null)
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
  }, [id, runKey])
  return detail?.id === id ? detail : null
}

const travelName = (s: RunSummary) => (s.travel?.mode === "snapshot" ? `Recorded matrix (${s.travel.provider}, synthetic)` : `Estimated: straight line × ${s.settings.travel_circuity}`)
const milesUnit = (s: RunSummary) => (s.travel?.mode === "snapshot" ? "recorded-matrix miles" : "estimated miles")

/**
 * The road matrix lesson's steps (spec §13): the bundled scenario on estimated travel (`matrix_estimated`) and on its
 * synthetic recorded matrix (`matrix_recorded`), then both persisted results side by side. Parameters and started jobs
 * are remembered per browser, with a reset.
 */
export function MatrixSteps({ open, closedNote = "Starting runs is disabled on this server.", runKey }: { open: boolean; closedNote?: string; runKey?: string }) {
  const { params, jobs, pending, setParam, start, reset } = useLessonState<Params, Job>(STORAGE_KEY, { seed: "0" }, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""
  const estimated = useRunDetail(jobs.estimated, runKey)
  const recorded = useRunDetail(jobs.recorded, runKey)

  const runBody = (example: "matrix_estimated" | "matrix_recorded") => () => ({ example, settings: { solver_seed: wholeNumber(params.seed, 0, 1_000_000, "Solver seed") } })

  const openLink = (job: Job, label: string) =>
    jobs[job] && (
      <Button variant="outline" render={<Link href={`/runs/${jobs[job]}${suffix}`} />}>
        {label} <ArrowRight aria-hidden />
      </Button>
    )

  return (
    <div className="flex flex-col gap-8">
      {!open && <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">{closedNote} The steps below are read-only.</p>}

      <Step
        n={1}
        title="Plan on estimated travel"
        observe={[
          "The plan is valid and complete: all 17 pallets ship on 2 trucks, about 724 estimated loaded miles.",
          "Preflight flags nothing. The ridge resort is about 470 estimated miles from the DC, inside the 500-mile limit, and one truck reaches it from the builder yard on a 347-mile estimated leg.",
          "The river and the ridge do not exist for the estimate: every pair is the same distance both ways.",
        ]}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lesson-seed">Solver seed</Label>
          <Input id="lesson-seed" value={params.seed} onChange={(e) => setParam({ seed: e.target.value })} className="w-24 font-mono" />
        </div>
        <Button disabled={!open} loading={pending === "estimated"} onClick={() => start("estimated", "/api/v1/runs", runBody("matrix_estimated"))}>
          <Play aria-hidden /> Run on estimated travel
        </Button>
        {openLink("estimated", "Open estimated run")}
      </Step>

      <Step
        n={2}
        title="Plan on the recorded matrix"
        observe={[
          "The same scenario and seed, with the bundled synthetic matrix selected. Preflight warns that the ridge resort is too far from the DC: every recorded drive into it is over 500 miles (the shortest, from the clinic, is 532).",
          "The resort's 4 pallets ($1,680) are unshipped with the reason “unreachable”. The plan is valid but partial: the rest ships on 1 truck, 13 pallets, 98% full, about 488 loaded miles measured on the matrix.",
          "The truck serves the three stops west of the river first (farm supply, lumber yard, hardware store), crosses the one-way bridge once eastbound, then serves the grocery warehouse, builder yard and clinic. Going back west would cost the 110-mile detour to the southern bridge.",
          "On the run page, Provenance names the matrix, and the Timeline's drive times read “Imported matrix durations”.",
        ]}
      >
        <Button disabled={!open} loading={pending === "recorded"} onClick={() => start("recorded", "/api/v1/runs", runBody("matrix_recorded"))}>
          <Play aria-hidden /> Run on the recorded matrix
        </Button>
        {openLink("recorded", "Open recorded-matrix run")}
      </Step>

      <Step
        n={3}
        title="Compare the two runs"
        observe={[
          "Allocation and clustering are identical: the cluster metric stays straight-line distance whichever travel is selected. Only travel, and so reachability and routes, changed.",
          "The loaded miles are in different measurement systems and also cover different stops (the resort), so 724 versus 488 says nothing about which plan drives less. The two runs are never ranked against each other.",
          "The recorded run is not wrong to leave the resort unshipped: on the recorded roads no truck can reach it within the 500-mile limit. The estimate promised a delivery the roads cannot make.",
        ]}
      >
        <p className="text-muted-foreground text-sm">
          {estimated?.summary && recorded?.summary
            ? "Both runs finished; the comparison below reads their saved results."
            : jobs.estimated && jobs.recorded
              ? "Waiting for both runs to finish…"
              : "Run steps 1 and 2 first; the comparison reads both finished runs."}
        </p>
      </Step>

      {estimated?.summary && recorded?.summary && <Comparison estimated={estimated} recorded={recorded} />}

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={reset}>
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Restores the starting values and forgets which runs this browser started. Runs already made stay under Runs.</p>
      </div>
    </div>
  )
}

function Comparison({ estimated, recorded }: { estimated: Detail; recorded: Detail }) {
  const runs = [estimated.summary!, recorded.summary!]
  const unshipped = (s: RunSummary) => {
    const label = new Map(s.locations.map((l) => [l.id, l.label]))
    return s.unplanned.length ? s.unplanned.map((u) => `${label.get(u.location_id) ?? u.location_id}: ${formatCount(u.pieces)} (${u.reason})`).join("; ") : "none"
  }
  const rows: [string, (s: RunSummary) => string][] = [
    ["Travel", travelName],
    ["Plan", (s) => `${s.validity}, ${s.coverage}`],
    ["Shipments", (s) => formatCount(s.totals.trucks)],
    ["Loaded miles", (s) => `${formatMiles(s.totals.loaded_distance_m / METERS_PER_MILE)} (${milesUnit(s)})`],
    ["Planned revenue", (s) => formatMoney(s.totals.planned_cents)],
    ["Unshipped pallets", unshipped],
  ]
  return (
    <section className="flex flex-col gap-3" aria-labelledby="comparison">
      <h2 id="comparison" className="text-base font-semibold">Side by side</h2>
      <div className="overflow-x-auto rounded-xl border">
        <Table aria-label="Side-by-side comparison">
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead>Estimated run</TableHead>
              <TableHead>Recorded-matrix run</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([name, value]) => (
              <TableRow key={name}>
                <TableCell className="text-muted-foreground">{name}</TableCell>
                {runs.map((s, i) => (
                  <TableCell key={i} className="min-w-36 text-pretty tabular-nums">{value(s)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Alert variant="warning">
        <AlertTitle>Not interchangeable</AlertTitle>
        <AlertDescription>Estimated miles and recorded-matrix miles are different measurement systems. Compare each plan with its own assumptions, not one number with the other.</AlertDescription>
      </Alert>
    </section>
  )
}
