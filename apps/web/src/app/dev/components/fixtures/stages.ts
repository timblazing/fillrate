"use client"

import { useEffect, useState } from "react"

import type { JobState } from "@/components/lab/job-status"
import type { PipelineStage } from "@/components/lab/pipeline-stages"
import type { PlanFlowStep } from "@/components/lab/plan-flow"
import type { StageId } from "@/lib/fulfillment"
import { formatCount, formatMoney, formatPercent, plural } from "@/lib/units"

import type { PipelineResult } from "./pipeline"

// Playback durations (ms) for the gallery's simulated live run. Solve runs one cluster at a time
// (default worker concurrency 1, spec §9).
const pace: Record<Exclude<StageId, "solve">, number> & { solvePerCluster: number } = {
  allocate: 500,
  aggregate: 350,
  cluster: 800,
  solvePerCluster: 650,
  validate: 300,
  metrics: 250,
}

export function stageSummaries(run: PipelineResult): Record<StageId, string> {
  const eligible = run.lines.filter((l) => !run.unshipped.some((u) => u.lineId === l.id && u.reason === "data-quality"))
  const filled = eligible.filter((l) => l.allocated === l.ordered).length
  const partial = eligible.filter((l) => l.allocated > 0 && l.allocated < l.ordered).length
  const beyond = run.stops.filter((s) => s.depotMiles > run.settings.maxLegMiles).length
  return {
    allocate: `${formatCount(filled)} of ${formatCount(eligible.length)} lines filled, ${partial} partly · ${formatMoney(run.metrics.revenueAllocated, { compact: true })}`,
    aggregate: `${run.splits.length} split over one trailer`,
    cluster: `k = ${run.metrics.k}${run.settings.k === "auto" ? " (auto)" : ""} · ${run.repairs.length} repairs · ${beyond} beyond leg limit`,
    solve: "10 s search per cluster",
    validate: `All ${formatCount(run.metrics.trucks)} trucks pass load, leg, and diameter checks`,
    metrics: "Each unshipped line has a reason",
  }
}

/** The run as business objects: what came in, what got stock, and what ended up on a truck. */
export function planFlowSteps(run: PipelineResult): PlanFlowStep[] {
  const orders = new Set(run.lines.map((l) => l.orderId)).size
  const allocated = run.lines.filter((l) => l.allocated > 0).length
  const count = (reason: string) => run.unshipped.filter((u) => u.reason === reason).length
  const noStock = count("no-stock")
  const excluded = count("data-quality")
  const notLoaded = count("unreachable") + count("did-not-fit")
  return [
    { id: "orders", label: "Orders", value: formatCount(orders), detail: `${formatCount(run.lines.length)} lines · ${formatMoney(run.metrics.revenueOrdered, { compact: true })}` },
    {
      id: "allocated",
      label: "Allocated",
      value: formatCount(allocated),
      detail: `of ${formatCount(run.lines.length)} lines got stock`,
      drop: [noStock && `${formatCount(noStock)} no stock`, excluded && `${formatCount(excluded)} excluded`].filter(Boolean).join(" · ") || undefined,
    },
    { id: "stops", label: "Stops", value: formatCount(run.stops.length), detail: `${plural(run.splits.length, "split stop")} over one trailer` },
    { id: "clusters", label: "Clusters", value: formatCount(run.clusters.length), detail: `${run.settings.k === "auto" ? "auto k" : `k = ${run.settings.k}`} · ${plural(run.repairs.length, "repair")}` },
    {
      id: "trucks",
      label: "Trucks",
      value: formatCount(run.metrics.trucks),
      detail: `${formatPercent(run.metrics.avgFill)} avg fill`,
      drop: notLoaded ? `${formatCount(notLoaded)} lines not loaded` : undefined,
    },
    {
      id: "shipped",
      label: "Shipped",
      value: formatMoney(run.metrics.revenueShipped, { compact: true }),
      detail: `${formatPercent(run.metrics.revenueShipped / run.metrics.revenueOrdered)} of ordered`,
      drop: `${formatCount(run.unshipped.length)} lines unshipped`,
    },
  ]
}

function stageOutputs(run: PipelineResult): Record<StageId, PipelineStage["output"]> {
  return {
    allocate: { value: formatCount(run.lines.filter((l) => l.allocated > 0).length), label: "lines allocated" },
    aggregate: { value: formatCount(run.stops.length), label: "stops" },
    cluster: { value: formatCount(run.clusters.length), label: "clusters" },
    solve: { value: formatCount(run.metrics.trucks), label: "trucks" },
    validate: { value: "0", label: "violations" },
    metrics: { value: formatCount(run.unshipped.length), label: "unshipped lines" },
  }
}

/** Stage list at `elapsed` ms into a simulated run; `"done"` returns the finished run. */
export function stagesAt(run: PipelineResult, elapsed: number | "done"): PipelineStage[] {
  const summary = stageSummaries(run)
  const outputs = stageOutputs(run)
  const order: StageId[] = ["allocate", "aggregate", "cluster", "solve", "validate", "metrics"]
  const labels: Record<StageId, string> = {
    allocate: "Allocate",
    aggregate: "Aggregate",
    cluster: "Cluster",
    solve: "Solve loads",
    validate: "Validate",
    metrics: "Metrics",
  }
  const durations = order.map((id) => (id === "solve" ? pace.solvePerCluster * run.clusters.length : pace[id]))
  let t = 0
  return order.map((id, i) => {
    const start = t
    const end = t + durations[i]
    t = end
    const state: JobState = elapsed === "done" || elapsed >= end ? "succeeded" : elapsed >= start ? "running" : "queued"
    const stage: PipelineStage = {
      id,
      label: labels[id],
      state,
      seconds: run.timings[id],
      summary: state === "succeeded" ? summary[id] : undefined,
      output: state === "succeeded" ? outputs[id] : undefined,
    }
    if (id === "solve") {
      stage.jobs = run.clusters.map((c, ci) => {
        const js = start + ci * pace.solvePerCluster
        const je = js + pace.solvePerCluster
        const jobState: JobState =
          elapsed === "done" || elapsed >= je ? "succeeded" : elapsed >= js ? "running" : "queued"
        return {
          id: `job-solve-c${c.id}`,
          cluster: c.id,
          state: jobState,
          detail: `${plural(c.stops.length, "stop")} → ${plural(c.trucks.length, "truck")} · PyVRP seed 0 · 10 s`,
        }
      })
      if (state === "running") {
        const doneJobs = stage.jobs.filter((j) => j.state === "succeeded").length
        stage.summary = `Cluster ${Math.min(doneJobs + 1, run.clusters.length)} of ${run.clusters.length}…`
      }
    }
    return stage
  })
}

export function totalDuration(run: PipelineResult) {
  return pace.allocate + pace.aggregate + pace.cluster + pace.solvePerCluster * run.clusters.length + pace.validate + pace.metrics
}

/** Plays a pipeline run forward in the gallery. Real runs poll persisted job state instead (spec §9). */
export function useSimulatedRun(run: PipelineResult) {
  const [elapsed, setElapsed] = useState<number | "done" | null>("done")
  const total = totalDuration(run)
  const running = typeof elapsed === "number"

  useEffect(() => {
    if (!running) return
    const began = performance.now() - (elapsed as number)
    const id = setInterval(() => {
      const e = performance.now() - began
      setElapsed(e >= total ? "done" : e)
    }, 80)
    return () => clearInterval(id)
    // Restart the interval only when a run starts or stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, total])

  return {
    stages: stagesAt(run, elapsed ?? 0),
    running,
    progress: elapsed === "done" ? 1 : elapsed == null ? 0 : elapsed / total,
    start: () => setElapsed(0),
    reset: () => setElapsed(null),
  }
}
