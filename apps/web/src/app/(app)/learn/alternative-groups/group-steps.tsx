"use client"

import type { LabInstance, LabResult } from "@fillrate/contracts"
import { ArrowRight, Play, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { LabPlot } from "@/components/lab/lab-plot"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

import { Step, useLessonState } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.groups"
const ACTIVE = new Set(["queued", "claimed", "running"])
const n = (value: number) => value.toLocaleString("en-US")

type Job = "north" | "south"
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
 * The alternative groups lesson's steps (spec §13): the bundled `groups` example (required stops on the north side)
 * and its `groups_south` twin (stops on the south side), then both persisted results side by side. Started jobs are
 * remembered per browser, with a reset.
 */
export function GroupSteps({ open, closedNote = "Starting runs is disabled on this server.", runKey }: { open: boolean; closedNote?: string; runKey?: string }) {
  const { jobs, pending, start, reset } = useLessonState<Record<string, string>, Job>(STORAGE_KEY, {}, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""
  const north = useLabRun(jobs.north)
  const south = useLabRun(jobs.south)

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
        title="Plan with the stops in the north"
        observe={[
          "The plan is validated feasible: one van, five visits, exactly one of Acme's two docks. The Groups table on the run page names it: the north dock.",
          "The other dock is not visited and is not a skipped prize: it is an alternative the plan did not need.",
          "Nominal cost 312: 100 for the van plus 212 of distance. Every seed from 0 to 3 picks the same dock.",
          "Serving the south dock in the same position instead would be a valid plan but longer, so the choice is the cheaper one, not an arbitrary one.",
        ]}
      >
        <Button disabled={!open} loading={pending === "north"} onClick={() => start("north", "/api/v1/lab/runs", () => ({ example: "groups" }))}>
          <Play aria-hidden /> Run with stops in the north
        </Button>
        {openLink("north", "Open north run")}
      </Step>

      <Step
        n={2}
        title="Move the stops to the south"
        observe={[
          "The same docks and parcels, with the four required stops mirrored to the south side of the depot.",
          "Now the south dock wins. Nothing about the docks changed: the other stops decided which alternative is cheaper to serve.",
          "The instance is a mirror image of step 1, so the nominal cost is again 312.",
        ]}
      >
        <Button disabled={!open} loading={pending === "south"} onClick={() => start("south", "/api/v1/lab/runs", () => ({ example: "groups_south" }))}>
          <Play aria-hidden /> Run with stops in the south
        </Button>
        {openLink("south", "Open south run")}
      </Step>

      <Step
        n={3}
        title="Compare the two runs"
        observe={[
          "The two instances have different problem fingerprints (the stops' positions are part of the problem), so the comparison is between two problems, not two seeds of one.",
          "Same group, same costs, different member: the group lets the solver choose where to serve the customer instead of you fixing it in advance.",
          "Fillrate does not know which dock the customer would prefer; a heuristic picked the cheaper one for the routes it found.",
        ]}
      >
        <p className="text-muted-foreground text-sm">
          {north?.result && south?.result
            ? "Both runs finished; the comparison below reads their saved results."
            : jobs.north && jobs.south
              ? "Waiting for both runs to finish…"
              : "Run steps 1 and 2 first; the comparison reads both finished runs."}
        </p>
      </Step>

      {north?.result && south?.result && <Comparison north={north} south={south} />}

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={reset}>
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Forgets which runs this browser started. Runs already made stay under Solver Lab.</p>
      </div>
    </div>
  )
}

function Comparison({ north, south }: { north: Detail; south: Detail }) {
  const cols = [
    { name: "Stops in the north", detail: north, key: "north" },
    { name: "Stops in the south", detail: south, key: "south" },
  ]
  const rows: [string, (r: LabResult) => string, string][] = [
    ["Validated", (r) => (r.validated_feasible ? "feasible" : "failed"), "validated"],
    ["Acme served by", (r) => r.groups?.find((g) => g.group_id === "acme")?.served_by ?? "none", "served"],
    ["Visits", (r) => `${r.totals.clients_served} of ${r.totals.clients_total}`, "visited"],
    ["Vans used", (r) => n(r.totals.routes), "routes"],
    ["Distance (planar units)", (r) => n(r.totals.distance), "distance"],
    ["Nominal cost (cost units)", (r) => n(r.objective.total), "nominal"],
  ]
  return (
    <section className="flex flex-col gap-3" aria-labelledby="comparison">
      <h2 id="comparison" className="text-base font-semibold">Side by side</h2>
      <div className="overflow-x-auto rounded-xl border">
        <Table aria-label="Side-by-side comparison" data-testid="groups-comparison">
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
                  <TableCell key={c.key} className="min-w-36 text-xs text-pretty tabular-nums" data-testid={`groups-${c.key}-${id}`}>{value(c.detail.result!)}</TableCell>
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
