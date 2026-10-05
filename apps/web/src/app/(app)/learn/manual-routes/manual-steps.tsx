"use client"

import { ArrowRight, Play, RotateCcw, Scale } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { toastManager } from "@/components/ui/toast"
import { shipmentLabel } from "@/lib/copy"

import { type Evaluation, PlanComparison } from "../../runs/plan-comparison"
import { Step, useLessonState } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.manual"

type Plans = { in_order: string[][]; east_west: string[][] }
type PlanName = keyof Plans

/**
 * The manual routes lesson (spec §10, §13): step 1 starts a real run of the bundled `manual` scenario; steps 2
 * and 3 evaluate the dispatcher plans stored with that example against it through the same endpoint the run
 * page's Manual plan tab uses. Started runs are remembered per browser; evaluations are not stored anywhere.
 */
export function ManualSteps({ open, closedNote, runKey, plans, labels }: { open: boolean; closedNote: string; runKey?: string; plans: Plans; labels: Record<string, string> }) {
  const { jobs, pending, start, reset } = useLessonState<Record<string, string>, "run">(STORAGE_KEY, {}, runKey)
  const [results, setResults] = useState<Partial<Record<PlanName, Evaluation>>>({})
  const [evaluating, setEvaluating] = useState<PlanName | null>(null)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""
  const headers: Record<string, string> = runKey ? { "x-run-key": runKey } : {}
  const places = new Map(Object.entries(labels))
  const runId = jobs.run

  async function evaluate(name: PlanName) {
    if (!runId) return
    setEvaluating(name)
    try {
      const context = await fetch(`/api/v1/runs/${runId}/evaluate?cluster=C1`, { headers, cache: "no-store" })
      const ctx = await context.json()
      if (!context.ok) throw new Error(context.status === 409 ? "Wait for the step 1 run to finish, then evaluate." : (ctx.error?.message ?? "Could not load the run."))
      // Every stop in this scenario is one visit, so a location ID names its visit.
      const visit = new Map((ctx.visits as { visit_id: string; location_id: string }[]).map((v) => [v.location_id, v.visit_id]))
      const routes = plans[name].map((route) => route.map((loc) => visit.get(loc) ?? loc))
      const res = await fetch(`/api/v1/runs/${runId}/evaluate`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ cluster_id: "C1", routes }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error?.message ?? "Evaluation failed.")
      setResults((r) => ({ ...r, [name]: body as Evaluation }))
    } catch (error) {
      toastManager.add({ type: "error", title: "Not evaluated", description: error instanceof Error ? error.message : undefined })
    } finally {
      setEvaluating(null)
    }
  }

  const planList = (name: PlanName) => (
    <ol className="flex w-full flex-col gap-1 text-sm">
      {plans[name].map((route, i) => (
        <li key={i}>
          <span className="font-medium">{shipmentLabel(i + 1)}:</span> {route.map((loc) => labels[loc] ?? loc).join(" → ")}
        </li>
      ))}
    </ol>
  )
  const evaluateButton = (name: PlanName, label: string) => (
    <Button disabled={!open || !runId} loading={evaluating === name} onClick={() => evaluate(name)}>
      <Scale aria-hidden /> {label}
    </Button>
  )

  return (
    <div className="flex flex-col gap-8">
      {!open && <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">{closedNote} The steps below are read-only.</p>}

      <Step
        n={1}
        title="Let the solver plan"
        observe={[
          "The plan is valid and complete with 3 shipments, the capacity lower bound: 29 pallets, 13 to a trailer.",
          "Loaded miles: about 273. Each shipment works one part of the map: the east side, the west side, and the stops north of the DC.",
          "Solver seeds 0 to 3 give the same 273 miles. The number is the solver's best found plan, not a proven optimum.",
        ]}
      >
        <Button disabled={!open} loading={pending === "run"} onClick={() => start("run", "/api/v1/runs", () => ({ example: "manual" }))}>
          <Play aria-hidden /> Run the pipeline
        </Button>
        {runId && (
          <Button variant="outline" render={<Link href={`/runs/${runId}${suffix}`} />}>
            Open run <ArrowRight aria-hidden />
          </Button>
        )}
      </Step>

      <Step
        n={2}
        title="Load trucks in order-number sequence"
        observe={[
          "A dispatcher fills each trailer with the next orders in sequence until one does not fit, and drives them in that order.",
          "The evaluator calls the plan valid: every stop is on a shipment, no trailer is over 53 ft and no drive is over 500 mi. It also uses 3 shipments.",
          "But it drives about 714 loaded miles against the optimized 273, more than 2.6 times as far, because the order numbers run around the map: shipment 1 goes east to the hardware store, then 90 mi west to the garden center.",
          "Revenue and average fill are the same; with the same truck count, the objective differs only by the extra meters.",
        ]}
      >
        {planList("in_order")}
        {evaluateButton("in_order", "Evaluate the order-sequence plan")}
        {!runId && <p className="text-muted-foreground text-sm">Run step 1 first.</p>}
      </Step>
      {results.in_order && <PlanComparison result={results.in_order} places={places} />}

      <Step
        n={3}
        title="Split the map east and west"
        observe={[
          "Two shipments, one per side of the DC: fewer trucks than the lower bound of 3, which is only possible by overloading one.",
          "The evaluator rejects the plan with one concrete violation: shipment 2 load 6400 > capacity 5300 (16 pallets, 64 ft, on a 53 ft trailer).",
          "Its miles and objective are shown but mean nothing: an invalid plan is never ranked against a valid one.",
        ]}
      >
        {planList("east_west")}
        {evaluateButton("east_west", "Evaluate the east–west plan")}
      </Step>
      {results.east_west && <PlanComparison result={results.east_west} places={places} />}

      <Step
        n={4}
        title="Edit a plan yourself"
        observe={[
          "On the run page, open the Manual plan tab. It starts from the optimized shipments; move stops earlier or later, or to another shipment, from the keyboard or the mouse.",
          "Evaluate shows the optimized and manual plans side by side and lists every violation with its shipment and stop. Reset returns to the optimized routes.",
          "Evaluations are not saved, and a valid manual plan is a baseline, not a solver result.",
        ]}
      >
        {runId ? (
          <Button variant="outline" render={<Link href={`/runs/${runId}${suffix}`} />}>
            Open the step 1 run <ArrowRight aria-hidden />
          </Button>
        ) : (
          <p className="text-muted-foreground text-sm">Run step 1 first.</p>
        )}
      </Step>

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button
          variant="outline"
          onClick={() => {
            reset()
            setResults({})
          }}
        >
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Forgets which run this browser started and clears the evaluations. Runs already made stay under Runs.</p>
      </div>
    </div>
  )
}
