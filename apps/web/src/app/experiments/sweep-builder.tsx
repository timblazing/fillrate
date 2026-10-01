"use client"

import { FlaskConical } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toastManager } from "@/components/ui/toast"

const METERS_PER_MILE = 1609.344
type Base = { k?: number | null; kmeans_seed?: number; inventory_percent?: number; travel_circuity?: number; max_leg_m?: number; solver_seed?: number; cluster_strategy?: string; h3_resolution?: number }
type Preview = { count: number; limit: number; runs: { varied: Record<string, unknown>; changed: string[] }[]; solver_seconds_per_cluster: number; iterations_per_cluster: number | null }

function numbers(raw: string, integer: boolean) {
  const parts = raw.split(/[\s,]+/).filter(Boolean)
  const out: number[] = []
  for (const part of parts) {
    const range = integer ? /^(\d+)[–-](\d+)$/.exec(part) : null
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])]
      if (b < a || b - a > 100) throw new Error(`Range ${part} is not valid.`)
      for (let n = a; n <= b; n++) out.push(n)
    } else {
      const n = Number(part)
      if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) throw new Error(`${part} is not a ${integer ? "whole " : ""}number.`)
      out.push(n)
    }
  }
  return [...new Set(out)]
}

/**
 * Sweep builder (spec §8a, design review `compare.vary`): k, seed, inventory and mileage first; the
 * rest under "More". Preview shows the expanded run count before anything is enqueued.
 */
export function SweepBuilder({ initialK, runKey, limit, versionId, base = {}, scenarioKey, onCreated }: {
  initialK: number
  runKey?: string
  limit: number
  /** Imported scenario version (operator key); omitted for the bundled synthetic example. */
  versionId?: string
  base?: Base
  scenarioKey?: string
  onCreated?: (id: string) => void
}) {
  const router = useRouter()
  const [name, setName] = useState(`k ${Math.max(1, initialK - 1)}–${initialK + 1} × seeds`)
  const [fields, setFields] = useState({
    k: [initialK - 1, initialK, initialK + 1].filter((k) => k >= 1).join(", "),
    kmeans_seed: "0, 1, 2",
    inventory_percent: String(base.inventory_percent ?? 100),
    travel_circuity: String(base.travel_circuity ?? 1.2),
    leg_miles: String(Math.round((base.max_leg_m ?? 804_672) / METERS_PER_MILE)),
    solver_seed: String(base.solver_seed ?? 0),
    methods: [base.cluster_strategy ?? "kmeans"],
    h3_resolution: String(base.h3_resolution ?? 2),
  })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState<string | null>(null)
  const set = (patch: Partial<typeof fields>) => { setFields((f) => ({ ...f, ...patch })); setPreview(null) }

  function axes() {
    const out: Record<string, unknown[]> = {}
    const add = (axis: string, values: unknown[], baseValue: unknown) => {
      if (values.length > 1 || (values.length === 1 && values[0] !== baseValue)) out[axis] = values
    }
    add("cluster_strategy", fields.methods, base.cluster_strategy ?? "kmeans")
    if (fields.methods.includes("kmeans")) add("k", numbers(fields.k, true), base.k ?? null)
    if (!fields.methods.every((m) => m === "none")) add("kmeans_seed", numbers(fields.kmeans_seed, true), base.kmeans_seed ?? 0)
    if (fields.methods.includes("h3")) add("h3_resolution", numbers(fields.h3_resolution, true), base.h3_resolution ?? 2)
    add("inventory_percent", numbers(fields.inventory_percent, true), base.inventory_percent ?? 100)
    add("travel_circuity", numbers(fields.travel_circuity, false), base.travel_circuity ?? 1.2)
    add("max_leg_m", numbers(fields.leg_miles, false).map((mi) => Math.round(mi * METERS_PER_MILE)), base.max_leg_m ?? 804_672)
    add("solver_seed", numbers(fields.solver_seed, true), base.solver_seed ?? 0)
    if (!Object.keys(out).length) throw new Error("Vary at least one setting.")
    return out
  }

  async function call(path: string, idempotent: boolean) {
    const body = { name, axes: axes(), ...(versionId ? { versionId, base } : {}) }
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(idempotent ? { "idempotency-key": crypto.randomUUID() } : {}), ...(runKey ? { "x-run-key": runKey } : {}), ...(scenarioKey ? { "x-scenario-key": scenarioKey } : {}) },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error?.message ?? "Request failed.")
    return json
  }
  async function run(kind: "preview" | "start") {
    setPending(kind)
    setError("")
    try {
      if (kind === "preview") setPreview(await call("/api/v1/experiments/preview", false))
      else {
        const created = await call("/api/v1/experiments", true)
        if (onCreated) onCreated(created.id)
        else router.push(`/experiments/${created.id}${runKey ? `?key=${encodeURIComponent(runKey)}` : ""}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.")
      if (kind === "start") toastManager.add({ type: "error", title: "Sweep not started", description: e instanceof Error ? e.message : undefined })
    } finally {
      setPending(null)
    }
  }

  const text = (key: keyof typeof fields, label: string, hint: string) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={`sweep-${key}`}>{label}</Label>
      <Input id={`sweep-${key}`} value={fields[key] as string} onChange={(e) => set({ [key]: e.target.value })} className="font-mono" />
      <span className="text-muted-foreground text-xs">{hint}</span>
    </div>
  )

  return (
    <div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-sm">
        <Label htmlFor="sweep-name">Name</Label>
        <Input id="sweep-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {text("k", "k (clusters)", "List or range, e.g. 3, 4, 5 or 3–6")}
        {text("kmeans_seed", "k-means seeds", "e.g. 0, 1, 2")}
        {text("inventory_percent", "Inventory available (%)", "Changed assumption: ranked separately")}
        <div className="grid grid-cols-2 gap-2">
          {text("travel_circuity", "Circuity", "Mileage factor")}
          {text("leg_miles", "Leg limit (mi)", "Per drive")}
        </div>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">More</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {text("solver_seed", "Solver seeds", "Each seed is a new solve")}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Clustering method</legend>
            {[["kmeans", "k-means"], ["h3", "H3 cells"], ["none", "No clustering (baseline)"]].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={fields.methods.includes(value)} onChange={(e) => set({ methods: e.target.checked ? [...fields.methods, value] : fields.methods.filter((m) => m !== value) })} />
                {label}
              </label>
            ))}
          </fieldset>
          {fields.methods.includes("h3") && text("h3_resolution", "H3 resolutions", "1–3 are regional; 2 is the default")}
        </div>
        <p className="text-muted-foreground mt-2 text-xs">The no-clustering baseline runs only when every stop fits one solve; otherwise that run fails and the capacity lower bounds still compare.</p>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => run("preview")} loading={pending === "preview"}>Preview runs</Button>
        <Button onClick={() => run("start")} loading={pending === "start"} disabled={!preview || preview.count > limit}>
          <FlaskConical aria-hidden /> Start {preview ? `${preview.count} runs` : "sweep"}
        </Button>
        {!preview && <span className="text-muted-foreground text-xs">Preview first to see the run count (limit {limit}).</span>}
      </div>
      {error && <p role="alert" className="text-destructive-foreground text-sm">{error}</p>}
      {preview && (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">{preview.count} runs</span>
            <span className="text-muted-foreground"> · up to {preview.iterations_per_cluster ? `${preview.iterations_per_cluster} solver iterations` : `${preview.solver_seconds_per_cluster} s`} per cluster each</span>
          </p>
          <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {preview.runs.map((r, i) => (
              <li key={i}>
                <Badge variant={r.changed.length ? "warning" : "outline"} size="sm" className="font-mono">
                  {Object.entries(r.varied).map(([k, v]) => `${k}=${v}`).join(" ") || "base"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
