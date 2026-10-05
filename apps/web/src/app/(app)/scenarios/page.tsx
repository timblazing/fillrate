import { pagePrincipal } from "@/lib/server/access"
import { mode } from "@/lib/server/auth"
import Link from "next/link"
import { redirect } from "next/navigation"

import { SignInButton } from "../account/account-actions"
import { ScenarioWorkbench } from "./scenario-workbench"

export const dynamic = "force-dynamic"
export const metadata = { title: "Scenarios · Fillrate" }

export default async function ScenariosPage() {
  const current = mode().mode
  const who = await pagePrincipal()
  if (who.kind === "pending") redirect("/request-access")
  return <div className="min-h-dvh"><main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6"><div><div className="flex flex-wrap items-baseline justify-between gap-2"><h1 className="text-2xl font-semibold">Scenarios</h1><Link href="/runs" className="text-sm underline underline-offset-4">View pipeline runs</Link></div><p className="text-muted-foreground mt-2 text-sm">Import orders and stock, resolve data, save a version, then run the fulfillment pipeline.</p></div>
    {current === "hosted" && !who.ownerId
      ? <section className="flex flex-col items-start gap-3 rounded-xl border p-6"><h2 className="font-semibold">Request access to work with your own data</h2><p className="text-muted-foreground text-sm text-pretty">Sign in with GitHub to request access. Lessons and bundled examples stay open to everyone.</p><SignInButton /></section>
      : <ScenarioWorkbench access={{ mode: current, account: who.user?.name ?? null }} />}
  </main></div>
}
