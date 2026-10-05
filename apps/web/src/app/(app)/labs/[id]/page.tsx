import { notFound, redirect } from "next/navigation"

import { initializeDatabase } from "@/lib/server/database"
import { assertRunRead, canCancel, pagePrincipal } from "@/lib/server/access"
import { LAB_EXAMPLES, labRunDetail } from "@/lib/server/lab"
import { ApiError } from "@/lib/server/runs"

import { LabRunView } from "../lab-run-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lab run · Fillrate" }

export default async function LabRunPage({ params, searchParams }: PageProps<"/labs/[id]">) {
  const [{ id }, { key }] = await Promise.all([params, searchParams])
  const who = await pagePrincipal()
  const store = initializeDatabase()
  let view
  try {
    view = assertRunRead(store, who, id)
  } catch (error) {
    // Another owner's runs read as missing, so their existence is not revealed.
    if (error instanceof ApiError && [403, 404].includes(error.status)) notFound()
    throw error
  }
  if (view.kind !== "lab") redirect(`/runs/${id}${typeof key === "string" ? `?key=${encodeURIComponent(key)}` : ""}`)
  const detail = labRunDetail(store, id)
  const cancellable = canCancel(who, view.ownerId) || (view.ownerId === "public" && typeof key === "string")
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <LabRunView initial={detail} canCancel={cancellable} observations={detail.example ? [...LAB_EXAMPLES[detail.example].observations] : []} runKey={typeof key === "string" ? key : undefined} />
      </main>
    </div>
  )
}
