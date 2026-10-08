"use client"

import type { LabInstance, LabResult } from "@fillrate/contracts"
import { ArrowRight, Play, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { LabPlot } from "@/components/lab/lab-plot"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { Step, useLessonState } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.pairs"
const ACTIVE = new Set(["queued", "claimed", "running"])
const n = (value: number) => value.toLocaleString("en-US")

type Job = "big" | "small"
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

/**
 * The pickup-delivery pairs lesson's steps (spec §13): the bundled `pairs` example (vans carry 12) and its `pairs_small`
 * twin (vans carry 6), then both persisted results side by side. Started jobs are remembered per browser, with a reset.
 */
export function PairSteps({ open, closedNote = "Starting runs is disabled on this server.", runKey }: { open: boolean; closedNote?: string; runKey?: string }) {
  const { jobs, pending, start, reset } = useLessonState<Record<string, string>, Job>(STORAGE_KEY, {}, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""
  const big = useLabRun(jobs.big)
  const small = useLabRun(jobs.small)

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
        title="Plan with vans that carry 12"
        observe={[
          "The plan is validated feasible with all 6 pairs served on 3 vans, each van doing two pairs: its two pickups first, then its two deliveries, so 12 parcels are on board at the peak (100% full).",
          "On the run page the Pairs table says which pair rides with which, and the load chart for each route climbs to the dashed capacity line after the second pickup and falls back to zero.",
          "Nominal cost 1,226: 300 for three vans plus 926 of distance. Every route is within the 450-unit limit. Every seed from 0 to 3 finds the same cost, though not always the same pairing.",
        ]}
      >
        <Button disabled={!open} loading={pending === "big"} onClick={() => start("big", "/api/v1/lab/runs", () => ({ example: "pairs" }))}>
          <Play aria-hidden /> Run with capacity 12
        </Button>
        {openLink("big", "Open capacity-12 run")}
      </Step>

      <Step
        n={2}
        title="Halve the capacity"
        observe={[
          "The same jobs with vans that carry 6: a pair fills a van, so no two pairs are ever on board together and every pair rides alone.",
          "Each route goes pickup, delivery, pickup, delivery, so routes are longer. The 450-unit limit then needs 5 vans instead of 3.",
          "Nominal cost 2,069 (500 for five vans plus 1,569 of distance): carrying less at a time costs both vans and miles.",
        ]}
      >
        <Button disabled={!open} loading={pending === "small"} onClick={() => start("small", "/api/v1/lab/runs", () => ({ example: "pairs_small" }))}>
          <Play aria-hidden /> Run with capacity 6
        </Button>
        {openLink("small", "Open capacity-6 run")}
      </Step>

      <Step
        n={3}
        title="Compare the two runs"
        observe={[
          "The two instances have different problem fingerprints (the vehicle capacity is part of the problem), so the comparison is between two problems, not two seeds of one.",
          "Both plans serve all six pairs and pass the same checks: pickup before delivery, on one van, load within capacity after every stop. Only what a van may carry at once changed.",
          "Fillrate does not say what a pair is worth; the solver only decides how to combine the pairs it was given.",
        ]}
      >
        <p className="text-muted-foreground text-sm">
          {big?.result && small?.result
            ? "Both runs finished; the comparison below reads their saved results."
            : jobs.big && jobs.small
              ? "Waiting for both runs to finish…"
              : "Run steps 1 and 2 first; the comparison reads both finished runs."}
        </p>
      </Step>

      {big?.result && small?.result && <Comparison big={big} small={small} />}

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={reset}>
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Forgets which runs this browser started. Runs already made stay under Solver Lab.</p>
      </div>
    </div>
  )
}

function Comparison({ big, small }: { big: Detail; small: Detail }) {
  const cols = [
    { name: "Capacity 12", detail: big, key: "big" },
    { name: "Capacity 6", detail: small, key: "small" },
  ]
  const rows: [string, (r: LabResult) => string, string][] = [
    ["Validated", (r) => (r.validated_feasible ? "feasible" : "failed"), "validated"],
    ["Pairs served", (r) => `${r.totals.pairs_served ?? 0} of ${r.totals.pairs_total ?? 0}`, "served"],
    ["Pairs riding together", (r) => `${(r.pairs ?? []).filter((p) => p.shared_with.length > 0).length} of ${(r.pairs ?? []).length}`, "shared"],
    ["Vans used", (r) => n(r.totals.routes), "routes"],
    ["Peak load on board", (r) => n(Math.max(...r.routes.map((x) => x.peak_load?.parcels ?? 0))), "peak"],
    ["Distance (planar units)", (r) => n(r.totals.distance), "distance"],
    ["Nominal cost (cost units)", (r) => n(r.objective.total), "nominal"],
  ]
  return (
    <section className="flex flex-col gap-3" aria-labelledby="comparison">
      <h2 id="comparison" className="text-base font-semibold">Side by side</h2>
      <div className="overflow-x-auto rounded-xl border">
        <Table aria-label="Side-by-side comparison" data-testid="pairs-comparison">
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
                  <TableCell key={c.key} className="min-w-36 text-xs text-pretty tabular-nums" data-testid={`pairs-${c.key}-${id}`}>{value(c.detail.result!)}</TableCell>
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
