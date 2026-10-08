import type { RunSettings } from "@fillrate/contracts"
import { notFound, redirect } from "next/navigation"

import { Page } from "@/components/app/page"
import { initializeDatabase } from "@/lib/server/database"
import { assertRunRead, OWNER } from "@/lib/server/access"
import { ApiError, EXAMPLES, exampleForVersion, runDetail } from "@/lib/server/runs"

import { RunView, type Rerun } from "../run-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Run · Fillrate" }

// Overrides `/api/v1/runs` accepts; a rerun of an example sends back only those that differ from the example.
const OVERRIDABLE = ["k", "kmeans_seed", "solver_seed", "inventory_percent", "allocation_strategy", "fulfillment_policy"] as const

/** How this page can start the same run again: on the bundled example, or on the saved scenario version. */
function rerunFor(store: ReturnType<typeof initializeDatabase>, versionId: string, settings: RunSettings): Rerun | null {
  const example = exampleForVersion(store, versionId)
  if (example) {
    const defaults = EXAMPLES[example].settings as RunSettings
    const overrides = Object.fromEntries(OVERRIDABLE.filter(k => settings[k] !== defaults[k]).map(k => [k, settings[k]]))
    return { kind: "example", example, overrides }
  }
  if (store.versionOwner(versionId) !== OWNER) return null
  return { kind: "scenario", versionId, settings }
}

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  const { id } = await params
  let detail
  let rerun: Rerun | null = null
  let scenarioHref: string | null = null
  try {
    const store = initializeDatabase()
    const view = assertRunRead(store, id)
    detail = runDetail(store, id)
    rerun = detail.kind === "pipeline" ? rerunFor(store, view.versionId, detail.settings) : null
    // Recovery: a saved scenario version opens in the workbench with this run's settings.
    const source = detail.kind === "pipeline" ? store.versionScenario(view.versionId) : null
    if (source && source.ownerId === OWNER) scenarioHref = `/scenarios?scenario=${source.scenarioId}&version=${view.versionId}&run=${id}`
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound()
    throw error
  }
  // Matrix builds have no run view; their progress and result live in the scenario matrix panel.
  if (detail.kind === "travel_snapshot") redirect("/scenarios")
  if (detail.kind === "explorer") redirect(`/explore/${id}`)
  return (
    <Page>
      <RunView initial={detail} rerun={rerun} scenarioHref={scenarioHref} />
    </Page>
  )
}
