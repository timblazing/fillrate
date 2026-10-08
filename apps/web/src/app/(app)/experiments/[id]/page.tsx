import { notFound } from "next/navigation"

import { Page } from "@/components/app/page"
import { initializeDatabase } from "@/lib/server/database"
import { pagePrincipal } from "@/lib/server/access"
import { assertExperimentRead, canEditExperiment, experimentDetail, isImportedVersion } from "@/lib/server/experiments"
import { ApiError } from "@/lib/server/runs"

import { ExperimentView } from "../experiment-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Sweep · Fillrate" }

export default async function ExperimentPage({ params, searchParams }: PageProps<"/experiments/[id]">) {
  const [{ id }, { key }] = await Promise.all([params, searchParams])
  const store = initializeDatabase()
  const experiment = store.experiment(id)
  if (!experiment) notFound()
  const who = await pagePrincipal()
  try {
    assertExperimentRead(store, who, experiment.versionId)
  } catch (error) {
    if (error instanceof ApiError) notFound()
    throw error
  }
  const imported = isImportedVersion(store, experiment.versionId)
  return (
    <Page>
      <ExperimentView initial={experimentDetail(store, id)} canEdit={canEditExperiment(who, experiment.ownerId) || (experiment.ownerId === "public" && typeof key === "string")} runKey={typeof key === "string" ? key : undefined} imported={imported} />
    </Page>
  )
}
