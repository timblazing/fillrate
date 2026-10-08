import Link from "next/link"

import { Page, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { ExampleSwitch } from "@/components/lab/example-switch"
import { JobStatusBadge, type JobState } from "@/components/lab/job-status"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { initializeDatabase } from "@/lib/server/database"
import { EXAMPLES, exampleInfo, pageExample } from "@/lib/server/runs"
import { visibleRuns } from "@/lib/server/scenarios"

import { NewExplorer, NewRun } from "./new-run"

export const dynamic = "force-dynamic"
export const metadata = { title: "Runs · Fillrate" }

export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  const { example: exampleParam } = await searchParams
  const runs = visibleRuns(initializeDatabase())
  const example = exampleInfo(pageExample(exampleParam))

  return (
    <Page>
      <PageHeader
        title="Pipeline runs"
        description={
          <>
            Each run allocates stock, groups stops into clusters with k-means, builds 53 ft shipments with PyVRP and validates every
            shipment independently. Runs here use a bundled synthetic scenario; imported data lives under scenarios. The list shows
            example runs and runs on your saved scenarios.
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" render={<Link href="/scenarios" />}>Scenarios</Button>
            <Button variant="outline" size="sm" render={<Link href={`/experiments?example=${example.id}`} />}>Sweeps</Button>
          </>
        }
      >
        <ExampleSwitch examples={Object.values(EXAMPLES).map(exampleInfo)} current={example.id} href={(id) => `/runs?example=${id}`} />
        <NewRun key={example.id} example={example.id} defaultK={example.k ?? 4} />
      </PageHeader>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">k explorer</h2>
        <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
          Clusters the same stops for two k values near your choice with seeds 0–9, plus H3 cells at resolutions 1–3, without solving any
          shipments. Use it to pick a k whose groupings do not depend on the seed.
        </p>
        <NewExplorer key={example.id} example={example.id} defaultK={example.k ?? 4} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">No runs yet.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Link href={`/${run.kind === "explorer" ? "explore" : "runs"}/${run.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                        {run.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{run.kind === "explorer" ? "k explorer" : "Pipeline"}</TableCell>
                    <TableCell>
                      <JobStatusBadge state={run.status as JobState} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                      {new Date(run.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </Page>
  )
}
