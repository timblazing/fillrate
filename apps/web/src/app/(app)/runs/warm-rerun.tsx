"use client"

import type { RunSummary } from "@fillrate/contracts"
import { RotateCcw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { toastManager } from "@/components/ui/toast"

/** How the page can start this run again warm-started (computed on the server; null when the caller cannot). */
export type WarmRerun =
  | { kind: "example"; example: string; overrides: Record<string, unknown> }
  | { kind: "scenario"; versionId: string; settings: Omit<RunSummary["settings"], "warm_start"> }

/** What a warm start reads its plan from: a succeeded run, or one of the caller's saved valid manual baselines. */
export type WarmSource = { kind: "run"; run_id: string } | { kind: "manual_baseline"; baseline_id: string }

/**
 * Same scenario and settings, each cluster's solve started from `source`'s validated plan where it still fits (M6).
 * Without a source it starts a new cold run of the same scenario version and settings (recovery after a failed,
 * cancelled or interrupted run); the earlier run is never changed.
 */
export function WarmRerunButton({ source, rerun, runKey, label = "Re-run warm-started", title, size = "sm", variant = "outline" }: { source?: WarmSource; rerun: WarmRerun; runKey?: string; label?: string; title?: string; size?: "sm" | "xs"; variant?: "outline" | "default" }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function start() {
    setPending(true)
    const warm = source ? { warm_start: source } : {}
    const [url, body] =
      rerun.kind === "example"
        ? ["/api/v1/runs", { example: rerun.example, settings: { ...rerun.overrides, ...warm } }]
        : ["/api/v1/scenarios/runs", { versionId: rerun.versionId, settings: { ...rerun.settings, ...warm } }]
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
    <Button variant={variant} size={size} onClick={start} loading={pending} title={title ?? (source ? "Same scenario and settings; each cluster starts from this run's validated plan when it still matches" : "Start a new run of the same scenario version and settings; this run stays as it is")}>
      <RotateCcw aria-hidden /> {label}
    </Button>
  )
}
