import Link from "next/link"

import { Page, PageHeader } from "@/components/app/page"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pagePrincipal } from "@/lib/server/access"
import { LAB_EXAMPLES } from "@/lib/server/lab"
import { canStartRuns, runsClosedNote } from "@/lib/server/runs"

import { ModelFields } from "../lesson-kit"
import { PairSteps } from "./pair-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: pickup-delivery pairs · Fillrate" }

// Pickup-delivery pairs lesson (spec §13): the Solver Lab's `pairs` example against its `pairs_small` twin. Planar abstract
// coordinates, synthetic data only; the observations are asserted in services/optimizer/tests/test_lab_examples.py.
export default async function PickupDeliveryPairsLessonPage({ searchParams }: PageProps<"/learn/pickup-delivery-pairs">) {
  const { key } = await searchParams
  const { instance } = LAB_EXAMPLES.pairs
  const runKey = typeof key === "string" ? key : undefined

  return (
    <Page>
      <PageHeader
        title="Pickup-delivery pairs"
        description={
          <>Six synthetic jobs on an abstract plane (planar units, not latitude/longitude): each moves 6 parcels from a pickup point in the west to a delivery point in the east. A job is a
          pair: one vehicle must do both stops, the pickup first, and the 6 parcels count against its capacity from the pickup until the delivery. Vans may drive at most 450
          units. With capacity 12 a van can carry two pairs at once; with capacity 6 only one. Every step starts a real Solver Lab run on this server and Fillrate rechecks it;
          the numbers are what to look for, not fixed answers. (Here &ldquo;pair&rdquo; is a job; the app&apos;s &ldquo;shipment&rdquo; means a truck&apos;s load.)</>
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Depot, return stop and pairs</h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead className="text-right">Pickup (x, y)</TableHead>
                <TableHead className="text-right">Delivery (x, y)</TableHead>
                <TableHead className="text-right">Parcels</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(instance.pairs ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.label} <span className="text-muted-foreground font-mono text-xs">{p.pickup.id} → {p.delivery.id}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{p.pickup.x}, {p.pickup.y}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.delivery.x}, {p.delivery.y}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.amount.parcels}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground text-xs text-pretty">The depot is at (0, 0). One ordinary stop, &ldquo;return&rdquo; at (10, 5), delivers 1 parcel that the van drops first.</p>
        <p className="text-muted-foreground text-sm text-pretty">
          Starter instance: the capacity-12 JSON is the Solver Lab example <Link href={`/labs?example=pairs${runKey ? `&key=${encodeURIComponent(runKey)}` : ""}`} className="underline underline-offset-4">Pickup-delivery pairs</Link>,
          where signed-in owners and local operators can edit it (move a stop, change a pair&apos;s amount, change the capacity) and run their own version.
        </p>
      </section>

      <ModelFields
        fields={[
          ["pairs[].pickup, delivery", "Two stops per pair, each with its own id, coordinates and service duration. The vehicle that does the pickup must do the delivery, pickup first."],
          ["pairs[].amount", "Quantity per dimension (6 parcels here). It is on board from the pickup to the delivery and counts against capacity at every point in between."],
          ["vehicle_types[].capacity", "12 parcels in step 1 and 6 in step 2. Capacity is checked after every stop, not just at the start."],
          ["vehicle_types[].max_distance", "450 planar units per route: the limit that turns longer routes into more vans."],
          ["clients[].delivery", "An ordinary stop can ride along: its delivery is on board from the depot until the stop (here 1 parcel, dropped first)."],
          ["solver.seed, max_iterations", "Seed 0 and a 2,000-iteration budget, so the same instance repeats exactly."],
        ]}
        notModeled="time windows at pickups and deliveries; optional pairs or prizes; reloads in the same instance; priority or deadlines between pairs; pickups that are not tied to a delivery (a client with its own pickup quantity is planned separately); road travel (distance is straight-line in planar units)."
      />

      <PairSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={runKey} />
    </Page>
  )
}
