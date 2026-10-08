"use client"

import type { ExplorerSettings, ExplorerSummary } from "@fillrate/contracts"
import { ArrowLeft, Check, Download, FlaskConical, Play } from "lucide-react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { PageTitle } from "@/components/app/page"
import { JobStatusBadge, type JobState } from "@/components/lab/job-status"
import { KElbowChart } from "@/components/lab/k-elbow-chart"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toastManager } from "@/components/ui/toast"
import type { RunDetail } from "@/lib/server/runs"
import { cn } from "@/lib/utils"

import { AGREEMENT_LOW } from "./explorer-map"

const ExplorerMap = dynamic(() => import("./explorer-map"), { ssr: false, loading: () => <div className="bg-muted/40 h-full animate-pulse" /> })
type ExplorerDetail = Extract<RunDetail, { kind: "explorer" }>
const ACTIVE = new Set(["queued", "claimed", "running"])
/** Imported scenarios pick up "Use this k" on /scenarios from this browser key. */
export const USE_K_KEY = "fillrate.use-k.v1"

function usePolled(initial: ExplorerDetail) {
  const [run, setRun] = useState(initial)
  useEffect(() => {
    if (!ACTIVE.has(run.status)) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!document.hidden) {
        const res = await fetch(`/api/v1/runs/${initial.id}`, { cache: "no-store" }).catch(() => null)
        if (res?.ok && !stopped) {
          const next = (await res.json()) as ExplorerDetail
          setRun(next)
          if (!ACTIVE.has(next.status)) return
        }
      }
      if (!stopped) timer = setTimeout(tick, 2_000)
    }
    timer = setTimeout(tick, 1_000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [initial.id, run.status])
  return run
}

export function ExplorerView({ initial, imported, example }: { initial: ExplorerDetail; imported: boolean; example: string | null }) {
  const run = usePolled(initial)
  const settings = run.explorer_settings as unknown as ExplorerSettings
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon-sm" render={<Link href={imported ? "/scenarios" : "/runs"} aria-label="Back" />}>
          <ArrowLeft />
        </Button>
        <PageTitle>k explorer <span className="font-mono">{run.id.slice(0, 8)}</span></PageTitle>
        <JobStatusBadge state={run.status as JobState} />
        <span className="text-muted-foreground text-xs tabular-nums">
          {settings.ks ? `k ${settings.ks.join(", ")}` : "k near the selected value"} · seeds {(settings.seeds ?? []).join(", ")} · H3 {(settings.h3_resolutions ?? []).join(", ") || "none"}
        </span>
        {run.status === "succeeded" && run.explorer && (
          <Button variant="outline" size="sm" className="ml-auto" render={<a href={`/api/v1/runs/${run.id}/export?format=python`} download />}>
            <Download aria-hidden /> Python replay bundle
          </Button>
        )}
      </div>
      <p className="text-muted-foreground max-w-3xl text-sm text-pretty">
        Clustering only: no stock is reallocated and no shipments are solved. The error sum, stability and seed agreement describe how the
        groupings behave across seeds. They are not solver objectives and not a probability that a grouping is correct.
      </p>
      {ACTIVE.has(run.status) && <p className="bg-card rounded-xl border p-4 text-sm">{run.status === "queued" ? "Waiting for a worker…" : `Clustering (${String(run.progress?.stage ?? "starting")})…`}</p>}
      {run.status === "failed" && (
        <Alert variant="error">
          <AlertTitle>{String(run.failure?.code ?? "Explorer failed")}</AlertTitle>
          <AlertDescription>{String(run.failure?.message ?? "The worker reported a failure.")}</AlertDescription>
        </Alert>
      )}
      {run.explorer && <Results summary={run.explorer} imported={imported} example={example} />}
    </>
  )
}

function Results({ summary, imported, example }: { summary: ExplorerSummary; imported: boolean; example: string | null }) {
  const router = useRouter()
  const [repaired, setRepaired] = useState(false)
  const [k, setK] = useState(summary.selected_k)
  const [seed, setSeed] = useState(summary.reference_seed)
  const [pending, setPending] = useState<string | null>(null)
  const stabilityOf = (r: ExplorerSummary["per_k"][number]) => (repaired ? r.stability_repaired : r.stability_raw)
  const ranked = [...summary.per_k].filter((r) => stabilityOf(r) != null).sort((a, b) => stabilityOf(b)! - stabilityOf(a)!)
  const anyRepairs = summary.per_k.some((r) => r.diameter_repairs_by_seed.some(Boolean)) || summary.h3.some((r) => r.diameter_repairs > 0)
  const agreements = summary.locations.map((l) => (repaired ? l.agreement_repaired : l.agreement_raw))
  const low = agreements.filter((a) => a != null && a < AGREEMENT_LOW).length
  const singletons = agreements.filter((a) => a == null).length
  const headers = { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }

  async function useK() {
    if (imported) {
      localStorage.setItem(USE_K_KEY, JSON.stringify({ k, seed, at: Date.now() }))
      router.push("/scenarios")
      return
    }
    setPending("use")
    const res = await fetch("/api/v1/runs", { method: "POST", headers, body: JSON.stringify({ ...(example ? { example } : {}), settings: { k, kmeans_seed: seed } }) })
    const body = await res.json()
    if (!res.ok) {
      toastManager.add({ type: "error", title: "Run not started", description: body.error?.message })
      setPending(null)
      return
    }
    router.push(`/runs/${body.id}`)
  }

  async function agreementAt() {
    setPending("agreement")
    const { base, ...rest } = summary.settings
    const res = await fetch("/api/v1/explorer", { method: "POST", headers, body: JSON.stringify({ ...(imported ? { base } : example ? { example } : {}), settings: { ...rest, kind: undefined, schema_version: undefined, ks: summary.ks, selected_k: k } }) })
    const body = await res.json()
    if (!res.ok) {
      toastManager.add({ type: "error", title: "Explorer not started", description: body.error?.message })
      setPending(null)
      return
    }
    router.push(`/explore/${body.id}`)
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="text-muted-foreground tabular-nums">
            {summary.tasks} of {summary.max_tasks} clustering tasks · {summary.fits} k-means fits · {summary.locations_clustered} locations
          </span>
          <label className="ml-auto flex items-center gap-2">
            <Switch checked={repaired} onCheckedChange={setRepaired} /> After diameter repair
          </label>
        </div>
        <div className="bg-card rounded-xl border p-3">
          <KElbowChart rows={summary.per_k} chosen={k} onChoose={setK} repaired={repaired} />
        </div>
        <div className="bg-card overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>k</TableHead>
                <TableHead className="text-right">Error sum (mean, range)</TableHead>
                <TableHead className="text-right">Clusters</TableHead>
                {anyRepairs && <TableHead className="text-right">Diameter repairs</TableHead>}
                <TableHead className="text-right">Stability</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.per_k.map((r) => (
                <TableRow key={r.k} onClick={() => setK(r.k)} className={cn("cursor-pointer", r.k === k && "bg-muted")} aria-selected={r.k === k}>
                  <TableCell className="font-mono font-medium">
                    <button type="button" className="underline-offset-4 hover:underline" onClick={() => setK(r.k)}>{r.k}</button>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {r.inertia_mean.toPrecision(3)} <span className="text-muted-foreground">({Math.min(...r.inertia_by_seed).toPrecision(3)}–{Math.max(...r.inertia_by_seed).toPrecision(3)})</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{r.raw_cluster_count === r.effective_cluster_count ? r.raw_cluster_count : `${r.raw_cluster_count} → ${r.effective_cluster_count}`}</TableCell>
                  {anyRepairs && <TableCell className="text-right font-mono text-xs tabular-nums">{r.diameter_repairs_by_seed.join(" ")}</TableCell>}
                  <TableCell className="text-right font-mono text-xs tabular-nums">{stabilityOf(r) == null ? "n/a" : stabilityOf(r)!.toFixed(3)}</TableCell>
                  <TableCell className="text-right">{ranked[0]?.k === r.k && summary.per_k.length > 1 && <Badge variant="success" size="sm">most stable</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {summary.h3.length > 0 && (
          <div className="bg-card overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>H3 resolution</TableHead>
                  <TableHead className="text-right">Error sum</TableHead>
                  <TableHead className="text-right">Clusters</TableHead>
                  {anyRepairs && <TableHead className="text-right">Diameter repairs</TableHead>}
                  <TableHead className="text-right">Stability</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.h3.map((r) => (
                  <TableRow key={r.resolution}>
                    <TableCell className="font-mono">{r.resolution}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{r.inertia.toPrecision(3)}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{r.raw_cluster_count === r.effective_cluster_count ? r.raw_cluster_count : `${r.raw_cluster_count} → ${r.effective_cluster_count}`}</TableCell>
                    {anyRepairs && <TableCell className="text-right font-mono text-xs tabular-nums">{r.diameter_repairs}</TableCell>}
                    <TableCell className="text-muted-foreground text-right text-xs">deterministic / not applicable</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-muted-foreground border-t px-3 py-2 text-xs">H3 cells are a fixed grid: the same coordinates always give the same groups. That is not evidence of better clustering.</p>
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">Seed agreement at k = {summary.selected_k} (reference seed {summary.reference_seed})</div>
            <div className="text-muted-foreground text-xs">
              {low} of {summary.locations.length} locations below {Math.round(AGREEMENT_LOW * 100)}% · {singletons} alone in their cluster (n/a) · green ≥ 90%, amber ≥ 70%, red below
            </div>
          </div>
        </div>
        <div className="h-[360px] overflow-hidden rounded-xl border sm:h-[440px]">
          <ExplorerMap summary={summary} repaired={repaired} />
        </div>
        <div className="bg-card flex flex-wrap items-end gap-3 rounded-xl border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="explorer-seed">k-means seed</Label>
            <select id="explorer-seed" className="bg-background h-9 rounded-md border px-3 text-sm" value={seed} onChange={(e) => setSeed(Number(e.target.value))}>
              {summary.seeds.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="text-sm">
            <div className="font-medium">k = {k}</div>
            <div className="text-muted-foreground text-xs">{imported ? "Carries k and seed into the scenario's run settings." : "Starts a pipeline run of the bundled example with this k and seed."}</div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {k !== summary.selected_k && (
              <Button variant="outline" size="sm" onClick={agreementAt} loading={pending === "agreement"}>
                Seed agreement at k = {k}
              </Button>
            )}
            {!imported && (
              <Button variant="outline" size="sm" render={<Link href={`/experiments?k=${k}${example ? `&example=${example}` : ""}`} />}>
                <FlaskConical aria-hidden /> Sweep around k = {k}
              </Button>
            )}
            <Button size="sm" onClick={useK} loading={pending === "use"}>
              {imported ? <Check aria-hidden /> : <Play aria-hidden />} Use this k
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
