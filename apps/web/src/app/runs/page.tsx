import Link from "next/link"

import { DevHeader } from "@/components/brand/dev-header"
import { JobStatusBadge, type JobState } from "@/components/lab/job-status"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { initializeDatabase } from "@/lib/server/database"
import { exampleScenario, runsOpen } from "@/lib/server/runs"

import { NewRun } from "./new-run"

export const dynamic = "force-dynamic"
export const metadata = { title: "Runs · Fillrate" }

export default async function RunsPage({ searchParams }: PageProps<"/runs">) {
  const { key } = await searchParams
  const runs = initializeDatabase().listRuns(50)
  const orders = exampleScenario.orders.length
  const lines = exampleScenario.orders.reduce((n, o) => n + o.lines.length, 0)

  return (
    <div className="flex min-h-dvh flex-col">
      <DevHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline runs</h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            Each run allocates stock, groups stops with k-means, builds 53 ft truckloads with PyVRP and validates every
            load independently. Runs use the bundled synthetic scenario <span className="text-foreground font-medium">{exampleScenario.name}</span>{" "}
            ({orders} orders, {lines} lines, {exampleScenario.locations.length} locations). No real customer data.
          </p>
          <NewRun open={runsOpen()} runKey={typeof key === "string" ? key : undefined} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Recent runs</h2>
          {runs.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">No runs yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link href={`/runs/${run.id}${typeof key === "string" ? `?key=${encodeURIComponent(key)}` : ""}`} className="font-mono text-xs underline-offset-4 hover:underline">
                          {run.id.slice(0, 8)}
                        </Link>
                      </TableCell>
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
      </main>
    </div>
  )
}
