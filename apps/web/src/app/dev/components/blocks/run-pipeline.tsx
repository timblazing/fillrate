"use client"

import { ArrowRight } from "lucide-react"
import { useState } from "react"

import { DiagnosticList } from "@/components/lab/diagnostic-list"
import { JobStatusBadge } from "@/components/lab/job-status"
import { PipelineStages } from "@/components/lab/pipeline-stages"
import { RunMetricGroups } from "@/components/lab/run-metrics"
import { SettingSourceBadge, type SettingSource } from "@/components/lab/setting-source"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatCount } from "@/lib/units"

import { baseline, depot, lookups } from "../fixtures"
import { useSimulatedRun } from "../fixtures/stages"
import { AppShell, RunPipelineButton, type Section } from "./shell"

const settings: [string, string, SettingSource][] = [
  ["Allocation", "Order date, then value · piece-level", "default"],
  ["Inventory", "100% of on-hand", "default"],
  ["Trailer", "53 ft · linear feet only · open route · unlimited", "workspace"],
  ["Travel", "Haversine × 1.2 (solver miles)", "workspace"],
  ["Max leg", "500 mi", "default"],
  ["Max cluster diameter", "500 mi", "default"],
  ["Cluster count", "Auto (smallest k that passes)", "default"],
  ["k-means", "seed 0 · n_init 4", "default"],
  ["PyVRP", "seed 0 · 10 s per cluster", "scenario"],
]

// Run pipeline (spec §4, §8a, §9): resolved settings and preflight on the left, the live stage view on the right.
export function RunPipelineBlock() {
  const run = baseline()
  const look = lookups(run)
  const [section, setSection] = useState<Section>("Solve")
  const live = useSimulatedRun(run)
  const done = live.progress >= 1 && !live.running
  const beyond = run.stops.filter((s) => s.depotMiles > run.settings.maxLegMiles)
  const zcta = run.stops.filter((s) => look.locations.get(s.locationId)?.source === "zcta")

  return (
    <AppShell section={section} onSection={setSection} actions={<RunPipelineButton onRun={live.start} running={live.running} />}>
      <div className="grid h-full lg:grid-cols-[22rem_1fr]">
        <ScrollArea className="border-r">
          <div className="space-y-5 p-4">
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
              </dl>
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Preflight</h3>
              <DiagnosticList
                items={[
                  { severity: "warning", title: `${beyond.length} stops beyond the 500 mi leg limit`, detail: `From ${depot.label}. They will be allocated but not loaded.` },
                  { severity: "warning", title: `${zcta.length} stops on ZCTA approximate coordinates` },
                  { severity: "info", title: `${run.splits.length} stops over one trailer will be split` },
                ]}
              />
            </section>
          </div>
        </ScrollArea>

        <ScrollArea>
          <div className="space-y-4 p-4">
            <div className="bg-card space-y-5 rounded-xl border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <JobStatusBadge state={live.running ? "running" : done ? "succeeded" : "queued"} />
                <span className="font-mono text-xs">run-0212</span>
                <span className="text-muted-foreground text-xs">
                  {formatCount(run.lines.length)} lines · {formatCount(run.stops.length)} stops · 1 depot
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {live.running && (
                    <>
                      <Progress value={Math.round(live.progress * 100)} className="w-40" />
                      <Button size="xs" variant="outline" onClick={live.reset}>
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <PipelineStages stages={live.stages} />
            </div>

            {done ? (
              <>
                <RunMetricGroups metrics={run.metrics} maxDiameter={run.settings.maxDiameterMiles} />
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
                  ? "Stages persist as they finish. Closing this tab does not stop the run."
                  : "Press Run pipeline. Allocation, clustering, and one PyVRP solve per cluster run as durable jobs."}
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </AppShell>
  )
}
