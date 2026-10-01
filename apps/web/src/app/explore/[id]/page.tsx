import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { DevHeader } from "@/components/brand/dev-header"
import { initializeDatabase } from "@/lib/server/database"
import { isImportedVersion } from "@/lib/server/experiments"
import { ApiError, runDetail, runsOpen } from "@/lib/server/runs"
import { assertRunReadAccess } from "@/lib/server/scenarios"

import { ExplorerView } from "../explorer-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "k explorer · Fillrate" }

export default async function ExplorePage({ params, searchParams }: PageProps<"/explore/[id]">) {
  const [{ id }, { key }] = await Promise.all([params, searchParams])
  const store = initializeDatabase()
  let detail
  try {
    assertRunReadAccess(store, id, new Request("http://localhost/explore", { headers: { cookie: (await headers()).get("cookie") ?? "" } }))
    detail = runDetail(store, id)
  } catch (error) {
    if (error instanceof ApiError && [403, 404, 503].includes(error.status)) notFound()
    throw error
  }
  if (detail.kind !== "explorer") redirect(`/runs/${id}`)
  const imported = isImportedVersion(store, store.runView(id)!.versionId)
  return (
    <div className="flex min-h-dvh flex-col">
      <DevHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <ExplorerView initial={detail} imported={imported} canRun={imported || runsOpen()} runKey={typeof key === "string" ? key : undefined} />
      </main>
    </div>
  )
}
