import { notFound, redirect } from "next/navigation"

import { Page } from "@/components/app/page"
import { initializeDatabase } from "@/lib/server/database"
import { isImportedVersion } from "@/lib/server/experiments"
import { assertRunRead, pagePrincipal } from "@/lib/server/access"
import { ApiError, canStartRuns, exampleForVersion, runDetail } from "@/lib/server/runs"

import { ExplorerView } from "../explorer-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "k explorer · Fillrate" }

export default async function ExplorePage({ params, searchParams }: PageProps<"/explore/[id]">) {
  const [{ id }, { key }] = await Promise.all([params, searchParams])
  const store = initializeDatabase()
  const who = await pagePrincipal()
  let detail
  try {
    assertRunRead(store, who, id)
    detail = runDetail(store, id)
  } catch (error) {
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound()
    throw error
  }
  if (detail.kind !== "explorer") redirect(`/runs/${id}`)
  const versionId = store.runView(id)!.versionId
  const imported = isImportedVersion(store, versionId)
  return (
    <Page>
      <ExplorerView initial={detail} imported={imported} example={imported ? null : exampleForVersion(store, versionId)} canRun={imported || canStartRuns(who, key)} runKey={typeof key === "string" ? key : undefined} />
    </Page>
  )
}
