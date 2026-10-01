import { headers } from "next/headers"
import { notFound } from "next/navigation"

import { DevHeader } from "@/components/brand/dev-header"
import { initializeDatabase } from "@/lib/server/database"
import { ApiError, runDetail, runsOpen } from "@/lib/server/runs"

import { assertRunReadAccess } from "@/lib/server/scenarios"

import { RunView } from "../run-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Run · Fillrate" }

export default async function RunPage({ params, searchParams }: PageProps<"/runs/[id]">) {
  const [{ id }, { key }] = await Promise.all([params, searchParams])
  let detail
  try {
    const store = initializeDatabase()
    assertRunReadAccess(store, id, new Request("http://localhost/runs", {headers: {cookie: (await headers()).get("cookie") ?? ""}}))
    detail = runDetail(store, id)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }
  return (
    <div className="flex min-h-dvh flex-col">
      <DevHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <RunView initial={detail} canCancel={runsOpen() || Boolean((await headers()).get("cookie")?.includes("fillrate_operator="))} runKey={typeof key === "string" ? key : undefined} />
      </main>
    </div>
  )
}
