"use client"

import type { LabResult } from "@fillrate/contracts"
import { ArrowRight, Play, RotateCcw } from "lucide-react"
import Link from "next/link"
import { useEffect, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatPercent } from "@/lib/units"

import { Step, useLessonState } from "./lesson-kit"

const ACTIVE = new Set(["queued", "claimed", "running"])

export type LabDetail = { id: string; status: string; result: LabResult | null }

/** Polls one persisted lab run until it finishes; null until the first answer (or when no run was started). */
export function useLabRun(id: string | undefined, runKey?: string) {
  const [detail, setDetail] = useState<LabDetail | null>(null)
  useEffect(() => {
    if (!id) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      const res = await fetch(`/api/v1/lab/runs/${id}`, { cache: "no-store", headers: runKey ? { "x-run-key": runKey } : {} }).catch(() => null)
      if (res?.ok && !stopped) {
        const next = (await res.json()) as LabDetail
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

/** The highest load / capacity over a result's routes for one dimension, or null when the dimension is not in the instance. */
export const maxUtilization = (r: LabResult, dimension: string, vehicleType?: string) => {
  const values = r.routes.filter((route) => !vehicleType || route.vehicle_type === vehicleType).map((route) => route.utilization[dimension]).filter((u) => u !== undefined)
  return values.length ? Math.max(...values) : null
}
export const percentOrDash = (ratio: number | null) => (ratio === null ? "—" : formatPercent(ratio))
export const units = (n: number) => n.toLocaleString("en-US")

export type CompareRow = { key: string; label: string; value: (r: LabResult) => ReactNode }

/** Two persisted lab results side by side; every cell is read from the saved result. */
export function LabCompare({ caption, columns, rows }: { caption: string; columns: [string, LabResult][]; rows: CompareRow[] }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="comparison">
      <h2 id="comparison" className="text-base font-semibold">Side by side</h2>
      <div className="overflow-x-auto rounded-xl border">
        <Table aria-label="Side-by-side comparison" data-testid="lab-compare">
          <TableHeader>
            <TableRow>
              <TableHead />
              {columns.map(([name]) => (
                <TableHead key={name}>{name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} data-row={row.key}>
                <TableCell className="text-muted-foreground">{row.label}</TableCell>
                {columns.map(([name, result]) => (
                  <TableCell key={name} className="min-w-36 text-pretty tabular-nums">{row.value(result)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground text-xs text-pretty">{caption}</p>
    </section>
  )
}

type Job = "first" | "second"

/**
 * Shared shell of the two Solver Lab lessons (spec §13): start two bundled lab examples from the page through
 * `POST /api/v1/lab/runs`, remember them per browser, read both persisted results and offer a reset.
 */
export function LabLessonSteps({
  storageKey, examples, open, closedNote = "Starting runs is disabled on this server.", runKey, steps, compare,
}: {
  storageKey: string
  examples: { first: { id: string; button: string; open: string }; second: { id: string; button: string; open: string } }
  open: boolean
  closedNote?: string
  runKey?: string
  steps: { first: { title: string; observe: string[] }; second: { title: string; observe: string[] }; compare: { title: string; observe: string[] } }
  compare: (first: LabResult, second: LabResult) => ReactNode
}) {
  const { jobs, pending, start, reset } = useLessonState<Record<string, string>, Job>(storageKey, {}, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""
  const first = useLabRun(jobs.first, runKey)
  const second = useLabRun(jobs.second, runKey)
  const ready = first?.result && second?.result

  const stepBody = (job: Job, n: number) => (
    <Step n={n} title={steps[job].title} observe={steps[job].observe}>
      <Button disabled={!open} loading={pending === job} onClick={() => start(job, "/api/v1/lab/runs", () => ({ example: examples[job].id }))}>
        <Play aria-hidden /> {examples[job].button}
      </Button>
      {jobs[job] && (
        <Button variant="outline" render={<Link href={`/labs/${jobs[job]}${suffix}`} />}>
          {examples[job].open} <ArrowRight aria-hidden />
        </Button>
      )}
      {(job === "first" ? first : second)?.status === "failed" && <p className="text-destructive-foreground text-sm" role="alert">This run failed; open it for the reason.</p>}
    </Step>
  )

  return (
    <div className="flex flex-col gap-8">
      {!open && <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">{closedNote} The steps below are read-only.</p>}
      {stepBody("first", 1)}
      {stepBody("second", 2)}
      <Step n={3} title={steps.compare.title} observe={steps.compare.observe}>
        <p className="text-muted-foreground text-sm">
          {ready ? "Both runs finished; the comparison below reads their saved results." : jobs.first && jobs.second ? "Waiting for both runs to finish…" : "Run steps 1 and 2 first; the comparison reads both finished runs."}
        </p>
      </Step>
      {ready && compare(first.result!, second.result!)}
      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={reset}>
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Restores the starting state and forgets which runs this browser started. Runs already made stay under Solver Lab.</p>
      </div>
    </div>
  )
}
