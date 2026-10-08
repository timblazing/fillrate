import Link from "next/link"

import { Page, PageHeader } from "@/components/app/page"
import { LabPlot } from "@/components/lab/lab-plot"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pagePrincipal } from "@/lib/server/access"
import { LAB_EXAMPLES } from "@/lib/server/lab"
import { canStartRuns, runsClosedNote } from "@/lib/server/runs"

import { ModelFields } from "../lesson-kit"
import { DimensionSteps } from "./dimension-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: multiple load dimensions · Fillrate" }

// Load dimension lesson (spec §13): the Solver Lab's planar two-dimension example, with and without its weight dimension.
export default async function LoadDimensionsLessonPage({ searchParams }: PageProps<"/learn/load-dimensions">) {
  const { key } = await searchParams
  const instance = LAB_EXAMPLES.dimensions.instance
  const capacity = instance.vehicle_types[0].capacity
  const keyQuery = typeof key === "string" ? `&key=${encodeURIComponent(key)}` : ""

  return (
    <Page>
      <PageHeader
        title="Multiple load dimensions"
        description={
          <>A truck is limited by more than one thing at a time. Here each of {instance.clients.length} stops asks for some weight and some volume, and every truck
          carries at most {capacity.weight?.toLocaleString("en-US")} kg <em>and</em> {capacity.volume?.toLocaleString("en-US")} L. Steel and tile are heavy and compact; foam is light and bulky. The solver
          is run twice, with and without the weight dimension. Every step starts a real Solver Lab run on this server; the numbers are what to look for, not fixed
          heuristic routes.</>
        }
      >
        <p className="max-w-2xl rounded-xl border border-dashed p-3 text-sm text-pretty">
          <Badge variant="outline" className="mr-2">Planar, abstract units</Badge>
          Coordinates here are abstract plane units, never latitude and longitude, so there is no map. Distances and costs are in abstract units too, and the data is synthetic.
        </p>
      </PageHeader>

      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-labelledby="stops">
        <div className="flex min-w-0 flex-col gap-3">
          <h2 id="stops" className="text-base font-semibold">Stops</h2>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stop</TableHead>
                  <TableHead className="text-right">x, y</TableHead>
                  <TableHead className="text-right">Weight (kg)</TableHead>
                  <TableHead className="text-right">Volume (L)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instance.clients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.label} <span className="text-muted-foreground font-mono text-xs">{c.id}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{c.x}, {c.y}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.delivery?.weight}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.delivery?.volume}</TableCell>
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
          ["dimensions", "Two named load dimensions with units: weight (kg) and volume (L). The volume-only run lists only volume."],
          ["clients[].delivery", "Each stop's demand per dimension. A dimension a client does not list is zero."],
          ["vehicle_types[].capacity", "A per-dimension limit on every route of the type: both must hold at once."],
          ["vehicle_types[].count and fixed_cost", "Up to 5 trucks are available and each used truck costs 100 cost units, so fewer trucks is cheaper."],
          ["coordinates", "planar: abstract units, never latitude/longitude. Distance is rounded Euclidean."],
          ["solver", "seed 0 and a 2,000 iteration budget, so results repeat. Fillrate rechecks every route's load per dimension itself."],
        ]}
        notModeled="pickups or returns (load only leaves the depot), time windows, more depots, a map, or a proof of optimality. Results are the best found within the budget."
      />

      <DimensionSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={typeof key === "string" ? key : undefined} />

      <section className="flex flex-col gap-2 border-t pt-6" aria-labelledby="starter">
        <h2 id="starter" className="text-base font-semibold">Editable starter</h2>
        <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
          The bundled instances are plain JSON in the Solver Lab. Open one there to read it, change a capacity or a demand, and run your own version (editing needs local or operator mode or a signed-in account).
        </p>
        <p className="flex flex-wrap gap-4 text-sm">
          <Link href={`/labs?example=dimensions${keyQuery}`} className="underline underline-offset-4">Open the two-dimension example in the Solver Lab</Link>
          <Link href={`/labs?example=dimensions_volume${keyQuery}`} className="underline underline-offset-4">Open the volume-only example</Link>
        </p>
      </section>
    </Page>
  )
}
