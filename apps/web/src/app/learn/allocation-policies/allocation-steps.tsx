"use client"

import { ArrowRight, FlaskConical, Play, RotateCcw } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

import { Step, useLessonState } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.allocation"

type Params = { strategy: string; policy: string }
type Job = "run" | "sweep"

const STRATEGIES = [
  ["order_date_then_value", "Order date, then value (default)"],
  ["first_come", "First come"],
  ["priority", "Priority, then order date"],
  ["proportional", "Fair share (heuristic)"],
  ["optimized", "Optimized revenue (CP-SAT)"],
] as const
const POLICIES = [
  ["piece", "Partial lines allowed (default)"],
  ["whole_order", "Whole orders only"],
] as const

/**
 * The allocation lesson's three steps (spec §13: scarce stock; piece-level versus whole-order
 * allocation). Every step starts a real run of the bundled `allocation` scenario.
 */
export function AllocationSteps({ open, runKey }: { open: boolean; runKey?: string }) {
  const { params, jobs, pending, setParam, start, reset } = useLessonState<Params, Job>(STORAGE_KEY, { strategy: "order_date_then_value", policy: "piece" }, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""

  const runBody = () => ({ example: "allocation", settings: { allocation_strategy: params.strategy, fulfillment_policy: params.policy } })
  const sweepBody = () => ({
    example: "allocation",
    name: "Allocation lesson sweep",
    axes: { allocation_strategy: STRATEGIES.map(([id]) => id), fulfillment_policy: POLICIES.map(([id]) => id) },
  })

  const select = (id: keyof Params, label: string, options: readonly (readonly [string, string])[]) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`lesson-${id}`}>{label}</Label>
      <select id={`lesson-${id}`} className="bg-background h-9 rounded-md border px-3 text-sm" value={params[id]} onChange={(e) => setParam({ [id]: e.target.value })}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
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
      {!open && <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">Starting runs is disabled on this server, so the steps below are read-only.</p>}

      <Step
        n={1}
        title="Allocate the scarce carpet rolls"
        observe={[
          "Defaults (order date, then value; partial lines allowed): stock goes line by line to the oldest orders first, so the rolls run out partway through the list. 33 orders ship partly filled, 13 get nothing, and no roll is left over.",
          "Switch to Whole orders only: no order ships partly filled. 46 orders get nothing, 11 shipments remain, and allocated revenue falls from about $65,300 to $42,700 of $92,300 ordered.",
          "Switch to Priority, then order date (partial lines): orders with priority 5 are never short; with the default strategy they are short 53 pieces.",
          "Fair share spreads the rolls so every one of the 90 orders is partly filled and none is filled in full.",
        ]}
      >
        {select("strategy", "Allocation", STRATEGIES)}
        {select("policy", "Order fulfillment", POLICIES)}
        <Button disabled={!open} loading={pending === "run"} onClick={() => start("run", "/api/v1/runs", runBody)}>
          <Play aria-hidden /> Run the pipeline
        </Button>
        {openLink("run", "/runs", "Open run")}
      </Step>

      <Step
        n={2}
        title="Find who did not get stock"
        observe={[
          "On the run page, Steps and Provenance name the strategy, the policy and whether the answer is a heuristic or a solver result.",
          "With partial lines, the Unshipped tab lists 46 short lines under “No stock”, all carpet rolls: pallets and cartons have enough stock for every order.",
          "With whole orders only, pallet and carton lines of the dropped orders appear too (19 and 12), also under “No stock”. Their evidence names the order's missing rolls, and 51 pallets and 32 cartons stay on the shelf.",
          "Allocated revenue equals planned revenue. Allocation decides who gets stock; routing never drops an allocated piece in this scenario.",
          "The per-product reconciliation: on hand = allocated + left over. Whole orders leave one carpet roll on the shelf because no remaining order fits.",
        ]}
      >
        {jobs.run ? openLink("run", "/runs", "Open the step 1 run") : <p className="text-muted-foreground text-sm">Run step 1 first.</p>}
      </Step>

      <Step
        n={3}
        title="Compare every strategy and policy"
        observe={[
          "The sweep makes ten runs: five strategies × two policies. Strategy compares within one cohort; Whole orders only is a changed assumption, so it forms its own cohort and is never ranked against partial lines.",
          "Optimized (CP-SAT) is proven optimal here and gives the most allocated revenue under either policy: about $65,800 with partial lines and $64,700 with whole orders only.",
          "Greedy whole-order allocation gives up much more: the date rule allocates only about $42,700. An order that cannot get all its rolls is dropped with its pallets and cartons too, so their value is lost; the solver chooses which orders to drop and loses far less.",
          "With partial lines allowed, every strategy allocates within about 1% of the optimum ($65,200 to $65,800); the policy matters far more than the strategy.",
        ]}
      >
        <Button disabled={!open} loading={pending === "sweep"} onClick={() => start("sweep", "/api/v1/experiments", sweepBody)}>
          <FlaskConical aria-hidden /> Start 10 runs
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
