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
  ...Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `k = ${i + 1}` })),
]

// Starts a run of the bundled synthetic scenario. One idempotency key per click, so a retried
// request never creates a second run.
export function NewRun({ open, runKey }: { open: boolean; runKey?: string }) {
  const router = useRouter()
  // Fixed k is the normal path now that the diameter policy is off (spec v1.8); 4 is the bundled example's k.
  const [k, setK] = useState("4")
  const [seed, setSeed] = useState("0")
  const [pending, setPending] = useState(false)

  async function start() {
    setPending(true)
    try {
      const res = await fetch("/api/v1/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), ...(runKey ? { "x-run-key": runKey } : {}) },
        body: JSON.stringify({ settings: { k: k === "auto" ? null : Number(k), solver_seed: Number(seed) } }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error?.message ?? "Could not start the run.")
      router.push(`/runs/${body.id}${runKey ? `?key=${encodeURIComponent(runKey)}` : ""}`)
    } catch (error) {
      toastManager.add({ type: "error", title: "Run not started", description: error instanceof Error ? error.message : undefined })
      setPending(false)
    }
  }

  if (!open) {
    return <p className="text-muted-foreground text-sm">Starting runs is disabled on this server. Existing runs stay viewable.</p>
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Clusters</Label>
        <Select items={kOptions} value={k} onValueChange={(v) => setK(v as string)}>
          <SelectTrigger className="w-60">
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
          <SelectTrigger className="w-24">
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
