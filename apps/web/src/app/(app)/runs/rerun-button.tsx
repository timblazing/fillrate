"use client"

import type { RunSummary } from "@fillrate/contracts"
import { RotateCcw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { toastManager } from "@/components/ui/toast"

/** How the page can start this run again (computed on the server; null when the caller cannot). */
export type Rerun =
  | { kind: "example"; example: string; overrides: Record<string, unknown> }
  | { kind: "scenario"; versionId: string; settings: RunSummary["settings"] }

/** Starts a new run of the same scenario version and settings (recovery after a failed, cancelled or interrupted run); the earlier run is never changed. */
export function RerunButton({ rerun, runKey, label = "Run again", size = "sm", variant = "outline" }: { rerun: Rerun; runKey?: string; label?: string; size?: "sm" | "xs"; variant?: "outline" | "default" }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function start() {
    setPending(true)
    const [url, body] =
      rerun.kind === "example"
        ? ["/api/v1/runs", { example: rerun.example, settings: rerun.overrides }]
        : ["/api/v1/scenarios/runs", { versionId: rerun.versionId, settings: rerun.settings }]
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), ...(runKey ? { "x-run-key": runKey } : {}) },
        body: JSON.stringify(body),
      })
      const created = await res.json()
      if (!res.ok) throw new Error(created.error?.message ?? "Could not start the run.")
      router.push(`/runs/${created.id}${runKey ? `?key=${encodeURIComponent(runKey)}` : ""}`)
    } catch (error) {
      toastManager.add({ type: "error", title: "Run not started", description: error instanceof Error ? error.message : undefined })
      setPending(false)
    }
  }
  return (
    <Button variant={variant} size={size} onClick={start} loading={pending} title="Start a new run of the same scenario version and settings; this run stays as it is">
      <RotateCcw aria-hidden /> {label}
    </Button>
  )
}
