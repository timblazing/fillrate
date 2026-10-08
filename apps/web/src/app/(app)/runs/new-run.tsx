"use client"

import { Play } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toastManager } from "@/components/ui/toast"

const kOptions = [
  { value: "auto", label: "Auto (smallest k within the solve-size limit)" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `k = ${i + 1}` })),
]

// Starts a run of a bundled synthetic scenario. One idempotency key per click, so a retried
// request never creates a second run.
export function NewRun({ example, defaultK }: { example: string; defaultK: number }) {
  const router = useRouter()
  // Fixed k is the normal path now that the diameter policy is off (spec v1.8); start from the example's k.
  const [k, setK] = useState(String(defaultK))
  const [seed, setSeed] = useState("0")
  const [pending, setPending] = useState(false)

  async function start() {
    setPending(true)
    try {
      const res = await fetch("/api/v1/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ example, settings: { k: k === "auto" ? null : Number(k), solver_seed: Number(seed) } }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error?.message ?? "Could not start the run.")
      router.push(`/runs/${body.id}`)
    } catch (error) {
      toastManager.add({ type: "error", title: "Run not started", description: error instanceof Error ? error.message : undefined })
      setPending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Clusters</Label>
        <Select items={kOptions} value={k} onValueChange={(v) => setK(v as string)}>
          <SelectTrigger className="w-60" aria-label="Clusters">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {kOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Solver seed</Label>
        <Select items={["0", "1", "2", "3", "4"].map((v) => ({ value: v, label: v }))} value={seed} onValueChange={(v) => setSeed(v as string)}>
          <SelectTrigger className="w-24" aria-label="Solver seed">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {["0", "1", "2", "3", "4"].map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <Button onClick={start} loading={pending}>
        <Play aria-hidden /> Run pipeline
      </Button>
    </div>
  )
}

/** Starts a clustering-only k explorer job on a bundled example: k and k + 1 × seeds 0–9, plus H3 resolutions 1–3. */
export function NewExplorer({ example, defaultK }: { example: string; defaultK: number }) {
  const router = useRouter()
  const [k, setK] = useState(String(defaultK))
  const [pending, setPending] = useState(false)
  async function start() {
    setPending(true)
    try {
      const res = await fetch("/api/v1/explorer", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ example, settings: { selected_k: Number(k), ks: [Number(k), Number(k) + 1] } }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error?.message ?? "Could not start the explorer.")
      router.push(`/explore/${body.id}`)
    } catch (error) {
      toastManager.add({ type: "error", title: "Explorer not started", description: error instanceof Error ? error.message : undefined })
      setPending(false)
    }
  }
  const options = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `k = ${i + 1} and ${i + 2}` }))
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Around</Label>
        <Select items={options} value={k} onValueChange={(v) => setK(v as string)}>
          <SelectTrigger className="w-44" aria-label="Around">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <Button variant="outline" onClick={start} loading={pending}>
        Explore k (23 clustering tasks)
      </Button>
    </div>
  )
}
