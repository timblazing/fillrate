import { redirect } from "next/navigation"
import { accessFor } from "@fillrate/db/access-requests"
import { PublicHeader } from "@/components/brand/public-header"
import { pagePrincipal } from "@/lib/server/access"
import { mode } from "@/lib/server/auth"
import { initializeDatabase } from "@/lib/server/database"
import { SignInButton } from "../(app)/account/account-actions"
import { RequestForm } from "./request-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "Request access · Fillrate" }

export default async function RequestAccessPage() {
  const who = await pagePrincipal()
  if (who.kind === "user") redirect("/account")
  const config = mode()
  const access = who.user && config.mode === "hosted" ? accessFor(initializeDatabase(), who.user.id, config.adminGithubId, config.signupMode) : null
  return <div className="min-h-dvh"><PublicHeader /><main className="mx-auto w-full max-w-xl space-y-5 px-4 py-8 sm:px-6">
    <h1 className="text-2xl font-semibold">Request access</h1>
    {!who.user ? <div className="space-y-4"><p className="text-muted-foreground text-sm">Sign in with GitHub to request access. Lessons and bundled examples are open to everyone.</p><SignInButton /></div>
      : <RequestForm name={who.user.name} email={who.user.email} image={who.user.image} status={access!.status} note={access!.note ?? ""} canRetry={access!.canRetry} />}
  </main></div>
}
