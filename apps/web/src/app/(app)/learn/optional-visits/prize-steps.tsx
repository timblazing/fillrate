"use client"

import type { LabInstance, LabResult } from "@fillrate/contracts"
import { ArrowRight, Play, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { LabPlot } from "@/components/lab/lab-plot"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { Step, useLessonState } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.prizes"
const ACTIVE = new Set(["queued", "claimed", "running"])
const n = (value: number) => value.toLocaleString("en-US")

type Job = "low" | "high"
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
 * The optional visits lesson's steps (spec §13): the bundled `prizes` example (remote optional stops worth 60 each) and
 * its `prizes_high` twin (400 each), then both persisted results side by side. Started jobs are remembered per
 * browser, with a reset.
 */
export function PrizeSteps({ open, closedNote = "Starting runs is disabled on this server.", runKey }: { open: boolean; closedNote?: string; runKey?: string }) {
  const { jobs, pending, start, reset } = useLessonState<Record<string, string>, Job>(STORAGE_KEY, {}, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""
  const low = useLabRun(jobs.low)
  const high = useLabRun(jobs.high)

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
        title="Plan with low prizes"
        observe={[
          "The plan is validated feasible with 5 of 8 clients visited on one van; the three remote stops are skipped.",
          "Nominal cost is 315: 100 for the van plus 215 of distance. The skipped prizes add 180 (3 × 60), which is not a cost but is what PyVRP minimizes with it: 495.",
          "Reaching the remote stops would add about 485 of cost, far more than the 180 of prizes they carry. Every seed from 0 to 3 skips the same three.",
          "On the run page the Optional clients table marks each remote stop skipped, and the plot draws it as a dashed circle.",
        ]}
      >
        <Button disabled={!open} loading={pending === "low"} onClick={() => start("low", "/api/v1/lab/runs", () => ({ example: "prizes" }))}>
          <Play aria-hidden /> Run with prize 60
        </Button>
        {openLink("low", "Open low-prize run")}
      </Step>

      <Step
        n={2}
        title="Raise the prizes"
        observe={[
          "Same stops and vans; each remote stop's prize is now 400. Skipping all three would pay 1,200.",
          "The solver visits all three: 8 of 8 clients on 2 vans (the remote stops need a second van), nominal cost 800 and nothing uncollected. The 1,200 collected is information, not income: it is the prize no longer paid.",
          "The nominal cost rose from 315 to 800, yet the plan is the better one for these prizes: skipping would have cost 315 + 1,200.",
        ]}
      >
        <Button disabled={!open} loading={pending === "high"} onClick={() => start("high", "/api/v1/lab/runs", () => ({ example: "prizes_high" }))}>
          <Play aria-hidden /> Run with prize 400
        </Button>
        {openLink("high", "Open high-prize run")}
      </Step>

      <Step
        n={3}
        title="Compare the two runs"
        observe={[
          "The two instances have different problem fingerprints (the prizes are part of the problem), so the comparison is between two problems, not two seeds of one.",
          "A lower nominal cost with skipped stops is not a better plan: the skipped prizes are the price of skipping, so read each run's PyVRP objective against its own prizes.",
          "Fillrate does not say what a stop is worth; the prizes are numbers you enter. A skipped stop is a heuristic's judgement, not a proof.",
        ]}
      >
        <p className="text-muted-foreground text-sm">
          {low?.result && high?.result
            ? "Both runs finished; the comparison below reads their saved results."
            : jobs.low && jobs.high
              ? "Waiting for both runs to finish…"
              : "Run steps 1 and 2 first; the comparison reads both finished runs."}
        </p>
      </Step>

      {low?.result && high?.result && <Comparison low={low} high={high} />}

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={reset}>
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Forgets which runs this browser started. Runs already made stay under Solver Lab.</p>
      </div>
    </div>
  )
}

function Comparison({ low, high }: { low: Detail; high: Detail }) {
  const cols = [
    { name: "Prize 60 each", detail: low, key: "low" },
    { name: "Prize 400 each", detail: high, key: "high" },
  ]
  const rows: [string, (r: LabResult) => string, string][] = [
    ["Validated", (r) => (r.validated_feasible ? "feasible" : "failed"), "validated"],
    ["Clients visited", (r) => `${r.totals.clients_served} of ${r.totals.clients_total}`, "visited"],
    ["Skipped", (r) => ((r.skipped ?? []).map((s) => s.client_id).join(", ") || "none"), "skipped"],
    ["Vans used", (r) => n(r.totals.routes), "routes"],
    ["Nominal cost", (r) => n(r.objective.total), "nominal"],
    ["Uncollected prizes", (r) => n(r.objective.uncollected_prizes ?? 0), "uncollected"],
    ["PyVRP objective (nominal + uncollected)", (r) => n(r.objective.objective_with_prizes ?? r.objective.total), "objective"],
    ["Prizes collected (information)", (r) => n(r.objective.prizes_collected ?? 0), "collected"],
  ]
  return (
    <section className="flex flex-col gap-3" aria-labelledby="comparison">
      <h2 id="comparison" className="text-base font-semibold">Side by side</h2>
      <div className="overflow-x-auto rounded-xl border">
        <Table aria-label="Side-by-side comparison" data-testid="prizes-comparison">
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
                  <TableCell key={c.key} className="min-w-36 text-xs text-pretty tabular-nums" data-testid={`prizes-${c.key}-${id}`}>{value(c.detail.result!)}</TableCell>
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
