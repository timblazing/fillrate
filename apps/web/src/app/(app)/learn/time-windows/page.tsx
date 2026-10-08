import { Page, PageHeader } from "@/components/app/page"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EXAMPLES, exampleInfo, canStartRuns, runsClosedNote } from "@/lib/server/runs"
import { pagePrincipal } from "@/lib/server/access"
import { formatFeet } from "@/lib/units"

import { ModelFields } from "../lesson-kit"
import { WindowSteps } from "./window-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: time windows and waiting · Fillrate" }

// Time windows lesson (spec §13): service-start windows and service durations on one planning day.
// Synthetic data only; travel is the pipeline's estimated constant-speed duration, not a road matrix.
export default async function TimeWindowsLessonPage({ searchParams }: PageProps<"/learn/time-windows">) {
  const { key } = await searchParams
  const { scenario, settings } = EXAMPLES.windows
  const info = exampleInfo(EXAMPLES.windows)
  const time = scenario.time_model
  const feet = new Map(scenario.products.map((p) => [p.id, p.linear_feet_per_piece]))
  const capacity = settings.trailer_capacity ?? 5300
  const pieces = new Map<string, number>()
  let load = 0
  for (const o of scenario.orders)
    for (const l of o.lines) {
      pieces.set(o.location_id, (pieces.get(o.location_id) ?? 0) + l.ordered_pieces)
      load += l.ordered_pieces * (feet.get(l.product_id) ?? 0)
    }
  const windowed = scenario.locations.filter((l) => l.window).length

  return (
    <Page>
      <PageHeader
        title="Time windows and waiting"
        description={
          <>{info.orders} synthetic customers around a Memphis DC on one planning day. All the freight ({formatFeet(load, 0)}) fits one {formatFeet(capacity, 0)} trailer, so
          capacity never sets the truck count. Every customer takes some minutes to unload, and {windowed} of them accept a delivery only if unloading starts inside a
          window. A truck that arrives early waits; a truck that cannot start in time may not go there at all. Every step starts a real run on this server; the numbers
          are what to look for, not fixed answers. Travel is estimated (straight-line distance × 1.2 at a constant 25 mph), and everything is one cluster (k ={" "}
          {info.k}), so clustering plays no part.</>
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Customers, windows and service</h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Window (service start)</TableHead>
                <TableHead className="text-right">Service</TableHead>
                <TableHead className="text-right">Pallets</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenario.locations.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.label} <span className="text-muted-foreground font-mono text-xs">{l.id}</span></TableCell>
                  <TableCell className="tabular-nums">{l.window ? `${l.window.earliest}–${l.window.latest}` : <span className="text-muted-foreground">any time</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.service_minutes ?? 0} min</TableCell>
                  <TableCell className="text-right tabular-nums">{pieces.get(l.id) ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {time && (
          <p className="text-muted-foreground text-sm text-pretty">
            Clock times are local to {time.timezone} on {time.planning_date}, a day with no daylight-saving change. Trucks leave the DC at {time.depot_open} and must
            finish their last stop by {time.horizon_end}.
          </p>
        )}
      </section>

      <ModelFields
        fields={[
          ["time_model.timezone, planning_date", "The IANA timezone and the single day being planned. Clock times are converted to seconds since local midnight, so a daylight-saving change is counted correctly."],
          ["time_model.depot_open, horizon_end", "When trucks leave the DC (06:00) and when every route must be finished (20:00). The horizon may run past midnight, up to 48:00."],
          ["locations[].window.earliest, latest", "When unloading may start, in local clock time. Arriving before earliest means waiting; starting after latest is not allowed."],
          ["locations[].service_minutes", "How long unloading takes at the stop. The truck leaves after service, so service time pushes every later stop back."],
          ["settings.solver_seed", "The PyVRP seed. Change it in step 1; with one cluster and a fixed iteration budget each seed repeats exactly."],
        ]}
        notModeled="driver hours-of-service and breaks; more than one window per stop; release times at the DC; soft windows or lateness penalties; a cost for waiting (the objective counts trucks, then miles); a timed return to the DC (routes are open); traffic or time-of-day travel speeds; plans longer than one day."
      />

      <WindowSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={typeof key === "string" ? key : undefined} />
    </Page>
  )
}
