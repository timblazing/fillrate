import { Page, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
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
    <Page>
      <PageHeader
        title="Scenarios"
        description="Import orders and stock, resolve data, save a version, then run the fulfillment pipeline."
        actions={<Button variant="outline" size="sm" render={<Link href="/runs" />}>Pipeline runs</Button>}
      />
      {current === "hosted" && !who.ownerId
        ? <Card>
            <CardHeader><CardTitle render={<h2 />}>Request access to work with your own data</CardTitle><CardDescription>Sign in with GitHub to request access. Lessons and bundled examples stay open to everyone.</CardDescription></CardHeader>
            <CardPanel><SignInButton /></CardPanel>
          </Card>
        : <ScenarioWorkbench access={{ mode: current, account: who.user?.name ?? null }} />}
    </Page>
  )
}
