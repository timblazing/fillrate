"use client"

import { ArrowRight, FlaskConical, Play, RotateCcw, ScanSearch } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { Step, useLessonState, wholeNumber } from "../lesson-kit"

const STORAGE_KEY = "fillrate.lesson.seeds"

type Params = { seed: string; solverSeed: string; exploreK: string; sweepSeeds: string }
type Job = "run" | "repeat" | "explorer" | "sweep"

function list(raw: string, min: number, max: number) {
  const values = [...new Set(raw.split(/[\s,]+/).filter(Boolean).map(Number))]
  if (!values.length || values.some((v) => !Number.isInteger(v) || v < min || v > max)) throw new Error(`Use whole numbers from ${min} to ${max}, separated by commas.`)
  return values
}

/**
 * The seed lesson's four steps (spec §13). Every step starts a real run, explorer or sweep of the
 * bundled `seeds` scenario; parameters and started jobs are remembered per browser, with a reset.
 */
export function SeedSteps({ open, closedNote = "Starting runs is disabled on this server.", runKey, sweepLimit, iterations }: { open: boolean; closedNote?: string; runKey?: string; sweepLimit: number; iterations: number | null }) {
  const defaults: Params = { seed: "0", solverSeed: "0", exploreK: "5", sweepSeeds: "0, 1, 2, 3, 4, 5" }
  const { params, jobs, pending, setParam, start, reset } = useLessonState<Params, Job>(STORAGE_KEY, defaults, runKey)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""

  const runBody = () => ({ example: "seeds", settings: { kmeans_seed: wholeNumber(params.seed, 0, 1000, "k-means seed") } })
  const repeatBody = () => ({
    example: "seeds",
    settings: { kmeans_seed: wholeNumber(params.seed, 0, 1000, "k-means seed"), solver_seed: wholeNumber(params.solverSeed, 0, 1000, "Solver seed") },
  })
  const explorerBody = () => {
    const k = wholeNumber(params.exploreK, 1, 24, "k")
    return { example: "seeds", settings: { ks: [k, k + 1], selected_k: k } }
  }
  const sweepBody = () => ({ example: "seeds", name: "Seed lesson sweep", axes: { kmeans_seed: list(params.sweepSeeds, 0, 1000) } })
  let sweepCount: number | null = null
  try {
    sweepCount = list(params.sweepSeeds, 0, 1000).length
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
        title="Cluster with one seed"
        observe={[
          "Seed 0 cuts the 60 stops into clusters of 8, 11, 13, 13 and 15 stops. The plan is valid and complete with 19 shipments, against a capacity lower bound of 17.",
          "Try seeds 1, 2 and 3 with the same k = 5: every seed gives different cluster sizes (seed 2: 7, 7, 13, 15, 18) and so a different plan. Seed 1 needs 20 shipments; seeds 0, 2 and 3 need 19.",
          "Loaded miles move with the seed alone, from about 3,545 (seed 4) to about 3,869 (seed 3), roughly 9% more for the same freight.",
          "The Map tab colors each cluster, so you can see one stop change group between seeds.",
        ]}
      >
        {field("seed", "k-means seed", "w-20")}
        <Button disabled={!open} loading={pending === "run"} onClick={() => start("run", "/api/v1/runs", runBody)}>
          <Play aria-hidden /> Run the pipeline
        </Button>
        {openLink("run", "/runs", "Open run")}
      </Step>

      <Step
        n={2}
        title="Sweep several seeds"
        observe={[
          "Each seed is a fresh run. K-means seed is a method choice, not a changed assumption, so all runs share one cohort and are ranked by the sweep's visible order (best trade-off, planned revenue, fewest shipments, then fewest loaded miles).",
          `With seeds 0 to 5, seed 4 loads the fewest miles (19 shipments, about 3,545 miles) and seed 1 is the only one needing 20 shipments. Six seeds give six different partitions.`,
          "Picking a seed after seeing the results is a choice you make; the plan itself does not prove that seed 4 is a better way to cluster, only a better draw for this freight.",
        ]}
      >
        {field("sweepSeeds", "k-means seeds", "w-40")}
        <Button disabled={!open || sweepCount === null || sweepCount > sweepLimit} loading={pending === "sweep"} onClick={() => start("sweep", "/api/v1/experiments", sweepBody)}>
          <FlaskConical aria-hidden /> Start {sweepCount ?? "?"} runs
        </Button>
        {openLink("sweep", "/experiments", "Open sweep")}
        {sweepCount !== null && sweepCount > sweepLimit && <p role="alert" className="text-destructive-foreground text-sm">The limit is {sweepLimit} runs.</p>}
      </Step>

      <Step
        n={3}
        title="Measure how much the seeds disagree"
        observe={[
          "The explorer clusters the same stops for k and k + 1 with seeds 0 to 9 and three H3 resolutions, without solving any routes (23 clustering tasks).",
          "Stability, the mean pairwise adjusted Rand index between seeds, is about 0.56 at k = 5 and 0.62 at k = 6. Because 1.00 means every seed gives the same grouping, both are low: no k here is seed-proof.",
          "Seed agreement per stop: no stop is grouped the same way by every seed (the best stop agrees with its peers about 84% of the time and the worst about 40%). Compare the fulfillment lesson, where k = 8 reaches 1.00 because the stops form eight markets.",
          "H3 rows are marked deterministic: grid cells depend on no seed, so they repeat exactly.",
        ]}
      >
        {field("exploreK", "Explore k and k + 1", "w-20")}
        <Button variant="outline" disabled={!open} loading={pending === "explorer"} onClick={() => start("explorer", "/api/v1/explorer", explorerBody)}>
          <ScanSearch aria-hidden /> Explore k
        </Button>
        {openLink("explorer", "/explore", "Open explorer")}
      </Step>

      <Step
        n={4}
        title="Repeat a run and change the solver seed"
        observe={[
          `The solver stops after a fixed number of iterations${iterations ? ` (${iterations} per cluster, shown under Solver in Steps)` : ""}, not after a time, so the same k-means seed and solver seed repeat exactly. Compare this run with the step 1 run of the same k-means seed: same clusters, same shipments, same miles.`,
          "Change the solver seed to 1 or 2 with the k-means seed unchanged: this plan does not change. These clusters are small, so the search reaches the same routes whatever its seed; the k-means seed matters far more here.",
          "A time budget would stop at the clock instead. The iterations it reaches differ between runs and machines, so its runtimes are provenance: record them, do not compare them as results. This lesson keeps the budget fixed for that reason.",
        ]}
      >
        {field("solverSeed", "Solver seed", "w-20")}
        <Button variant="outline" disabled={!open} loading={pending === "repeat"} onClick={() => start("repeat", "/api/v1/runs", repeatBody)}>
          <Play aria-hidden /> Run again
        </Button>
        {openLink("repeat", "/runs", "Open repeat run")}
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
