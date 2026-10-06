"use client"

import { METERS_PER_MILE } from "@/lib/shipment-sheet"
import { formatMiles } from "@/lib/units"

import { LabCompare, LabLessonSteps, maxUtilization, percentOrDash, units } from "../lab-lesson-kit"

const STORAGE_KEY = "fillrate.lesson.heterogeneous-fleet"

/** The heterogeneous fleet lesson's steps (spec §13): the bundled `fleet` and `fleet_trucks` lab examples, then their persisted results side by side. */
export function FleetSteps({ open, closedNote, runKey }: { open: boolean; closedNote?: string; runKey?: string }) {
  return (
    <LabLessonSteps
      storageKey={STORAGE_KEY}
      open={open}
      closedNote={closedNote}
      runKey={runKey}
      examples={{
        first: { id: "fleet", button: "Run the mixed fleet", open: "Open mixed-fleet run" },
        second: { id: "fleet_trucks", button: "Run trucks only", open: "Open trucks-only run" },
      }}
      steps={{
        first: {
          title: "Solve with vans and box trucks",
          observe: [
            "The plan is validated feasible. All 3 cargo vans are used (their count of 3 binds) plus 1 of the 3 box trucks: 4 vehicles carrying 30 pallets.",
            "At least one van is filled to its 6 pallets while the box truck carries fewer than its 14.",
            "Fixed costs are 3 × 15,000 + 40,000 = 85,000 cost units: cheap vans come first and the dearer truck is added only for what they cannot carry.",
          ],
        },
        second: {
          title: "Remove the vans",
          observe: [
            "The same 10 clients and 30 pallets need all 3 box trucks, with fixed costs of 3 × 40,000 = 120,000. No truck is above 80% of its 14 pallets.",
            "Both the fixed cost and the objective are higher than with the mixed fleet.",
          ],
        },
        compare: {
          title: "Compare the two fleets",
          observe: [
            "The pool of vehicle types is part of the model: each type has its own capacity, fixed cost, per-meter cost and count, and the solver chooses how many of each to use.",
            "A type is used up to its count. Here the vans run out, so a truck covers the rest; with no vans, trucks run part empty.",
            "Costs are abstract cost units on straight-line estimates (× 1.2) around Memphis: not dollars, and not road distances.",
          ],
        },
      }}
      compare={(mixed, trucks) => (
        <LabCompare
          caption="Geographic schematic: distances are meters from straight-line × 1.2 estimates (shown in miles), costs are cost units, not dollars. Utilization is load ÷ capacity per route; “—” means no vehicle of that type was used."
          columns={[["Mixed fleet", mixed], ["Trucks only", trucks]]}
          rows={[
            { key: "feasible", label: "Validated feasible", value: (r) => (r.validated_feasible ? "yes" : "no") },
            { key: "vehicles", label: "Vehicles used", value: (r) => units(r.totals.routes) },
            { key: "types", label: "Types used", value: (r) => r.fleet.map((f) => `${f.vehicle_type} ${f.used} of ${f.available}`).join(", ") },
            { key: "load", label: "Load carried", value: (r) => Object.entries(r.totals.load).map(([d, n]) => `${units(n)} ${r.units.dimensions[d]}`).join(", ") },
            { key: "van-util", label: "Highest van utilization", value: (r) => percentOrDash(maxUtilization(r, "pallets", "van")) },
            { key: "truck-util", label: "Highest box truck utilization", value: (r) => percentOrDash(maxUtilization(r, "pallets", "box-truck")) },
            { key: "distance", label: "Distance driven", value: (r) => formatMiles(r.totals.distance / METERS_PER_MILE) },
            { key: "fixed", label: "Fixed cost", value: (r) => units(r.objective.fixed_cost) },
            { key: "distance-cost", label: "Distance cost", value: (r) => units(r.objective.distance_cost) },
            { key: "objective", label: "Objective", value: (r) => units(r.objective.total) },
          ]}
        />
      )}
    />
  )
}
