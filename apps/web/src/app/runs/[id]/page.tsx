import type { RunSettings } from "@fillrate/contracts"
import { notFound, redirect } from "next/navigation"

import { DevHeader } from "@/components/brand/dev-header"
import { initializeDatabase } from "@/lib/server/database"
import { assertRunRead, canCancel, pagePrincipal } from "@/lib/server/access"
import { ApiError, canStartRuns, EXAMPLES, exampleForVersion, runDetail } from "@/lib/server/runs"

import { RunView, type WarmRerun } from "../run-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Run · Fillrate" }

// Overrides `/api/v1/runs` accepts; a warm rerun of an example sends back only those that differ from the example.
const OVERRIDABLE = ["k", "kmeans_seed", "solver_seed", "inventory_percent", "allocation_strategy", "fulfillment_policy"] as const

/** How this page can start the same run again, warm-started from it (M6): on the bundled example, or on the caller's own scenario version. */
function warmRerun(store: ReturnType<typeof initializeDatabase>, who: Awaited<ReturnType<typeof pagePrincipal>>, versionId: string, settings: RunSettings, key: unknown): WarmRerun | null {
  const example = exampleForVersion(store, versionId)
  if (example) {
    if (!canStartRuns(who, key)) return null
    const defaults = EXAMPLES[example].settings as RunSettings
    const overrides = Object.fromEntries(OVERRIDABLE.filter(k => settings[k] !== defaults[k]).map(k => [k, settings[k]]))
    return { kind: "example", example, overrides }
  }
  if (!who.ownerId || store.versionOwner(versionId) !== who.ownerId) return null
  const rest = { ...settings }
  delete rest.warm_start // the button names this run as the source
  return { kind: "scenario", versionId, settings: rest }
}

export default async function RunPage({ params, searchParams }: PageProps<"/runs/[id]">) {
  const [{ id }, { key }] = await Promise.all([params, searchParams])
  const who = await pagePrincipal()
  let detail, cancellable
  let rerun: WarmRerun | null = null
  try {
    const store = initializeDatabase()
    const view = assertRunRead(store, who, id)
    cancellable = canCancel(who, view.ownerId) || (view.ownerId === "public" && typeof key === "string")
    detail = runDetail(store, id)
    rerun = detail.kind === "pipeline" ? warmRerun(store, who, view.versionId, detail.settings, key) : null
  } catch (error) {
    // Another owner's runs read as missing, so their existence is not revealed.
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound()
    throw error
  }
  // Matrix builds have no run view; their progress and result live in the scenario matrix panel.
  if (detail.kind === "travel_snapshot") redirect("/scenarios")
  if (detail.kind === "explorer") redirect(`/explore/${id}${typeof key === "string" ? `?key=${encodeURIComponent(key)}` : ""}`)
  return (
    <div className="flex min-h-dvh flex-col">
      <DevHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <RunView initial={detail} canCancel={cancellable} runKey={typeof key === "string" ? key : undefined} rerun={rerun} />
      </main>
    </div>
  )
}
