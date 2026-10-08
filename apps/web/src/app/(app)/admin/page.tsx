import { notFound } from "next/navigation"
import { listAccessRequests } from "@fillrate/db/access-requests"
import { Page, PageHeader } from "@/components/app/page"
import { pagePrincipal, requireAdmin } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { AdminRequests, type RequestItem } from "./requests"

export const dynamic = "force-dynamic"
export const metadata = { title: "Admin · Fillrate" }

export default async function AdminPage() {
  try { requireAdmin(await pagePrincipal()) } catch { notFound() }
  const rows = listAccessRequests(initializeDatabase()) as RequestItem[]
  const requests = await Promise.all(rows.map(async row => {
    if (!row.githubId) return { ...row, login: null }
    try {
      const response = await fetch(`https://api.github.com/user/${row.githubId}`, { headers: { accept: "application/vnd.github+json" }, next: { revalidate: 3600 }, signal: AbortSignal.timeout(3000) })
      const profile: unknown = response.ok ? await response.json() : null
      return { ...row, login: profile && typeof profile === "object" && "login" in profile && typeof profile.login === "string" ? profile.login : null }
    } catch { return { ...row, login: null } }
  }))
  return (
    <Page>
      <PageHeader title="Access requests" description="People who signed in with GitHub and asked to use this workspace. Approving one lets them import, save and run their own scenarios." />
      <AdminRequests initial={requests} />
    </Page>
  )
}
