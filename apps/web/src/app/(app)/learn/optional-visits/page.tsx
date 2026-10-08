import Link from "next/link"

import { Page, PageHeader } from "@/components/app/page"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pagePrincipal } from "@/lib/server/access"
import { LAB_EXAMPLES } from "@/lib/server/lab"
import { canStartRuns, runsClosedNote } from "@/lib/server/runs"

import { ModelFields } from "../lesson-kit"
import { PrizeSteps } from "./prize-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: optional visits and prizes · Fillrate" }

// Optional visits lesson (spec §13): the Solver Lab's `prizes` example against its higher-prize twin. Planar abstract
// coordinates, synthetic data only; the observations are asserted in services/optimizer/tests/test_lab_examples.py.
export default async function OptionalVisitsLessonPage({ searchParams }: PageProps<"/learn/optional-visits">) {
  const { key } = await searchParams
  const { instance } = LAB_EXAMPLES.prizes
  const runKey = typeof key === "string" ? key : undefined

  return (
    <Page>
      <PageHeader
        title="Optional visits and prizes"
        description={
          <>{instance.clients.length} synthetic stops on an abstract plane (planar units, not latitude/longitude): five required stops near the depot and three optional stops far
          away. An optional stop may be skipped, and the solver then pays the stop&apos;s prize as a penalty. It visits an optional stop only when that costs less than the prize it
          would otherwise pay. The prize is in the same cost unit as the routes but is reported separately and never added to the cost. Every step starts a real Solver Lab run
          on this server and Fillrate rechecks it; the numbers are what to look for, not fixed answers.</>
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Depots and stops</h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Place</TableHead>
                <TableHead className="text-right">x</TableHead>
                <TableHead className="text-right">y</TableHead>
                <TableHead className="text-right">Parcels</TableHead>
                <TableHead className="text-right">Visit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {instance.depots.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.label} <span className="text-muted-foreground font-mono text-xs">{d.id}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{d.x}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.y}</TableCell>
                  <TableCell className="text-muted-foreground text-right">depot</TableCell>
                  <TableCell />
                </TableRow>
              ))}
              {instance.clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.label} <span className="text-muted-foreground font-mono text-xs">{c.id}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{c.x}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.y}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.delivery?.parcels ?? 0}</TableCell>
                  <TableCell className="text-right text-xs">{c.required === false ? `optional, prize ${c.prize ?? 0}` : "required"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground text-sm text-pretty">
          Starter instance: the low-prize JSON is the Solver Lab example <Link href={`/labs?example=prizes${runKey ? `&key=${encodeURIComponent(runKey)}` : ""}`} className="underline underline-offset-4">Optional stops</Link>,
          where signed-in owners and local operators can edit it (change a <span className="font-mono">prize</span>, make a stop required) and run their own version.
        </p>
      </section>

      <ModelFields
        fields={[
          ["clients[].required", "false makes the visit optional. Absent means required: the plan is invalid if a required client is not visited."],
          ["clients[].prize", "Cost units paid when an optional client is skipped (the three remote stops carry 60 in step 1 and 400 in step 2). A required client may not have a prize."],
          ["objective", "Nominal cost (vans used, distance) is reported on its own. The uncollected prizes are a second term, and PyVRP minimizes their sum."],
          ["vehicle_types[].count, capacity, fixed_cost", "Up to three vans of 10 parcels at 100 per van used: a second van is part of what visiting the remote stops costs."],
          ["solver.seed, max_iterations", "Seed 0 and a 2,000-iteration budget, so the same instance repeats exactly."],
        ]}
        notModeled="exclusive alternatives between stops (client groups); prizes that depend on the vehicle or the time; collecting a prize partly; a minimum number of optional visits; proof that a skipped stop is not worth visiting (the search is a heuristic and only reports what it found); road travel (distance is straight-line in planar units)."
      />

      <PrizeSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={runKey} />
    </Page>
  )
}
