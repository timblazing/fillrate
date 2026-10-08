import { notFound } from "next/navigation"

import { Page } from "@/components/app/page"
import { initializeDatabase } from "@/lib/server/database"
import { assertExperimentRead, experimentDetail, isImportedVersion } from "@/lib/server/experiments"
import { ApiError } from "@/lib/server/runs"

import { ExperimentView } from "../experiment-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Sweep · Fillrate" }

export default async function ExperimentPage({ params }: PageProps<"/experiments/[id]">) {
  const { id } = await params
  const store = initializeDatabase()
  const experiment = store.experiment(id)
  if (!experiment) notFound()
  try {
    assertExperimentRead(store, experiment.versionId)
  } catch (error) {
    if (error instanceof ApiError) notFound()
    throw error
  }
  const imported = isImportedVersion(store, experiment.versionId)
  return (
    <Page>
      <ExperimentView initial={experimentDetail(store, id)} imported={imported} />
    </Page>
  )
}
