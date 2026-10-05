import Link from "next/link"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pagePrincipal } from "@/lib/server/access"
import { canStartRuns, EXAMPLES, exampleInfo, MANUAL_LESSON_PLANS, runsClosedNote } from "@/lib/server/runs"
import { formatFeet } from "@/lib/units"

import { ModelFields } from "../lesson-kit"
import { ManualSteps } from "./manual-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: manual versus optimized routes · Fillrate" }

// Manual versus optimized routes (spec §10, §13): two dispatcher plans evaluated against a real run of the
// bundled `manual` example with the run's own matrix, constraints and objective. Synthetic data only.
export default async function ManualRoutesLessonPage({ searchParams }: PageProps<"/learn/manual-routes">) {
  const { key } = await searchParams
  const { scenario, settings } = EXAMPLES.manual
  const info = exampleInfo(EXAMPLES.manual)
  const capacity = settings.trailer_capacity ?? 5300
  const feet = new Map(scenario.products.map((p) => [p.id, p.linear_feet_per_piece]))
  const pallets = new Map<string, number>()
  let load = 0
  for (const o of scenario.orders)
    for (const l of o.lines) {
      pallets.set(o.location_id, (pallets.get(o.location_id) ?? 0) + l.ordered_pieces)
      load += l.ordered_pieces * (feet.get(l.product_id) ?? 0)
    }
  const order = new Map(scenario.orders.map((o) => [o.location_id, o.id]))
  const labels = Object.fromEntries(scenario.locations.map((l) => [l.id, l.label]))

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <Link href="/learn" className="text-muted-foreground text-sm underline underline-offset-4">Lessons</Link>
          <h1 className="text-2xl font-semibold tracking-tight">Manual versus optimized routes</h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            {info.orders} synthetic customers around a Memphis DC order {formatFeet(load, 0)} of pallets, so at least three {formatFeet(capacity, 0)} trailers are needed. A
            dispatcher&apos;s plan and the solver&apos;s plan only compare fairly when both are judged the same way: the evaluator checks a hand-made plan with the run&apos;s own
            travel matrix, trailer capacity, 500-mile leg limit and objective, and names every rule it breaks. Every step uses a real run on this server; the numbers are what
            to look for, not fixed answers. Travel is estimated (straight-line distance × 1.2), and everything is one cluster (k = {info.k}).
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Customers, in order-number sequence</h2>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Pallets</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scenario.locations.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-xs">{order.get(l.id)}</TableCell>
                    <TableCell>{l.label} <span className="text-muted-foreground font-mono text-xs">{l.id}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{pallets.get(l.id) ?? 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <ModelFields
          fields={[
            ["plan.routes", "A manual plan for one cluster: one list per shipment, each the stops in visit order. Reordering, moving a stop to another shipment and adding or removing a shipment all edit this list."],
            ["settings.trailer_capacity", "53 ft in linear feet; a full pallet is 4 ft, so 13 pallets fit. A shipment over it is invalid, however good its miles look."],
            ["settings.max_leg_m", "No single drive over 500 mi, including depot → first stop. Every stop here is well inside it."],
            ["settings.objective", "Fewest shipments, then fewest miles, with the run's derived truck penalty. The evaluator prices both plans with the same coefficients."],
          ]}
          notModeled="saving a manual plan; moving a stop to another cluster; using a manual plan as a solver warm start; anything the run itself does not model (road matrices, time windows and the rest are off in this scenario)."
        />

        <ManualSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={typeof key === "string" ? key : undefined} plans={MANUAL_LESSON_PLANS} labels={labels} />
      </main>
    </div>
  )
}
