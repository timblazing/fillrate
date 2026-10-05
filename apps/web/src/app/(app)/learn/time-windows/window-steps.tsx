"use client"

import { ArrowRight, Play, RotateCcw } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { Step, useLessonState, wholeNumber } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.windows"

type Params = { seed: string }
type Job = "windows" | "open"

/**
 * The time windows lesson's three steps (spec §13). Steps start real runs of the bundled `windows`
 * scenario and its `windows_off` twin (the same stops without windows); parameters and started jobs
 * are remembered per browser, with a reset.
 */
export function WindowSteps({ open, closedNote = "Starting runs is disabled on this server.", runKey }: { open: boolean; closedNote?: string; runKey?: string }) {
  const { params, jobs, pending, setParam, start, reset } = useLessonState<Params, Job>(STORAGE_KEY, { seed: "0" }, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""

  const runBody = (example: "windows" | "windows_off") => () => ({ example, settings: { solver_seed: wholeNumber(params.seed, 0, 1_000_000, "Solver seed") } })

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
        title="Plan with the windows"
        observe={[
          "The plan is valid and complete: all 13 pallets ship, and the capacity lower bound is 1 truck.",
          "Shipments: 2, although one trailer holds all the freight. The solver found no single route that starts every delivery inside its window and finishes by 20:00; step 3 shows the windows are the reason.",
          "Loaded miles: about 225.",
          "Every solver seed from 0 to 3 gives the same two routes. The validator recomputes each arrival from the travel durations and rejects any service start outside its window.",
        ]}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lesson-seed">Solver seed</Label>
          <Input id="lesson-seed" value={params.seed} onChange={(e) => setParam({ seed: e.target.value })} className="w-24 font-mono" />
        </div>
        <Button disabled={!open} loading={pending === "windows"} onClick={() => start("windows", "/api/v1/runs", runBody("windows"))}>
          <Play aria-hidden /> Run the pipeline
        </Button>
        {openLink("windows", "Open run")}
      </Step>

      <Step
        n={2}
        title="Read the Timeline: waiting and service"
        observe={[
          "On the run page, open the Timeline tab. Times are local to America/Chicago; both trucks leave the DC at 06:00.",
          "The six-stop truck reaches the bakery supply at 10:42 and waits 2 h 17 min for its 13:00 window. With short waits at the restaurant depot and the pharmacy, it waits 2 h 45 min in all. The three-stop truck never waits.",
          "Each stop lists Wait, Service and Window. Service is the customer's unloading time (60 min at the builder yard, 10 at the pharmacy): 4 h 25 min across the nine stops, the same in every plan.",
          "Waiting costs nothing in this objective, which counts trucks, then miles. A long wait is accepted when it saves a truck or miles.",
          "Return to Memphis DC: not planned. Routes are open, so each truck's day ends at its last departure.",
        ]}
      >
        {jobs.windows ? openLink("windows", "Open the step 1 run") : <p className="text-muted-foreground text-sm">Run step 1 first.</p>}
      </Step>

      <Step
        n={3}
        title="Remove the windows"
        observe={[
          "The same stops, freight, service minutes and 06:00–20:00 day, with every window removed. One truck now carries everything, about 177 loaded miles instead of 225.",
          "It never waits and finishes at 17:30. Compare its stop times with the windows in the table above: 6 of the 7 windowed customers would be served outside their windows (2 too early, 4 too late); only the bakery supply falls inside.",
          "The two runs answer different questions, so they are never ranked against each other. The cheaper plan is not a better answer when the customers' windows are real.",
        ]}
      >
        <Button disabled={!open} loading={pending === "open"} onClick={() => start("open", "/api/v1/runs", runBody("windows_off"))}>
          <Play aria-hidden /> Run without windows
        </Button>
        {openLink("open", "Open run without windows")}
      </Step>

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={reset}>
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Restores the starting values and forgets which runs this browser started. Runs already made stay under Runs.</p>
      </div>
    </div>
  )
}
