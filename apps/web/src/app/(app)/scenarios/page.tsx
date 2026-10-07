import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card"
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
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Scenarios</h1>
          <Link href="/runs" className="text-sm underline underline-offset-4">View pipeline runs</Link>
        </div>
        <p className="text-muted-foreground text-sm">Import orders and stock, resolve data, save a version, then run the fulfillment pipeline.</p>
      </header>
      {current === "hosted" && !who.ownerId
        ? <Card>
            <CardHeader><CardTitle render={<h2 />}>Request access to work with your own data</CardTitle><CardDescription>Sign in with GitHub to request access. Lessons and bundled examples stay open to everyone.</CardDescription></CardHeader>
            <CardPanel><SignInButton /></CardPanel>
          </Card>
        : <ScenarioWorkbench access={{ mode: current, account: who.user?.name ?? null }} />}
    </main>
  )
}
