"use client"

import { LabCompare, LabLessonSteps, maxUtilization, percentOrDash, units } from "../lab-lesson-kit"

const STORAGE_KEY = "fillrate.lesson.load-dimensions"

/** The load dimension lesson's steps (spec §13): the bundled `dimensions` and `dimensions_volume` lab examples, then their persisted results side by side. */
export function DimensionSteps({ open, closedNote, runKey }: { open: boolean; closedNote?: string; runKey?: string }) {
  return (
    <LabLessonSteps
      storageKey={STORAGE_KEY}
      open={open}
      closedNote={closedNote}
      runKey={runKey}
      examples={{
        first: { id: "dimensions", button: "Run with weight and volume", open: "Open two-dimension run" },
        second: { id: "dimensions_volume", button: "Run with volume only", open: "Open volume-only run" },
      }}
      steps={{
        first: {
          title: "Solve with weight and volume",
          observe: [
            "The plan is validated feasible on 3 trucks. The clients want 2,860 kg in all and a truck carries 1,200 kg, so weight alone needs 3; the 4,970 L of volume alone would need only 2.",
            "The heaviest truck is at least 85% of its weight limit, while no truck reaches 60% of its 4,000 L. Weight is the binding dimension; volume has room to spare.",
            "Fixed costs are 3 × 100 = 300 cost units. The objective is the same for every solver seed from 0 to 3 (asserted in the optimizer tests); the page does not rank this heuristic against a proven optimum.",
          ],
        },
        second: {
          title: "Drop the weight dimension",
          observe: [
            "The same 12 stops and the same trucks, but only volume is checked. Two trucks suffice, with fixed costs of 2 × 100 = 200, and no truck is above 70% of its volume.",
            "The objective is lower than the two-dimension run, yet the plan is only valid because weight was left out: checked against the two-dimension instance, both trucks are over 1,200 kg (asserted in the optimizer tests).",
          ],
        },
        compare: {
          title: "Compare the two runs",
          observe: [
            "The extra truck is the cost of the weight limit. Fixed costs are higher with weight and the objective is higher.",
            "A dimension only matters when it can bind: volume never does here. Leaving a real limit out of the model gives a cheaper plan that cannot be driven.",
            "Objectives are in abstract cost units on planar coordinates: compare them within this lesson, never as dollars or miles.",
          ],
        },
      }}
      compare={(withWeight, volumeOnly) => (
        <LabCompare
          caption="Distances are planar units and costs are cost units (abstract; not latitude/longitude, miles or dollars). Utilization is load ÷ capacity per route, as validated by Fillrate; “—” means the dimension is not in that instance."
          columns={[["Weight and volume", withWeight], ["Volume only", volumeOnly]]}
          rows={[
            { key: "feasible", label: "Validated feasible", value: (r) => (r.validated_feasible ? "yes" : "no") },
            { key: "trucks", label: "Trucks", value: (r) => units(r.totals.routes) },
            { key: "weight", label: "Highest weight utilization", value: (r) => percentOrDash(maxUtilization(r, "weight")) },
            { key: "volume", label: "Highest volume utilization", value: (r) => percentOrDash(maxUtilization(r, "volume")) },
            { key: "load", label: "Load carried", value: (r) => ["weight", "volume"].filter((d) => d in r.totals.load).map((d) => `${units(r.totals.load[d])} ${r.units.dimensions[d]}`).join(", ") },
            { key: "fixed", label: "Fixed cost", value: (r) => units(r.objective.fixed_cost) },
            { key: "distance", label: "Distance cost", value: (r) => units(r.objective.distance_cost) },
            { key: "objective", label: "Objective", value: (r) => units(r.objective.total) },
          ]}
        />
      )}
    />
  )
}
