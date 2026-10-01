import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { DevHeader } from "@/components/brand/dev-header"
import { initializeDatabase } from "@/lib/server/database"
import { assertExperimentRead, experimentDetail, isImportedVersion } from "@/lib/server/experiments"
import { ApiError, runsOpen } from "@/lib/server/runs"

import { ExperimentView } from "../experiment-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Sweep · Fillrate" }

export default async function ExperimentPage({ params, searchParams }: PageProps<"/experiments/[id]">) {
  const [{ id }, { key }] = await Promise.all([params, searchParams])
  const store = initializeDatabase()
  const experiment = store.experiment(id)
  if (!experiment) notFound()
  try {
    assertExperimentRead(store, new Request("http://localhost/experiments", { headers: { cookie: (await headers()).get("cookie") ?? "" } }), experiment.versionId)
  } catch (error) {
    if (error instanceof ApiError) notFound()
    throw error
  }
  const imported = isImportedVersion(store, experiment.versionId)
  return (
    <div className="flex min-h-dvh flex-col">
      <DevHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <ExperimentView initial={experimentDetail(store, id)} canEdit={imported || runsOpen()} runKey={typeof key === "string" ? key : undefined} imported={imported} />
      </main>
    </div>
  )
}
