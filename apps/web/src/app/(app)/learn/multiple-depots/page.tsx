import Link from "next/link"

import { Page, PageHeader } from "@/components/app/page"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pagePrincipal } from "@/lib/server/access"
import { LAB_EXAMPLES } from "@/lib/server/lab"
import { canStartRuns, runsClosedNote } from "@/lib/server/runs"

import { ModelFields } from "../lesson-kit"
import { DepotSteps } from "./depot-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: multiple depots · Fillrate" }

// Multiple depots lesson (spec §13): the Solver Lab's `depots` example against its one-depot twin. Planar abstract
// coordinates, synthetic data only; the observations are asserted in services/optimizer/tests/test_lab_examples.py.
export default async function MultipleDepotsLessonPage({ searchParams }: PageProps<"/learn/multiple-depots">) {
  const { key } = await searchParams
  const { instance } = LAB_EXAMPLES.depots
  const runKey = typeof key === "string" ? key : undefined

  return (
    <Page>
      <PageHeader
        title="Multiple depots"
        description={
          <>{instance.clients.length} synthetic stops on an abstract plane (planar units, not latitude/longitude) with two depots, West and East, 120 units apart. Six stops sit
          near each depot, each taking 4 parcels, and every van carries 12. Each vehicle type names the depot it starts from and returns to, so the solver builds
          routes around both. Every step starts a real Solver Lab run on this server and Fillrate rechecks every route; the numbers are what to look for, not fixed answers.</>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {instance.depots.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.label} <span className="text-muted-foreground font-mono text-xs">{d.id}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{d.x}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.y}</TableCell>
                  <TableCell className="text-muted-foreground text-right">depot</TableCell>
                </TableRow>
              ))}
              {instance.clients.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.label} <span className="text-muted-foreground font-mono text-xs">{c.id}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{c.x}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.y}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.delivery?.parcels ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground text-sm text-pretty">
          Starter instance: the two-depot JSON is the Solver Lab example <Link href={`/labs?example=depots${runKey ? `&key=${encodeURIComponent(runKey)}` : ""}`} className="underline underline-offset-4">Two depots</Link>,
          where signed-in owners and local operators can edit it (move a stop, change a van&apos;s <span className="font-mono">start_depot</span>) and run their own version.
        </p>
      </section>

      <ModelFields
        fields={[
          ["depots[]", "1–10 named places with coordinates. Vehicles start and end at depots; stops are never depots."],
          ["vehicle_types[].start_depot, end_depot", "Depot ids. Every vehicle of the type starts at the first and ends at the second; both default to the first depot, so single-depot instances need neither. Two different ids make a one-way route."],
          ["vehicle_types[].count, capacity", "The finite fleet per type. Here two vans are based at each depot: 12 parcels each, 100 per van used."],
          ["clients[].delivery", "Parcels dropped at each stop. The solver may serve any stop from any type with room; here distance decides."],
          ["solver.seed, max_iterations", "Seed 0 and a 2,000-iteration budget, so the same instance repeats exactly."],
        ]}
        notModeled="depot stock, depot capacity or opening hours (a depot is only a place vehicles start and end); choosing which depot a vehicle uses (each type's depots are fixed in the instance); reload trips back to a depot mid-route; time windows; road travel (distance is straight-line in planar units)."
      />

      <DepotSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={runKey} />
    </Page>
  )
}
