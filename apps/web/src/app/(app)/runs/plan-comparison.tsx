"use client"

import type { EvaluateResponse, PlanEvaluation, PlanViolation } from "@fillrate/contracts"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { shipmentLabel } from "@/lib/copy"
import { METERS_PER_MILE } from "@/lib/shipment-sheet"
import { formatDriveTime } from "@/lib/timeline"
import { formatCount, formatMiles, formatMoney, formatPercent } from "@/lib/units"
import { cn } from "@/lib/utils"

/** What the manual evaluator answers (`POST /api/v1/runs/<id>/evaluate`), plus who it is about. */
export type Evaluation = EvaluateResponse & { run_id: string; label: "manual" }

export const violationLabel: Record<PlanViolation["code"], string> = {
  unknown_visit: "Not in this cluster",
  unreachable_visit: "Unreachable stop",
  duplicate_visit: "Stop on two shipments",
  missing_visit: "Stop left off",
  empty_truck: "Empty shipment",
  over_capacity: "Over trailer capacity",
  leg_missing: "No recorded leg",
  leg_over_limit: "Drive over the leg limit",
  leg_mismatch: "Leg differs from the snapshot",
  leg_no_duration: "No recorded drive time",
  window_late: "Window missed",
  horizon_exceeded: "Past the end of the day",
  cluster_diameter: "Cluster too wide",
  vehicle_type_missing: "Shipment without a vehicle type",
  unknown_vehicle_type: "Unknown vehicle type",
  fleet_count_exceeded: "More vehicles than the fleet has",
}

const miles = (m: number | null | undefined) => (m == null ? "n/a" : formatMiles(m / METERS_PER_MILE))

const objectiveNote = (mode: string) =>
  mode === "trucks_then_distance"
    ? "Fewest shipments, then fewest miles: the run's derived truck penalty plus meters."
    : mode === "cost"
      ? "Truck and mile costs, in exact cents."
      : "The run's truck penalty (meters per truck) plus meters."

type Row = { label: string; value: (e: PlanEvaluation) => number | null | undefined; format: (n: number) => string; better?: "lower" | "higher"; note?: string }

/**
 * Optimized (the run's routes, re-evaluated) and manual plans side by side, under the run's own matrices,
 * constraints and objective, with every violation the validator found in the manual plan.
 */
export function PlanComparison({ result, places, stale = false }: { result: Evaluation; places: Map<string, string>; stale?: boolean }) {
  const { manual, reference } = result
  const mode = manual.metrics.objective_mode
  const timed = manual.trucks.some((t) => t.wait_s_total != null) || Boolean(reference?.trucks.some((t) => t.wait_s_total != null))
  const rows: Row[] = [
    { label: "Shipments", value: (e) => e.metrics.trucks, format: formatCount, better: "lower" },
    { label: "Loaded miles", value: (e) => e.metrics.loaded_distance_m, format: (n) => miles(n), better: "lower" },
    { label: "Drive time", value: (e) => e.metrics.drive_s, format: formatDriveTime, better: "lower" },
    ...(timed ? [{ label: "Waiting", value: (e: PlanEvaluation) => e.metrics.wait_s, format: formatDriveTime, better: "lower" as const }] : []),
    { label: "Average fill", value: (e) => e.metrics.avg_fill, format: (n) => formatPercent(n), better: "higher" },
    { label: "Lowest fill", value: (e) => e.metrics.min_fill, format: (n) => formatPercent(n), better: "higher" },
    { label: "Stops on a shipment", value: (e) => e.metrics.planned_visit_count, format: (n) => `${formatCount(n)} of ${formatCount(manual.metrics.visit_count)}`, better: "higher" },
    { label: "Planned revenue", value: (e) => e.metrics.planned_amount_cents, format: (n) => formatMoney(n), better: "higher" },
    mode === "cost"
      ? { label: "Cost", value: (e) => e.metrics.objective_cents, format: (n) => formatMoney(Math.round(n)), better: "lower", note: objectiveNote(mode) }
      : { label: "Objective", value: (e) => e.metrics.objective, format: formatCount, better: "lower", note: objectiveNote(mode) },
  ]
  const byVisit = (id: string | null | undefined) => {
    if (!id) return null
    try {
      const [location] = JSON.parse(id.slice(0, id.lastIndexOf("#"))) as [string]
      return places.get(location) ?? location
    } catch {
      return id
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Manual plan evaluation">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Evaluation</h3>
        <Badge variant={manual.valid ? "success" : "error"}>{manual.valid ? "Manual plan valid" : `Manual plan invalid · ${manual.violations.length} ${manual.violations.length === 1 ? "violation" : "violations"}`}</Badge>
        <Badge variant="outline">Manual baseline, not a solver result</Badge>
        {stale && <Badge variant="warning">Plan changed since this evaluation</Badge>}
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cluster {result.cluster_id}</TableHead>
              <TableHead className="text-right">Optimized (this run)</TableHead>
              <TableHead className="text-right">Manual</TableHead>
              <TableHead className="text-right">Manual − optimized</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Validator</TableCell>
              <TableCell className="text-right">{reference ? (reference.valid ? "valid" : "invalid") : "no candidate"}</TableCell>
              <TableCell className="text-right">{manual.valid ? "valid" : "invalid"}</TableCell>
              <TableCell />
            </TableRow>
            {rows.map((row) => {
              const a = reference ? row.value(reference) : null
              const b = row.value(manual)
              const diff = a != null && b != null ? b - a : null
              // Better or worse only means something between valid plans.
              const judged = manual.valid && reference?.valid
              const good = diff != null && diff !== 0 && (row.better === "lower" ? diff < 0 : diff > 0)
              return (
                <TableRow key={row.label}>
                  <TableCell>
                    {row.label}
                    {row.note && <span className="text-muted-foreground block text-[11px] whitespace-normal">{row.note}</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{a == null ? "n/a" : row.format(a)}</TableCell>
                  <TableCell className="text-right tabular-nums">{b == null ? "n/a" : row.format(b)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", diff && judged ? (good ? "text-success-foreground" : "text-destructive-foreground") : "text-muted-foreground")}>
                    {diff == null ? "" : diff === 0 ? "same" : `${diff > 0 ? "+" : "−"}${row.format(Math.abs(diff))}`}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground text-xs text-pretty">
        Both columns are computed now by the same validator, on this run&apos;s recorded travel matrix, visits, trailer capacity, leg limit{timed ? ", time windows and service times" : ""} and objective.
        The objective ranks valid plans of this cluster only. {manual.metrics.unmeasured_trucks ? `${manual.metrics.unmeasured_trucks} manual shipment(s) use a leg with no recorded value, so miles and the objective are unavailable. ` : ""}
        Evaluations are not saved.
      </p>
      {manual.violations.length > 0 && (
        <Alert variant="error">
          <AlertTitle>Why the manual plan is invalid</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1.5" aria-label="Violations">
              {manual.violations.map((v, i) => (
                <li key={i} className="flex flex-col">
                  <span>
                    <span className="font-medium">{violationLabel[v.code]}</span>
                    {v.truck != null && ` · ${shipmentLabel(v.truck)}`}
                    {byVisit(v.visit_id) && ` · ${byVisit(v.visit_id)}`}
                  </span>
                  <span className="text-muted-foreground font-mono text-[11px] break-all">{v.message}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}
