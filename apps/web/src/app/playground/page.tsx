import { Page, PageHeader } from "@/components/app/page"
import { playgroundCaps } from "@/lib/server/playground"
import { EXAMPLES, exampleInfo } from "@/lib/server/runs"

import { PlaygroundView } from "./playground-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Playground · Fillrate" }

export default function PlaygroundPage() {
  const { name, orders } = exampleInfo(EXAMPLES.lesson)
  return (
    <Page>
      <PageHeader title="Playground" description="Try the fulfillment pipeline on the bundled example or on your own CSV files." />
      <PlaygroundView caps={playgroundCaps()} example={{ name, orders }} />
    </Page>
  )
}
