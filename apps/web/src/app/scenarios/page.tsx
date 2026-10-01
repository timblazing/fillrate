import { DevHeader } from "@/components/brand/dev-header"
import { pagePrincipal } from "@/lib/server/access"
import { mode } from "@/lib/server/auth"

import { SignInButton } from "../account/account-actions"
import { ScenarioWorkbench } from "./scenario-workbench"

export const dynamic = "force-dynamic"
export const metadata = { title: "Scenarios · Fillrate" }

export default async function ScenariosPage() {
  const current = mode().mode
  const who = await pagePrincipal()
  return <div className="min-h-dvh"><DevHeader /><main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6"><div><h1 className="text-2xl font-semibold">Scenarios</h1><p className="text-muted-foreground mt-2 text-sm">Import orders and stock, resolve data, save a version, then run the fulfillment pipeline.</p></div>
    {current === "hosted" && !who.ownerId
      ? <section className="flex flex-col items-start gap-3 rounded-xl border p-6"><h2 className="font-semibold">Sign in to work with your own data</h2><p className="text-muted-foreground text-sm text-pretty">A free account keeps your imported scenarios, runs and results private to you. Lessons and bundled examples stay open without one.</p><SignInButton /></section>
      : <ScenarioWorkbench access={{ mode: current, account: who.user?.name ?? null }} />}
  </main></div>
}
