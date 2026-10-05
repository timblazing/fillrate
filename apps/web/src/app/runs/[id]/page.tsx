import { notFound, redirect } from "next/navigation"

import { DevHeader } from "@/components/brand/dev-header"
import { initializeDatabase } from "@/lib/server/database"
import { assertRunRead, canCancel, pagePrincipal } from "@/lib/server/access"
import { ApiError, canStartRuns, runDetail } from "@/lib/server/runs"

import { RunView } from "../run-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Run · Fillrate" }

export default async function RunPage({ params, searchParams }: PageProps<"/runs/[id]">) {
  const [{ id }, { key }] = await Promise.all([params, searchParams])
  const who = await pagePrincipal()
  let detail, cancellable
  try {
    const store = initializeDatabase()
    const view = assertRunRead(store, who, id)
    cancellable = canCancel(who, view.ownerId) || (view.ownerId === "public" && typeof key === "string")
    detail = runDetail(store, id)
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
        <RunView initial={detail} canCancel={cancellable} canEvaluate={canStartRuns(who, key)} runKey={typeof key === "string" ? key : undefined} />
      </main>
    </div>
  )
}
