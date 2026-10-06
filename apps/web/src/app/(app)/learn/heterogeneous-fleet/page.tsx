import Link from "next/link"

import { LabPlot } from "@/components/lab/lab-plot"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pagePrincipal } from "@/lib/server/access"
import { LAB_EXAMPLES } from "@/lib/server/lab"
import { canStartRuns, runsClosedNote } from "@/lib/server/runs"

import { ModelFields } from "../lesson-kit"
import { FleetSteps } from "./fleet-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: heterogeneous fleets · Fillrate" }

// Heterogeneous fleet lesson (spec §13): the Solver Lab's Memphis example with three vans and three box trucks, then trucks only.
export default async function HeterogeneousFleetLessonPage({ searchParams }: PageProps<"/learn/heterogeneous-fleet">) {
  const { key } = await searchParams
  const instance = LAB_EXAMPLES.fleet.instance
  const pallets = instance.clients.reduce((n, c) => n + (c.delivery?.pallets ?? 0), 0)
  const keyQuery = typeof key === "string" ? `&key=${encodeURIComponent(key)}` : ""

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <Link href="/learn" className="text-muted-foreground text-sm underline underline-offset-4">Lessons</Link>
          <h1 className="text-2xl font-semibold tracking-tight">Heterogeneous fleets</h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            Real fleets mix vehicle types. {instance.clients.length} synthetic customers around a Memphis DC want {pallets} pallets in all. The fleet has three small, cheap cargo vans and three
            larger, costlier box trucks, each type with its own capacity, fixed cost per use and cost per meter. The solver picks how many of each to use. Every step starts a real Solver
            Lab run on this server; the numbers are what to look for, not fixed heuristic routes.
          </p>
          <p className="max-w-2xl rounded-xl border border-dashed p-3 text-sm text-pretty">
            <Badge variant="outline" className="mr-2">Geographic, schematic</Badge>
            Coordinates are synthetic latitude/longitude pairs near Memphis. Travel is straight-line distance × 1.2 and the plot is a flat schematic, not a map or road network. Costs are abstract cost units, not dollars.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-labelledby="fleet-types">
          <div className="flex min-w-0 flex-col gap-3">
            <h2 id="fleet-types" className="text-sm font-medium">Vehicle types</h2>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Pallets</TableHead>
                    <TableHead className="text-right">Fixed cost</TableHead>
                    <TableHead className="text-right">Per meter</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instance.vehicle_types.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell>{v.label} <span className="text-muted-foreground font-mono text-xs">{v.id}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{v.count}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.capacity.pallets}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.fixed_cost?.toLocaleString("en-US")}</TableCell>
                      <TableCell className="text-right tabular-nums">{v.unit_distance_cost}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <h2 className="mt-2 text-sm font-medium">Customers</h2>
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Pallets</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instance.clients.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.label} <span className="text-muted-foreground font-mono text-xs">{c.id}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{c.delivery?.pallets}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <LabPlot instance={instance} result={null} className="self-start" />
        </section>

        <ModelFields
          fields={[
            ["vehicle_types[]", "Several types in one instance, each with its own id, count, per-dimension capacity, fixed_cost, unit_distance_cost and optional unit_duration_cost."],
            ["vehicle_types[].count", "How many vehicles of the type exist. The result's fleet list reports used out of available per type."],
            ["vehicle_types[].fixed_cost", "Charged once for every used vehicle (15,000 per van, 40,000 per box truck). It is what makes using a truck expensive."],
            ["vehicle_types[].unit_distance_cost", "Cost per meter driven (1 for vans, 2 for box trucks); the objective is recomputed from the routes."],
            ["coordinates", "geographic: haversine × 1.2 meters and seconds at a constant speed. The plot is a schematic projection, not a map."],
            ["solver", "seed 0 and a 2,000 iteration budget. Fillrate rechecks every route's load, vehicle counts and costs itself."],
          ]}
          notModeled="road networks or recorded matrices in lab instances, time windows, multiple depots, per-type start and end depots, a type's maximum distance or shift in this lesson, or a proof of optimality. Results are the best found within the budget."
        />

        <FleetSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={typeof key === "string" ? key : undefined} />

        <section className="flex flex-col gap-2 border-t pt-6" aria-labelledby="starter">
          <h2 id="starter" className="text-sm font-medium">Editable starter</h2>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            The bundled instances are plain JSON in the Solver Lab. Open one there to read it, change a count, capacity or fixed cost, and run your own version (editing needs local or operator mode or a signed-in account).
          </p>
          <p className="flex flex-wrap gap-4 text-sm">
            <Link href={`/labs?example=fleet${keyQuery}`} className="underline underline-offset-4">Open the mixed fleet in the Solver Lab</Link>
            <Link href={`/labs?example=fleet_trucks${keyQuery}`} className="underline underline-offset-4">Open the trucks-only example</Link>
          </p>
        </section>
      </main>
    </div>
  )
}
