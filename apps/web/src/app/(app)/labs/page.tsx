import Link from "next/link"
import { redirect } from "next/navigation"

import { JobStatusBadge, type JobState } from "@/components/lab/job-status"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { initializeDatabase } from "@/lib/server/database"
import { pagePrincipal } from "@/lib/server/access"
import { canRunCustomLab, LAB_EXAMPLES, labExampleInfo, pageLabExample, visibleLabRuns } from "@/lib/server/lab"
import { canStartRuns, runsClosedNote } from "@/lib/server/runs"

import { LabEditor } from "./lab-editor"

export const dynamic = "force-dynamic"
export const metadata = { title: "Solver Lab · Fillrate" }

const FIELDS = [
  ["coordinates", "planar (abstract units, never latitude/longitude) or geographic (haversine × circuity meters, seconds at a constant speed)"],
  ["dimensions", "1–8 named load dimensions, each with an integer unit"],
  ["depots", "1–10 depots; each vehicle type starts at its start_depot and ends at its end_depot (default: the first depot)"],
  ["clients", "visits created directly: delivery per dimension and service_duration; optional visits with required: false and a prize (cost units) paid when skipped"],
  ["pairs", "pickup-delivery pairs: a pickup stop, a delivery stop and an amount per dimension; both stops on one vehicle, pickup first, the amount counts against capacity while on board (not with reloads)"],
  ["groups", "alternative service groups: members (optional clients without a prize) of which at most one is visited; a required group is served by exactly one"],
  ["vehicle_types", "count, capacity per dimension, fixed_cost, unit_distance_cost, unit_duration_cost, optional max_distance and shift_duration, start_depot and end_depot (depot ids), reload_depots (depot ids) and max_reloads"],
  ["solver", "seed, max_iterations (reproducible) and max_runtime_s (at most 30 s)"],
] as const

// Solver Lab (spec §4 "Progressive depth", M6): generic PyVRP problems on the same durable jobs and contracts as the pipeline.
export default async function LabsPage({ searchParams }: PageProps<"/labs">) {
  const { key, example: param } = await searchParams
  const who = await pagePrincipal()
  if (who.kind === "pending") redirect("/request-access")
  const store = initializeDatabase()
  const example = pageLabExample(param)
  const runs = visibleLabRuns(store, who)
  const runKey = typeof key === "string" ? key : undefined
  const keyQuery = runKey ? `&key=${encodeURIComponent(runKey)}` : ""

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Solver Lab</h1>
          <p className="text-muted-foreground max-w-3xl text-sm text-pretty">
            Write a routing problem directly, without orders or stock, and solve it with the pinned PyVRP 0.14.0. Fillrate then rechecks every route on its own:
            loads per dimension, vehicle counts, limits, distances, durations and costs. PyVRP&apos;s feasibility and Fillrate&apos;s validation are reported separately,
            and a result is the best found within the budget, never a proven optimum.
          </p>
          <nav aria-label="Lab example" className="flex flex-wrap gap-2">
            {Object.values(LAB_EXAMPLES).map((e) => (
              <Button key={e.id} size="sm" variant={e.id === example.id ? "secondary" : "outline"} aria-current={e.id === example.id ? "page" : undefined} render={<Link href={`/labs?example=${e.id}${keyQuery}`} scroll={false} />}>
                {e.label}
              </Button>
            ))}
          </nav>
        </section>

        <LabEditor
          key={example.id}
          example={labExampleInfo(example)}
          instance={example.instance}
          open={canStartRuns(who, key)}
          canEdit={canRunCustomLab(who)}
          closedNote={runsClosedNote()}
          runKey={runKey}
        />

        <section className="flex flex-col gap-3" aria-labelledby="lab-fields">
          <h2 id="lab-fields" className="text-sm font-medium">Supported instance fields</h2>
          <dl className="bg-card grid gap-x-6 gap-y-2 rounded-xl border p-4 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
            {FIELDS.map(([name, text]) => (
              <div key={name} className="contents">
                <dt className="font-mono text-xs break-all sm:pt-0.5">{name}</dt>
                <dd className="text-muted-foreground text-pretty">{text}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground text-xs text-pretty">
            Planned, refused by name for now: client pickups, time windows and
            routing profiles in lab instances.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Recent lab runs</h2>
          {runs.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">No lab runs yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
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
                        <Link href={`/labs/${run.id}${runKey ? `?key=${encodeURIComponent(runKey)}` : ""}`} className="font-mono text-xs underline-offset-4 hover:underline">
                          {run.id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge state={run.status as JobState} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-xs tabular-nums">{new Date(run.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC</TableCell>
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
