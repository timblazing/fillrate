"use client"

import { ArrowRight, FlaskConical, Play, RotateCcw } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { Step, useLessonState, wholeNumber } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.capacity"

type Params = { inventory: string; sweepInventory: string }
type Job = "run" | "sweep"

function list(raw: string, min: number, max: number) {
  const values = [...new Set(raw.split(/[\s,]+/).filter(Boolean).map(Number))]
  if (!values.length || values.some((v) => !Number.isInteger(v) || v < min || v > max)) throw new Error(`Use whole numbers from ${min} to ${max}, separated by commas.`)
  return values
}

/**
 * The truck capacity lesson's three steps (spec §13). Every step starts a real run of the bundled
 * `capacity` scenario; parameters and started jobs are remembered per browser, with a reset.
 */
export function CapacitySteps({ open, closedNote = "Starting runs is disabled on this server.", runKey }: { open: boolean; closedNote?: string; runKey?: string }) {
  const { params, jobs, pending, setParam, start, reset } = useLessonState<Params, Job>(STORAGE_KEY, { inventory: "100", sweepInventory: "100, 70, 50, 25" }, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""

  const runBody = () => ({ example: "capacity", settings: { inventory_percent: wholeNumber(params.inventory, 0, 100, "Inventory") } })
  const sweepBody = () => ({ example: "capacity", name: "Capacity lesson sweep", axes: { inventory_percent: list(params.sweepInventory, 0, 100) } })
  let sweepCount: number | null = null
  try {
    sweepCount = list(params.sweepInventory, 0, 100).length
  } catch {}

  const field = (id: keyof Params, label: string, width = "w-24") => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`lesson-${id}`}>{label}</Label>
      <Input id={`lesson-${id}`} value={params[id]} onChange={(e) => setParam({ [id]: e.target.value })} className={`${width} font-mono`} />
    </div>
  )
  const openLink = (job: Job, href: string, label: string) =>
    jobs[job] && (
      <Button variant="outline" render={<Link href={`${href}/${jobs[job]}${suffix}`} />}>
        {label} <ArrowRight aria-hidden />
      </Button>
    )

  return (
    <div className="flex flex-col gap-8">
      {!open && <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">{closedNote} The steps below are read-only.</p>}

      <Step
        n={1}
        title="Fill the trailers"
        observe={[
          "The plan is valid and complete: every ordered piece ships because stock is not short.",
          "Shipments: 13, the same as the capacity lower bound (66,750 hundredths of a foot ÷ 5,300, rounded up). Trucks beyond the bound would be waste; a solver that finds the bound cannot do better.",
          "Average fill is about 97% and the emptiest shipment about 91%. No shipment is over 100%: the validator rejects any truck whose load exceeds 53 ft.",
          "Try Inventory 70%: less freight needs fewer trucks (9), but the fill stays near 97%.",
        ]}
      >
        {field("inventory", "Inventory %", "w-20")}
        <Button disabled={!open} loading={pending === "run"} onClick={() => start("run", "/api/v1/runs", runBody)}>
          <Play aria-hidden /> Run the pipeline
        </Button>
        {openLink("run", "/runs", "Open run")}
      </Step>

      <Step
        n={2}
        title="Read the shipments and the oversize stop"
        observe={[
          "On the run page, Preflight flags one oversize stop warning: the big-box warehouse orders 120 ft of pallets, more than two trailers.",
          "In the Shipments tab it appears on three shipments: 13 pallets (52 ft), 13 pallets (52 ft) and 4 pallets (16 ft). Whole pallets fill a trailer first, so the two 52 ft pieces ride alone and the 16 ft remainder shares a truck with other stops.",
          "Each shipment's fill is its load divided by 53 ft. Select one to see its trailer drawn to scale.",
          "The summary tiles show the capacity lower bound beside the shipment count. When they match, capacity, not routing, set the number of trucks.",
        ]}
      >
        {jobs.run ? openLink("run", "/runs", "Open the step 1 run") : <p className="text-muted-foreground text-sm">Run step 1 first.</p>}
      </Step>

      <Step
        n={3}
        title="Compare how much freight there is"
        observe={[
          "Each inventory percent is a changed assumption, so the runs form separate cohorts and are never ranked against each other.",
          "With the starting list, shipments fall 13, 9, 7 and 4 as freight falls from 66,750 to 46,300, 33,000 and 16,400 hundredths of a foot. Each run uses exactly its capacity lower bound.",
          "Average fill is about 97%, 97%, 89% and 77%: with less freight the last trailers are only partly used, and the emptiest shipment drops from about 91% to 62%.",
          "Lower inventory also leaves unshipped lines, all under “No stock”: a shortage is a stock problem, never an overloaded truck.",
        ]}
      >
        {field("sweepInventory", "Inventory percents", "w-40")}
        <Button disabled={!open || sweepCount === null} loading={pending === "sweep"} onClick={() => start("sweep", "/api/v1/experiments", sweepBody)}>
          <FlaskConical aria-hidden /> Start {sweepCount ?? "?"} runs
        </Button>
        {openLink("sweep", "/experiments", "Open sweep")}
      </Step>

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={reset}>
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Restores the starting values and forgets which runs this browser started. Runs already made stay under Runs and Sweeps.</p>
      </div>
    </div>
  )
}
