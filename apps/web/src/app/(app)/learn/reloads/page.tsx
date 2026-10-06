import Link from "next/link"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pagePrincipal } from "@/lib/server/access"
import { LAB_EXAMPLES } from "@/lib/server/lab"
import { canStartRuns, runsClosedNote } from "@/lib/server/runs"

import { ModelFields } from "../lesson-kit"
import { ReloadSteps } from "./reload-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: reloads and multiple trips · Fillrate" }

// Reloads lesson (spec §13): the Solver Lab's `reloads` example against its no-reload twin. Planar abstract
// coordinates, synthetic data only; the observations are asserted in services/optimizer/tests/test_lab_examples.py.
export default async function ReloadsLessonPage({ searchParams }: PageProps<"/learn/reloads">) {
  const { key } = await searchParams
  const { instance } = LAB_EXAMPLES.reloads
  const runKey = typeof key === "string" ? key : undefined

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <Link href="/learn" className="text-muted-foreground text-sm underline underline-offset-4">Lessons</Link>
          <h1 className="text-2xl font-semibold tracking-tight">Reloads and multiple trips</h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            {instance.clients.length} synthetic stops on an abstract plane (planar units, not latitude/longitude), each taking 5 parcels, far from the distribution center (DC).
            A van carries only 10, so a single trip serves two stops. A yard sits between the DC and the stops: a van that is allowed to reload returns there, fills up again
            and starts another trip, so one vehicle serves every stop in one route of several trips. Every step starts a real Solver Lab run on this server and Fillrate rechecks
            every trip; the numbers are what to look for, not fixed answers.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Depots and stops</h2>
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
            Starter instance: the reloading JSON is the Solver Lab example <Link href={`/labs?example=reloads${runKey ? `&key=${encodeURIComponent(runKey)}` : ""}`} className="underline underline-offset-4">Reloads</Link>,
            where signed-in owners and local operators can edit it (change <span className="font-mono">max_reloads</span>, move the yard) and run their own version.
          </p>
        </section>

        <ModelFields
          fields={[
            ["depots[]", "The DC and the yard are both depots: places vehicles start, end or reload. Stops are never depots."],
            ["vehicle_types[].reload_depots", "Depot ids where a vehicle of the type may reload between trips (here the yard). Absent means the vehicle never reloads."],
            ["vehicle_types[].max_reloads", "The most reloads one route may make, so up to max_reloads + 1 trips (here 3, so 4 trips). Must be at least 1 when there are reload depots."],
            ["vehicle_types[].capacity", "Applies to each trip on its own: the vehicle is full again after every reload. Max distance and shift duration apply to the whole route."],
            ["vehicle_types[].start_depot, end_depot", "Where the first trip starts and the last ends (the DC here, the default first depot)."],
            ["solver.seed, max_iterations", "Seed 0 and a 2,000-iteration budget, so the same instance repeats exactly."],
          ]}
          notModeled="time spent reloading or loading limits at the yard (a reload takes no time); yard stock or capacity; partial reloads (every trip starts full); pickups; time windows at the yard; choosing which yard (a route may use any listed reload depot, but the solver does not weigh yard capacity or hours); road travel (distance is straight-line in planar units)."
        />

        <ReloadSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={runKey} />
      </main>
    </div>
  )
}
