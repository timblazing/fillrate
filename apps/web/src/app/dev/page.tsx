import type { Metadata } from "next"

import { DevHeader } from "@/components/brand/dev-header"
import { loadProjectDocs } from "@/lib/server/project-docs"

import { ProgressView } from "./progress-view"

export const metadata: Metadata = { title: "Progress · Fillrate" }

// Built once from the docs at build time (they are not in the runtime image); ProgressView then
// refreshes them in the browser from GitHub `main`.
export const dynamic = "force-static"

export default function ProgressPage() {
  return (
    <div className="min-h-svh">
      <DevHeader />
      <ProgressView initial={loadProjectDocs()} />
    </div>
  )
}
