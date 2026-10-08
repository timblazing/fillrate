"use client"

import { ArrowDown, ArrowLeft, ArrowUp, Download, Star, X } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { PageTitle } from "@/components/app/page"
import { JobStatusDot, type JobState } from "@/components/lab/job-status"
import { FillPercent } from "@/components/lab/trailer-fill"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { toastManager } from "@/components/ui/toast"
import { BEST_TRADEOFF, BEST_TRADEOFF_HINT } from "@/lib/copy"
import type { ExperimentDetail } from "@/lib/server/experiments"
import { formatCount, formatMiles, formatMoney } from "@/lib/units"
import { cn } from "@/lib/utils"

const ACTIVE = new Set(["queued", "claimed", "running"])
const MI = 1609.344
type MetricKey = keyof ExperimentDetail["metrics"]
type Row = ExperimentDetail["runs"][number]

function usePolled(initial: ExperimentDetail, headers: Record<string, string>) {
  const [detail, setDetail] = useState(initial)
  const active = detail.runs.some((r) => ACTIVE.has(r.status))
  useEffect(() => {
    if (!active) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!document.hidden) {
        const res = await fetch(`/api/v1/experiments/${initial.id}`, { cache: "no-store", headers }).catch(() => null)
        if (res?.ok && !stopped) setDetail(await res.json())
      }
      if (!stopped) timer = setTimeout(tick, 3_000)
    }
    timer = setTimeout(tick, 2_000)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [initial.id, active]) // eslint-disable-line react-hooks/exhaustive-deps
  return [detail, setDetail] as const
}

const display: Record<MetricKey, (v: number) => React.ReactNode> = {
  planned_cents: (v) => formatMoney(v, { compact: true }),
  utilization: (v) => <FillPercent fill={v} />,
  mean_centroid_m: (v) => formatMiles(v / MI),
  trucks: (v) => formatCount(v),
  loaded_distance_m: (v) => formatMiles(v / MI),
  min_fill: (v) => <FillPercent fill={v} />,
  max_diameter_m: (v) => formatMiles(v / MI),
}
/** Signed difference from the Best option, in the column's own unit; "same" when equal at display precision. */
function delta(k: MetricKey, value: number, best: number): string | null {
  const d = value - best
  if (d === 0) return "= Best"
  const sign = d > 0 ? "+" : "−"
  const a = Math.abs(d)
  const body = k === "planned_cents" ? formatMoney(a, { compact: true }) : k === "trucks" ? formatCount(a) : k === "utilization" || k === "min_fill" ? `${(a * 100).toFixed(1)} pts` : formatMiles(a / MI)
  return `${sign}${body}`
}
const COLUMNS: MetricKey[] = ["planned_cents", "trucks", "utilization", "min_fill", "mean_centroid_m", "max_diameter_m", "loaded_distance_m"]

export function ExperimentView({ initial, canEdit, runKey, imported }: { initial: ExperimentDetail; canEdit: boolean; runKey?: string; imported: boolean }) {
  const headers: Record<string, string> = runKey ? { "x-run-key": runKey } : {}
  const [detail, setDetail] = usePolled(initial, headers)
  const finished = detail.runs.filter((r) => !ACTIVE.has(r.status)).length
  const top = detail.runs.filter((r) => r.label).sort((a, b) => a.rank! - b.rank! || a.position - b.position)
  const rows = [...detail.runs].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.position - b.position)
  const suffix = runKey ? `?key=${encodeURIComponent(runKey)}` : ""
  const label = (k: MetricKey | "non_dominated") => (k === "non_dominated" ? BEST_TRADEOFF : detail.metrics[k].label)

  async function save(comparison: ExperimentDetail["comparison"]) {
    const res = await fetch(`/api/v1/experiments/${detail.id}`, { method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ comparison }) })
    const body = await res.json()
    if (res.ok) setDetail(body)
    else toastManager.add({ type: "error", title: "Comparison not saved", description: body.error?.message })
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon-sm" render={<Link href={imported ? "/scenarios" : `/experiments${suffix}`} aria-label="All sweeps" />}>
          <ArrowLeft />
        </Button>
        <PageTitle>{detail.name}</PageTitle>
        <span className="text-muted-foreground font-mono text-xs">{detail.id.slice(0, 8)}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{finished} of {detail.runs.length} runs finished</span>
        <div className="ml-auto flex gap-2">
          {(["json", "csv"] as const).map((f) => (
            <Button key={f} variant="outline" size="sm" render={<a href={`/api/v1/experiments/${detail.id}/export?format=${f}`} download />}>
              <Download aria-hidden /> {f.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      <section aria-label="Ranked options" className="grid gap-3 sm:grid-cols-3">
        {top.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm sm:col-span-3">
            {finished < detail.runs.length ? "Ranking appears as valid, complete runs finish." : "No valid, complete plan in this cohort to rank."}
          </p>
        ) : (
          top.slice(0, 6).map((r) => (
            <Link key={r.id} href={`/runs/${r.id}${suffix}`} className="bg-card hover:bg-muted/40 flex flex-col gap-1 rounded-xl border p-4 transition-colors">
              <span className="text-muted-foreground text-xs font-medium">{r.label}{top.filter((x) => x.rank === r.rank).length > 1 ? " (tie)" : ""}</span>
              <span className="text-2xl font-semibold tracking-tight tabular-nums">{formatMoney(r.metrics!.planned_cents!)}</span>
              <span className="text-muted-foreground text-xs tabular-nums">
                {formatCount(r.metrics!.trucks!)} shipments · {formatMiles(r.metrics!.loaded_distance_m! / MI)} loaded
              </span>
              <span className="flex flex-wrap gap-1 font-mono text-[11px]">{Object.entries(r.varied).map(([k, v]) => <Badge key={k} variant="outline" size="sm">{k} {String(v)}</Badge>)}</span>
            </Link>
          ))
        )}
      </section>

      <Ordering detail={detail} canEdit={canEdit} onSave={save} label={label} />

      <div className="bg-card overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[64rem] text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-xs">
              <th className="px-3 py-2 text-left font-medium">Rank</th>
              <th className="w-6" aria-label={BEST_TRADEOFF} />
              <th className="px-2 py-2 text-left font-medium">Run</th>
              {COLUMNS.map((k) => (
                <th key={k} className="px-3 py-2 text-right font-medium whitespace-nowrap" title={`${detail.metrics[k].direction === "max" ? "Higher" : "Lower"} is better`}>
                  {detail.metrics[k].label}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap" title="ceil(load ÷ trailer) overall and summed per cluster">Lower bounds</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <RunRow key={r.id} r={r} suffix={suffix} best={top[0] && r.rank != null && r.signature === top[0].signature ? top[0] : null} />)}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground max-w-3xl text-xs text-pretty">
        Small grey figures show each ranked run&apos;s difference from the Best option in the same cohort. Sweeps have no cancel control: a running sweep finishes or fails per run, and each queued or running run can be cancelled from its own page.
      </p>
      <p className="text-muted-foreground max-w-3xl text-xs text-pretty">
        With stock allocation held fixed and every allocated piece shipped, changing k or a seed cannot raise planned revenue; it only changes
        grouping, shipments, miles or feasibility. Inventory and mileage changes are different assumptions, so those runs form their own cohort.
        Lower bounds: the first number is ceil(total load ÷ trailer); the second sums that bound per cluster. Their difference is how much
        partitioning raises the bound, not proof of extra trucks.
      </p>
    </>
  )
}

function RunRow({ r, suffix, best }: { r: Row; suffix: string; best: Row | null }) {
  return (
    <tr className={cn("border-b last:border-0", r.non_dominated && "bg-[color-mix(in_oklch,var(--success)_5%,transparent)]")}>
      <td className="px-3 py-2 text-xs whitespace-nowrap">{r.label ? <span className="font-medium">{r.label}</span> : r.rank ? `#${r.rank}` : <span className="text-muted-foreground">{r.reason}</span>}</td>
      <td>{r.non_dominated && <span title={BEST_TRADEOFF_HINT} className="inline-flex"><Star className="text-success-foreground size-3.5 fill-current" aria-label={BEST_TRADEOFF} /></span>}</td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <JobStatusDot state={r.status as JobState} />
          <Link href={`/runs/${r.id}${suffix}`} className="font-mono text-xs underline-offset-4 hover:underline">{r.id.slice(0, 8)}</Link>
          {r.validity === "invalid" && <Badge variant="error" size="sm">invalid</Badge>}
        </div>
        {(r.status === "failed" || r.status === "cancelled") && <p className="text-muted-foreground mt-0.5 pl-4 text-[11px]">{r.status === "failed" ? "Failed" : "Cancelled"}: open the run for the cause and Run again.</p>}
        <div className="mt-0.5 flex flex-wrap gap-1 pl-4 font-mono text-[10px]">
          {Object.entries(r.varied).map(([k, v]) => <span key={k} className="bg-muted rounded px-1 py-px">{k} {String(v)}</span>)}
          {r.changed.map((c) => <span key={c} className="border-warning/60 text-warning-foreground rounded border border-dashed px-1 py-px">{c} · changed assumption</span>)}
        </div>
      </td>
      {COLUMNS.map((k) => (
        <td key={k} className="px-3 py-2 text-right font-mono text-xs tabular-nums">
          {r.metrics?.[k] == null ? "–" : display[k](r.metrics[k]!)}
          {best && best.id !== r.id && best.metrics?.[k] != null && r.metrics?.[k] != null && <div className="text-muted-foreground text-[10px]">{delta(k, r.metrics[k]!, best.metrics[k]!)}</div>}
        </td>
      ))}
      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{r.capacity_lower_bound == null ? "–" : `${r.capacity_lower_bound} / ${r.sum_cluster_lower_bounds}`}</td>
    </tr>
  )
}

/** The declared ranking order and Pareto vector, shown beside the ranking and saved with the sweep. */
function Ordering({ detail, canEdit, onSave, label }: {
  detail: ExperimentDetail
  canEdit: boolean
  onSave: (c: ExperimentDetail["comparison"]) => Promise<void>
  label: (k: MetricKey | "non_dominated") => string
}) {
  const [order, setOrder] = useState(detail.comparison.order)
  const [vector, setVector] = useState(detail.comparison.vector)
  const [cohort, setCohort] = useState<string | null>(detail.comparison.cohort ?? null)
  const [saving, setSaving] = useState(false)
  const keys = Object.keys(detail.metrics) as MetricKey[]
  const dirty = JSON.stringify([order, vector, cohort]) !== JSON.stringify([detail.comparison.order, detail.comparison.vector, detail.comparison.cohort])
  const move = (i: number, d: -1 | 1) => setOrder((o) => { const n = [...o]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n })
  return (
    <section aria-label="Ranking order" className="bg-card grid gap-4 rounded-xl border p-4 lg:grid-cols-3">
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Ranking order</h2>
        <ol className="flex flex-col gap-1 text-sm">
          {order.map((k, i) => (
            <li key={k} className="flex items-center gap-1">
              <span className="text-muted-foreground w-4 text-xs tabular-nums">{i + 1}.</span>
              <span className="flex-1">{label(k)}{k !== "non_dominated" && <span className="text-muted-foreground text-xs"> ({detail.metrics[k].direction === "max" ? "higher first" : "lower first"})</span>}</span>
              {canEdit && (
                <>
                  <Button variant="ghost" size="icon-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${label(k)} up`}><ArrowUp /></Button>
                  <Button variant="ghost" size="icon-xs" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${label(k)} down`}><ArrowDown /></Button>
                  <Button variant="ghost" size="icon-xs" disabled={order.length === 1} onClick={() => setOrder(order.filter((x) => x !== k))} aria-label={`Remove ${label(k)}`}><X /></Button>
                </>
              )}
            </li>
          ))}
        </ol>
        {canEdit && (
          <select aria-label="Add a ranking key" className="bg-background h-8 rounded-md border px-2 text-sm" value="" onChange={(e) => e.target.value && setOrder([...order, e.target.value as MetricKey])}>
            <option value="">Add…</option>
            {(["non_dominated", ...keys] as const).filter((k) => !order.includes(k)).map((k) => <option key={k} value={k}>{label(k)}</option>)}
          </select>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{BEST_TRADEOFF} uses</h2>
        {keys.map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!canEdit} checked={vector.includes(k)} onChange={(e) => setVector(e.target.checked ? [...vector, k] : vector.filter((x) => x !== k))} />
            {detail.metrics[k].label} <span className="text-muted-foreground text-xs">({detail.metrics[k].direction === "max" ? "higher" : "lower"} is better)</span>
          </label>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="cohort">Cohort</Label>
        <select id="cohort" disabled={!canEdit} className="bg-background h-9 rounded-md border px-2 text-sm" value={cohort ?? ""} onChange={(e) => setCohort(e.target.value || null)}>
          {detail.cohorts.length === 0 && <option value="">None yet</option>}
          {detail.cohorts.map((c) => {
            const sample = detail.runs.find((r) => r.signature === c.signature)
            return <option key={c.signature} value={c.signature}>{sample?.changed.length ? sample.changed.join(", ") : "Base assumptions"} · {c.runs} runs</option>
          })}
        </select>
        <p className="text-muted-foreground text-xs">Only valid, complete plans with the same demand, stock, eligibility, mileage measure and leg limit are ranked together. Ties at the declared rounding share a rank.</p>
        {canEdit && <Button size="sm" className="self-start" disabled={!dirty || vector.length === 0} loading={saving} onClick={async () => { setSaving(true); await onSave({ order, vector, cohort }); setSaving(false) }}>Save comparison</Button>}
      </div>
    </section>
  )
}
