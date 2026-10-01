"use client"

import { ArrowRight } from "lucide-react"
import { useState } from "react"

import { JobStatusBadge } from "@/components/lab/job-status"
import { ObjectiveSettings } from "@/components/lab/objective-settings"
import { PipelineStages, StepsPanel } from "@/components/lab/pipeline-stages"
import { PlanFlow } from "@/components/lab/plan-flow"
import { type PreflightCheckItem, PreflightChecks, type PreflightResolution, preflightBlocked } from "@/components/lab/preflight-checks"
import { RunMetricGroups } from "@/components/lab/run-metrics"
import { SettingSourceBadge, type SettingSource } from "@/components/lab/setting-source"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { legRule } from "@/lib/copy"
import { formatCount } from "@/lib/units"

import { baseline, lookups } from "../fixtures"
import { planFlowSteps, useSimulatedRun } from "../fixtures/stages"
import { AppShell, RunPipelineButton, type Section } from "./shell"

const settings: [string, string, SettingSource][] = [
  ["Allocation", "Order date, then value · piece-level", "default"],
  ["Inventory", "100% of on-hand", "default"],
  ["Trailer", "53 ft · linear feet only · open route · unlimited", "workspace"],
  ["Travel", "Haversine × 1.2 (solver miles)", "workspace"],
  ["Max single drive", "500 mi, including depot → first stop", "default"],
  ["Cluster count", "k = 6 (from the k explorer)", "run"],
  ["k-means", "seed 0 · n_init 4", "default"],
  ["PyVRP", "seed 0 · 10 s per cluster", "scenario"],
]

// Run pipeline (spec §4, §8a, §9): resolved settings and preflight on the left, the live stage view on the right.
// Blocking checks disable Run pipeline until each is resolved (spec v1.8 §15 M2 item 8).
export function RunPipelineBlock() {
  const run = baseline()
  const look = lookups(run)
  const [section, setSection] = useState<Section>("Solve")
  const live = useSimulatedRun(run)
  const done = live.progress >= 1 && !live.running
  const [resolutions, setResolutions] = useState<Record<string, PreflightResolution | null>>({})

  const beyond = run.stops.filter((s) => s.depotMiles > run.settings.maxLegMiles)
  const zcta = run.stops.filter((s) => look.locations.get(s.locationId)?.source === "zcta")
  const missing = run.unshipped.filter((u) => u.reason === "data-quality")
  const splitIds = new Set(run.splits.map((s) => s.stop))
  const oversize = run.stops.filter((s) => s.split && splitIds.has(s.id.replace(/·\d+$/, "")))
  const checks: PreflightCheckItem[] = [
    {
      id: "missing_coordinates",
      title: "Addresses with no coordinates",
      action: "block",
      lines: missing.length,
      locations: new Set(missing.map((u) => u.locationId)).size,
      refs: missing.slice(0, 4).map((u) => u.lineId),
    },
    {
      id: "far_from_depot",
      title: "Stops farther than 500 mi from the depot",
      action: "block",
      detail: "One may still be reachable through another stop; this check is your rule, not a physical limit",
      lines: beyond.reduce((n, s) => n + s.lineIds.length, 0),
      locations: beyond.length,
      refs: beyond.slice(0, 4).map((s) => s.id),
    },
    {
      id: "oversize_stop",
      title: "A stop larger than one trailer",
      action: "block",
      detail: "Turned into a warning, the stop is split across shipments",
      lines: new Set(oversize.flatMap((s) => s.lineIds)).size,
      locations: run.splits.length,
      refs: run.splits.slice(0, 4).map((s) => s.stop),
    },
    {
      id: "approximate_coordinates",
      title: "Placed by ZIP code only",
      action: "warn",
      detail: "Approximate; the run proceeds",
      lines: zcta.reduce((n, s) => n + s.lineIds.length, 0),
      locations: zcta.length,
    },
  ].filter((c) => c.lines > 0).map((c) => ({ ...c, resolution: resolutions[c.id] ?? null }) as PreflightCheckItem)
  const blocked = preflightBlocked(checks)

  return (
    <AppShell section={section} onSection={setSection} actions={<RunPipelineButton onRun={live.start} running={live.running} blocked={blocked} />}>
      <div className="grid h-full lg:grid-cols-[22rem_1fr]">
        <ScrollArea className="border-r">
          <div className="space-y-5 p-4">
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Preflight</h3>
              <PreflightChecks items={checks} onResolve={(id, r) => setResolutions((x) => ({ ...x, [id]: r }))} />
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Resolved settings</h3>
              <dl className="bg-card divide-y rounded-xl border text-xs">
                {settings.map(([label, value, source]) => (
                  <div key={label} className="flex items-center gap-2 px-3 py-2">
                    <dt className="text-muted-foreground w-28 shrink-0">{label}</dt>
                    <dd className="min-w-0 flex-1 truncate">{value}</dd>
                    <SettingSourceBadge source={source} />
                  </div>
                ))}
                {Object.entries(resolutions).filter(([, r]) => r).map(([id, r]) => (
                  <div key={id} className="flex items-center gap-2 px-3 py-2">
                    <dt className="text-muted-foreground w-28 shrink-0">Preflight</dt>
                    <dd className="min-w-0 flex-1 truncate">
                      {id.replaceAll("_", " ")}: {r === "excluded" ? "lines excluded (excluded_by_user)" : "warning only"}
                    </dd>
                    <SettingSourceBadge source="run" />
                  </div>
                ))}
              </dl>
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Fleet and constraints</h3>
              <ObjectiveSettings />
            </section>
          </div>
        </ScrollArea>

        <ScrollArea>
          <div className="space-y-4 p-4">
            {blocked && (
              <Alert variant="error">
                <AlertTitle>Run pipeline is blocked</AlertTitle>
                <AlertDescription>
                  Resolve each blocking check: fix the data, exclude the lines (recorded and reconciled like any exclusion), or turn the check into a
                  warning. {legRule()}
                </AlertDescription>
              </Alert>
            )}
            {done && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Plan</h3>
                <PlanFlow steps={planFlowSteps(run)} />
              </section>
            )}
            <StepsPanel
              actions={
                live.running && (
                  <>
                    <Progress value={Math.round(live.progress * 100)} className="w-40" />
                    <Button size="xs" variant="outline" onClick={live.reset}>
                      Cancel
                    </Button>
                  </>
                )
              }
            >
              <div className="bg-card space-y-5 rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <JobStatusBadge state={live.running ? "running" : done ? "succeeded" : "queued"} />
                  <span className="font-mono text-xs">run-0212</span>
                  <span className="text-muted-foreground text-xs">
                    {formatCount(run.lines.length)} lines · {formatCount(run.stops.length)} stops · 1 depot
                  </span>
                </div>
                <PipelineStages stages={live.stages} />
              </div>
            </StepsPanel>

            {done ? (
              <>
                <RunMetricGroups metrics={run.metrics} />
                <div className="flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm">
                    Branch settings…
                  </Button>
                  <Button size="sm">
                    Open results <ArrowRight />
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground px-1 text-xs">
                {live.running
                  ? "Steps persist as they finish. Closing this tab does not stop the run."
                  : "Press Run pipeline. Allocation, clustering, and one PyVRP solve per cluster run as durable jobs."}
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </AppShell>
  )
}
