import Link from "next/link"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pagePrincipal } from "@/lib/server/access"
import { LAB_EXAMPLES } from "@/lib/server/lab"
import { canStartRuns, runsClosedNote } from "@/lib/server/runs"

import { ModelFields } from "../lesson-kit"
import { GroupSteps } from "./group-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: alternative service groups · Fillrate" }

// Alternative groups lesson (spec §13): the Solver Lab's `groups` example against its `groups_south` twin. Planar abstract
// coordinates, synthetic data only; the observations are asserted in services/optimizer/tests/test_lab_examples.py.
export default async function AlternativeGroupsLessonPage({ searchParams }: PageProps<"/learn/alternative-groups">) {
  const { key } = await searchParams
  const { instance } = LAB_EXAMPLES.groups
  const runKey = typeof key === "string" ? key : undefined

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <Link href="/learn" className="text-muted-foreground text-sm underline underline-offset-4">Lessons</Link>
          <h1 className="text-2xl font-semibold tracking-tight">Alternative service groups</h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            {instance.clients.length} synthetic visits on an abstract plane (planar units, not latitude/longitude). Customer Acme needs 2 parcels and can be served at one of two
            service points, its north dock or its south dock. The two docks form one required group: the plan must visit exactly one of them, and the solver picks the one that suits the
            routes. Four other required stops lie on one side of the depot, and in step 2 on the other. Every step starts a real Solver Lab run on this server and Fillrate rechecks
            it; the numbers are what to look for, not fixed answers.
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
                    <TableCell className="text-right text-xs">{c.required === false ? "alternative" : "required"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-sm text-pretty">
            Starter instance: the north-side JSON is the Solver Lab example <Link href={`/labs?example=groups${runKey ? `&key=${encodeURIComponent(runKey)}` : ""}`} className="underline underline-offset-4">Alternative docks</Link>,
            where signed-in owners and local operators can edit it (move a dock, add a third alternative, make the group optional) and run their own version.
          </p>
        </section>

        <ModelFields
          fields={[
            ["groups[].members", "Client ids that are alternatives for the same customer. At most one member is visited; each keeps its own location, delivery and service duration."],
            ["groups[].required", "true (the default) means exactly one member must be visited; false means at most one, so the whole group may be left unserved."],
            ["clients[].required", "Members must be optional (required: false) and carry no prize: the group, not a prize, decides, and a client belongs to at most one group."],
            ["vehicle_types[].count, capacity", "Two vans of 10 parcels at 100 per van used: the five visits fill exactly one van."],
            ["solver.seed, max_iterations", "Seed 0 and a 2,000-iteration budget, so the same instance repeats exactly."],
          ]}
          notModeled="a customer's choice: the solver picks the alternative, nothing models which one the customer prefers; different prices or time windows per alternative; serving a customer at several points (members are exclusive); quantities that depend on the member chosen; road travel (distance is straight-line in planar units)."
        />

        <GroupSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={runKey} />
      </main>
    </div>
  )
}
