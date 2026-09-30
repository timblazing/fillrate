"use client"

import { useEffect, useState } from "react"

import type { JobState } from "@/components/lab/job-status"
import type { PipelineStage } from "@/components/lab/pipeline-stages"
import type { StageId } from "@/lib/fulfillment"
import { formatCount, formatMoney } from "@/lib/units"

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
    aggregate: `${formatCount(run.stops.length)} stops · ${run.splits.length} split over one trailer`,
    cluster: `k = ${run.metrics.k}${run.settings.k === "auto" ? " (auto)" : ""} · ${run.repairs.length} repairs · ${beyond} beyond leg limit`,
    solve: `${formatCount(run.metrics.trucks)} trucks · 10 s search per cluster`,
    validate: `${formatCount(run.metrics.trucks)} trucks pass load, leg, and diameter checks`,
    metrics: `${formatCount(run.unshipped.length)} unshipped lines, each with a reason`,
  }
}

/** Stage list at `elapsed` ms into a simulated run; `"done"` returns the finished run. */
export function stagesAt(run: PipelineResult, elapsed: number | "done"): PipelineStage[] {
  const summary = stageSummaries(run)
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
          detail: `${c.stops.length} stops → ${c.trucks.length} trucks · PyVRP seed 0 · 10 s`,
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
