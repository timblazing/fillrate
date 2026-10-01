import Link from "next/link"

import { DevHeader } from "@/components/brand/dev-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { initializeDatabase } from "@/lib/server/database"
import { publicExperiments } from "@/lib/server/experiments"
import { exampleScenario, exampleSettings, maxSweepRuns, runsOpen } from "@/lib/server/runs"

import { SweepBuilder } from "./sweep-builder"

export const dynamic = "force-dynamic"
export const metadata = { title: "Sweeps · Fillrate" }

export default async function ExperimentsPage({ searchParams }: PageProps<"/experiments">) {
  const { key, k } = await searchParams
  const runKey = typeof key === "string" ? key : undefined
  const experiments = publicExperiments(initializeDatabase(), false)
  const startK = typeof k === "string" && /^\d+$/.test(k) ? Number(k) : (exampleSettings.k ?? 4)
  return (
    <div className="flex min-h-dvh flex-col">
      <DevHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <Link href={`/runs${runKey ? `?key=${encodeURIComponent(runKey)}` : ""}`} className="text-sm underline underline-offset-4">Pipeline runs</Link>
          <h1 className="text-2xl font-semibold tracking-tight">Sweeps</h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            A sweep runs the full pipeline once per combination of the values below, up to {maxSweepRuns()} runs, on the bundled synthetic
            scenario <span className="text-foreground font-medium">{exampleScenario.name}</span>. Each run is solved anew, so repeated seeds
            are independent. Results are ranked only among valid, complete plans made under the same assumptions.
          </p>
          {runsOpen() ? <SweepBuilder initialK={startK} runKey={runKey} limit={maxSweepRuns()} /> : <p className="text-muted-foreground text-sm">Starting sweeps is disabled on this server. Existing sweeps stay viewable.</p>}
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Recent sweeps</h2>
          {experiments.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">No sweeps yet.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sweep</TableHead>
                    <TableHead className="text-right">Runs finished</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experiments.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Link href={`/experiments/${e.id}${runKey ? `?key=${encodeURIComponent(runKey)}` : ""}`} className="underline-offset-4 hover:underline">{e.name}</Link>
                        <span className="text-muted-foreground ml-2 font-mono text-xs">{e.id.slice(0, 8)}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{e.finished} / {e.runs}</TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs tabular-nums">{new Date(e.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC</TableCell>
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
