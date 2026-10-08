import { Page, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import Link from "next/link"

import { ScenarioWorkbench } from "./scenario-workbench"

export const dynamic = "force-dynamic"
export const metadata = { title: "Scenarios · Fillrate" }

export default async function ScenariosPage() {
  return (
    <Page>
      <PageHeader
        title="Scenarios"
        description="Import orders and stock, resolve data, save a version, then run the fulfillment pipeline."
        actions={<Button variant="outline" size="sm" render={<Link href="/runs" />}>Pipeline runs</Button>}
      />
      <ScenarioWorkbench />
    </Page>
  )
}
