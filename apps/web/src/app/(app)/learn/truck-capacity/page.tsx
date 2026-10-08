import { Page, PageHeader } from "@/components/app/page"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EXAMPLES, exampleInfo, canStartRuns, runsClosedNote } from "@/lib/server/runs"
import { pagePrincipal } from "@/lib/server/access"
import { formatFeet } from "@/lib/units"

import { ModelFields } from "../lesson-kit"
import { CapacitySteps } from "./capacity-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: truck capacity · Fillrate" }

// Truck capacity lesson (spec §13): plentiful stock, so trailer length in linear feet is the binding limit.
// Synthetic data only; routing uses the pipeline's estimated haversine travel, not road matrices.
export default async function TruckCapacityLessonPage({ searchParams }: PageProps<"/learn/truck-capacity">) {
  const { key } = await searchParams
  const { scenario, settings } = EXAMPLES.capacity
  const info = exampleInfo(EXAMPLES.capacity)
  const capacity = settings.trailer_capacity ?? 5300
  const feet = new Map(scenario.products.map((p) => [p.id, p.linear_feet_per_piece]))
  const loadAt = new Map<string, number>()
  const products = scenario.products.map((p) => ({ ...p, ordered: 0 }))
  for (const o of scenario.orders)
    for (const l of o.lines) {
      loadAt.set(o.location_id, (loadAt.get(o.location_id) ?? 0) + l.ordered_pieces * (feet.get(l.product_id) ?? 0))
      const row = products.find((p) => p.id === l.product_id)
      if (row) row.ordered += l.ordered_pieces
    }
  const total = [...loadAt.values()].reduce((n, v) => n + v, 0)
  const bound = Math.ceil(total / capacity)
  const oversize = [...loadAt].filter(([, load]) => load > capacity)

  return (
    <Page>
      <PageHeader
        title="Truck capacity"
        description={
          <>{info.orders} synthetic orders, one per stop, within about 160 miles of a Memphis DC. Stock covers every order, so the only hard limit is the 53 ft trailer:
          each piece takes a length of trailer, a truck can carry at most {formatFeet(capacity)}, and the plan cannot use fewer trucks than the total length divided by
          the trailer. One stop orders more than a trailer holds, so it is split over several shipments. Every step starts a real run on this server; the numbers
          are what to look for, not fixed answers. Travel is estimated (straight-line distance × 1.2) and everything is one cluster (k = {info.k}), so clustering
          plays no part.</>
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Freight against trailer capacity</h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Trailer length per piece</TableHead>
                <TableHead className="text-right">Ordered pieces</TableHead>
                <TableHead className="text-right">Trailer length ordered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.label} <span className="text-muted-foreground font-mono text-xs">{p.id}</span></TableCell>
                  <TableCell className="text-right tabular-nums">{formatFeet(p.linear_feet_per_piece)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.ordered.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatFeet(p.ordered * p.linear_feet_per_piece)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">All freight</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right font-medium tabular-nums">{formatFeet(total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <p className="text-muted-foreground text-sm text-pretty">
          {formatFeet(total)} ÷ {formatFeet(capacity)} per trailer = {(total / capacity).toFixed(2)}, so at least {bound} trucks are needed.{" "}
          {oversize.length > 0 && <>One stop orders {formatFeet(oversize[0][1])}, more than two trailers by itself.</>}
        </p>
      </section>

      <ModelFields
        fields={[
          ["products[].linear_feet_per_piece", "Trailer length one piece takes, in hundredths of a foot (400 = 4 ft). A line with its own length overrides it."],
          ["settings.trailer_capacity", "Usable trailer length: 5,300 = 53 ft. Fixed in this lesson; the whole fleet is identical 53 ft trailers."],
          ["settings.preflight.oversize_stop", "A stop whose freight exceeds one trailer: warn (the default) splits it over several shipments, filling whole pieces in allocation order."],
          ["settings.inventory_percent", "Scales every product's stock to this percent, so you change how much freight there is without editing the scenario."],
          ["settings.k, solver_max_iterations", "One cluster and a fixed PyVRP iteration budget, so results repeat exactly."],
        ]}
        notModeled="weight, cube or height limits; stacking and load order; trailer types other than 53 ft; a single piece longer than a trailer (it is excluded as an oversize piece); delivery time windows and driver hours."
      />

      <CapacitySteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={typeof key === "string" ? key : undefined} />
    </Page>
  )
}
