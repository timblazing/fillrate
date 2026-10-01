"use client"

import { ArrowRight, FlaskConical, Play, RotateCcw, ScanSearch } from "lucide-react"
import Link from "next/link"
import { useState, useSyncExternalStore, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toastManager } from "@/components/ui/toast"

const STORAGE_KEY = "fillrate.lesson.fulfillment"
const CHANGE_EVENT = "fillrate-lesson-change"

type Params = { k: string; inventory: string; exploreK: string; sweepKs: string; sweepSeeds: string }
type Jobs = { run?: string; explorer?: string; sweep?: string }
type Saved = { params?: Partial<Params>; jobs?: Jobs }

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
function write(next: Saved | null) {
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT))
}
function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener("storage", callback)
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener("storage", callback)
  }
}
function parse(raw: string | null): Saved {
  try {
    return raw ? (JSON.parse(raw) as Saved) : {}
  } catch {
    return {}
  }
}

function list(raw: string, min: number, max: number) {
  const values = [...new Set(raw.split(/[\s,]+/).filter(Boolean).map(Number))]
  if (!values.length || values.some((v) => !Number.isInteger(v) || v < min || v > max)) throw new Error(`Use whole numbers from ${min} to ${max}, separated by commas.`)
  return values
}

/**
 * The lesson's four steps. Parameters and the jobs each step started are remembered per browser
 * (spec §13: editable starter scenario with a reset action); the runs themselves are durable.
 */
export function LessonSteps({ open, runKey, defaultK, sweepLimit, iterations }: { open: boolean; runKey?: string; defaultK: number; sweepLimit: number; iterations: number | null }) {
  const defaults: Params = { k: String(defaultK), inventory: "100", exploreK: String(defaultK), sweepKs: "6, 8, 10, 12", sweepSeeds: "0, 1" }
  const saved = parse(useSyncExternalStore(subscribe, read, () => null))
  const params = { ...defaults, ...saved.params }
  const jobs = saved.jobs ?? {}
  const [pending, setPending] = useState<keyof Jobs | null>(null)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""

  const setParam = (patch: Partial<Params>) => write({ ...saved, params: { ...saved.params, ...patch } })

  async function start(job: keyof Jobs, path: string, body: () => unknown) {
    setPending(job)
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), ...(runKey ? { "x-run-key": runKey } : {}) },
        body: JSON.stringify(body()),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? "Request failed.")
      write({ ...saved, jobs: { ...jobs, [job]: json.id } })
    } catch (error) {
      toastManager.add({ type: "error", title: "Not started", description: error instanceof Error ? error.message : undefined })
    } finally {
      setPending(null)
    }
  }

  const int = (raw: string, min: number, max: number, name: string) => {
    const n = Number(raw)
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`)
    return n
  }
  const runBody = () => ({ example: "lesson", settings: { k: int(params.k, 1, 25, "k"), inventory_percent: int(params.inventory, 0, 100, "Inventory") } })
  const explorerBody = () => {
    const k = int(params.exploreK, 1, 24, "k")
    return { example: "lesson", settings: { ks: [k, k + 1], selected_k: k } }
  }
  const sweepBody = () => ({ example: "lesson", name: "Lesson sweep", axes: { k: list(params.sweepKs, 1, 25), kmeans_seed: list(params.sweepSeeds, 0, 1000) } })
  let sweepCount: number | null = null
  try {
    sweepCount = list(params.sweepKs, 1, 25).length * list(params.sweepSeeds, 0, 1000).length
  } catch {}

  const field = (id: keyof Params, label: string, width = "w-24") => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`lesson-${id}`}>{label}</Label>
      <Input id={`lesson-${id}`} value={params[id]} onChange={(e) => setParam({ [id]: e.target.value })} className={`${width} font-mono`} />
    </div>
  )
  const openLink = (job: keyof Jobs, href: string, label: string) =>
    jobs[job] && (
      <Button variant="outline" render={<Link href={`${href}/${jobs[job]}${suffix}`} />}>
        {label} <ArrowRight aria-hidden />
      </Button>
    )

  return (
    <div className="flex flex-col gap-8">
      {!open && <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">Starting runs is disabled on this server, so the steps below are read-only.</p>}

      <Step n={1} title="Allocate scarce stock and build shipments" observe={[
        "Allocation gives stock by order date, then by value per piece. Full pallets and carpet rolls run out, so about 84% of the ordered value is allocated; the rest shows as Unshipped with “No stock”.",
        `At k = 8 the plan is valid and complete: about 443 shipments averaging about 96% full, against a capacity lower bound of 426${iterations ? ` (the lesson caps PyVRP at ${iterations} iterations per cluster)` : ""}.`,
        "Every allocated piece ships: planned revenue equals allocated revenue.",
        "Try k = 4: one cluster of about 270 stops does not solve within the budget, so the plan is invalid and partial while the other clusters stay validated. Try Inventory 80%: fewer shipments, less revenue.",
      ]}>
        {field("k", "Clusters (k)", "w-20")}
        {field("inventory", "Inventory %", "w-20")}
        <Button disabled={!open} loading={pending === "run"} onClick={() => start("run", "/api/v1/runs", runBody)}>
          <Play aria-hidden /> Run the pipeline
        </Button>
        {openLink("run", "/runs", "Open run")}
      </Step>

      <Step n={2} title="Pick k with the explorer" observe={[
        "The explorer clusters the same stops for k and k + 1 with seeds 0–9 and H3 cells at resolutions 1–3, without solving any shipments (23 clustering tasks).",
        "With eight markets, k = 8 groups the stops the same way for every seed (stability 1.00); k = 9 splits a market differently depending on the seed, so its stability drops.",
        "The error sum falls quickly up to k = 8 and flattens after it: the elbow.",
        "“Use this k” starts a pipeline run with the chosen k and seed.",
      ]}>
        {field("exploreK", "Explore k and k + 1", "w-20")}
        <Button variant="outline" disabled={!open} loading={pending === "explorer"} onClick={() => start("explorer", "/api/v1/explorer", explorerBody)}>
          <ScanSearch aria-hidden /> Explore k
        </Button>
        {openLink("explorer", "/explore", "Open explorer")}
      </Step>

      <Step n={3} title="Read the per-cluster loads" observe={[
        "On the run page, the Map tab colors each cluster, and its cluster table is the keyboard equivalent: one row per cluster with its shipments and fill.",
        "Shipments tab: each 53 ft trailer with its stops, fill % and miles. Shipments under 80% full are flagged; select one to see its trailer to scale.",
        "The sum of per-cluster lower bounds (about 428 at k = 8) is never below the whole-plan bound (426): splitting into clusters can only cost trailers.",
        "Unshipped tab: only stock shortages, grouped by product.",
      ]}>
        {jobs.run ? openLink("run", "/runs", "Open the step 1 run") : <p className="text-muted-foreground text-sm">Run step 1 first.</p>}
      </Step>

      <Step n={4} title="Compare a sweep and rank the options" observe={[
        "Each combination is a fresh run. Allocation is fixed, so every complete plan has the same planned revenue and the ranking falls through to fewest shipments, then fewest loaded miles.",
        "Expect k = 8 near the top and k = 6 or 12 lower: too few clusters make large solves; too many cut good shipments apart.",
        "Repeated k-means seeds at k = 8 give the same partition, so their results tie (shared rank).",
        "Best option, 2nd best and 3rd are ranked only among valid, complete plans made under the same assumptions; the order is visible and editable on the sweep page.",
      ]}>
        {field("sweepKs", "k values", "w-36")}
        {field("sweepSeeds", "k-means seeds", "w-24")}
        <Button disabled={!open || sweepCount === null || sweepCount > sweepLimit} loading={pending === "sweep"} onClick={() => start("sweep", "/api/v1/experiments", sweepBody)}>
          <FlaskConical aria-hidden /> Start {sweepCount ?? "?"} runs
        </Button>
        {openLink("sweep", "/experiments", "Open sweep")}
        {sweepCount !== null && sweepCount > sweepLimit && <p role="alert" className="text-destructive-foreground text-sm">The limit is {sweepLimit} runs.</p>}
      </Step>

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button variant="outline" onClick={() => write(null)}>
          <RotateCcw aria-hidden /> Reset lesson
        </Button>
        <p className="text-muted-foreground text-xs text-pretty">Restores the starting values and forgets which runs this browser started. Runs already made stay under Runs and Sweeps.</p>
      </div>
    </div>
  )
}

function Step({ n, title, observe, children }: { n: number; title: string; observe: string[]; children: ReactNode }) {
  return (
    <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-labelledby={`step-${n}`}>
      <div className="flex flex-col gap-3">
        <h2 id={`step-${n}`} className="text-lg font-semibold tracking-tight">
          <span className="text-muted-foreground tabular-nums">{n}.</span> {title}
        </h2>
        <div className="flex flex-wrap items-end gap-3">{children}</div>
      </div>
      <div className="bg-card rounded-xl border p-4">
        <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase">What to look for</h3>
        <ul className="list-disc space-y-1.5 pl-4 text-sm text-pretty">
          {observe.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
