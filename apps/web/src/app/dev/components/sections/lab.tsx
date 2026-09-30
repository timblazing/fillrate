"use client"

import { ArrowRight, Pause, Play, RotateCcw, Square } from "lucide-react"
import { useEffect, useState } from "react"

import { CodeBlock } from "@/components/lab/code-block"
import { ConfigDiff } from "@/components/lab/config-diff"
import { DataTable, dataTableColumns } from "@/components/lab/data-table"
import { DiagnosticList } from "@/components/lab/diagnostic-list"
import { Explainer } from "@/components/lab/explainer"
import { ImportDropzone } from "@/components/lab/import-dropzone"
import { JobStatusBadge, JobStatusDot, jobStates } from "@/components/lab/job-status"
import { MatrixHeatmap } from "@/components/lab/matrix-heatmap"
import { CoordinateSourceBadge, TravelModeBadge } from "@/components/lab/provenance-badge"
import { RouteTimeline, formatClock } from "@/components/lab/route-timeline"
import { RouteLegend, RouteSwatch } from "@/components/lab/route-swatch"
import { SettingRow, SettingSourceBadge } from "@/components/lab/setting-source"
import { StatTile } from "@/components/lab/stat-tile"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

import {
  type SampleStop,
  configDiff,
  convergence,
  durationMatrix,
  importPreview,
  jobEvents,
  matrixNodes,
  pythonExport,
  runs,
  stops,
  timelineRoutes,
} from "../sample-data"
import { Group, Row, Specimen } from "../specimen"

const col = dataTableColumns<SampleStop>()
const stopColumns = col.columns([
  col.accessor("id", { header: "ID", cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span> }),
  col.accessor("label", { header: "Label" }),
  col.accessor("route", {
    header: "Route",
    cell: ({ getValue }) => {
      const route = getValue()
      return route ? (
        <span className="flex items-center gap-1.5">
          <RouteSwatch route={route} size="sm" /> Route {route}
        </span>
      ) : (
        <span className="text-muted-foreground italic">Unassigned</span>
      )
    },
  }),
  col.accessor("demand", { header: "Demand", cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span> }),
  col.accessor("window", { header: "Window", cell: ({ getValue }) => <span className="font-mono text-xs tabular-nums">{getValue()}</span> }),
  col.accessor("source", { header: "Coordinates", enableGlobalFilter: false, cell: ({ getValue }) => <CoordinateSourceBadge source={getValue()} /> }),
])

export function Lab() {
  const [selectedStop, setSelectedStop] = useState<string | null>("c-05")
  const [activeRoute, setActiveRoute] = useState<number | null>(null)
  const [cursor, setCursor] = useState(9 * 60 + 40)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setCursor((c) => (c >= 14 * 60 ? 8 * 60 : c + 2)), 40)
    return () => clearInterval(id)
  }, [playing])

  return (
    <Group
      id="lab"
      index={3}
      title="Lab components"
      description="Product components built from primitives, in src/components/lab. Each one encodes a rule from the spec: provenance is always visible, estimates are labeled, and one stable ID selects the same thing everywhere."
    >
      <Specimen id="status" title="Status & provenance" source="lab/job-status · lab/provenance-badge · lab/setting-source" spec="§6 §7 §9 §11">
        <div className="space-y-6">
          <Row label="Job states">
            {jobStates.map((s) => (
              <JobStatusBadge key={s} state={s} />
            ))}
          </Row>
          <Row label="Compact dots">
            {jobStates.map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-xs capitalize">
                <JobStatusDot state={s} /> {s}
              </span>
            ))}
          </Row>
          <Row label="Coordinate source">
            <CoordinateSourceBadge source="imported" />
            <CoordinateSourceBadge source="census" />
            <CoordinateSourceBadge source="manual" />
            <CoordinateSourceBadge source="zcta" />
          </Row>
          <Row label="Travel mode">
            <TravelModeBadge mode="haversine" detail="25 mph" />
            <TravelModeBadge mode="osrm" detail="car · TN 2026-09-01" />
            <TravelModeBadge mode="imported" />
          </Row>
          <Row label="Setting source">
            <SettingSourceBadge source="default" />
            <SettingSourceBadge source="workspace" />
            <SettingSourceBadge source="scenario" />
            <SettingSourceBadge source="run" />
            <SettingSourceBadge source="deployment" />
          </Row>
          <Row label="Route swatches & legend">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((r) => (
              <RouteSwatch key={r} route={r} />
            ))}
            <RouteLegend
              routes={[1, 2, 3]}
              active={activeRoute}
              onToggle={(r) => setActiveRoute(activeRoute === r ? null : r)}
              className="ml-4"
            />
          </Row>
          <Row label="Contextual explainer">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              Service duration
              <Explainer
                term="Service duration"
                meaning="How long the vehicle spends at the stop, from arrival (or window open) until it departs."
                units="minutes (stored as seconds)"
                example="A 12-minute unload at c-01"
                field="Client.service_duration"
                docsHref="https://pyvrp.org/api/pyvrp.html"
              />
            </span>
            <span className="flex items-center gap-1.5 text-sm font-medium">
              Time window
              <Explainer
                term="Time window"
                meaning="The earliest and latest times service may begin. Arriving early means waiting; arriving late is infeasible."
                units="local clock time (seconds from midnight)"
                example="08:00–10:00"
                field="Client.tw_early / tw_late"
              />
            </span>
          </Row>
        </div>
      </Specimen>

      <Specimen id="metrics" title="Metric tiles" source="lab/stat-tile" spec="§10" description="Deltas compare against a chosen baseline; the tile decides which direction is good.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Total distance" value="18.7" unit="mi" delta={-6.2} badge={<Badge variant="secondary">Estimated</Badge>} footnote="vs. manual baseline" />
          <StatTile label="Objective" value="$318.20" delta={-4.1} trend={convergence.map((c) => c.seed0)} />
          <StatTile label="Orders fulfilled" value="87" unit="%" delta={3.4} goodWhen="up" footnote="whole orders, by priority" />
          <StatTile
            label="Feasibility"
            value="Feasible"
            badge={<Badge variant="outline">not proven optimal</Badge>}
            footnote="0 penalties · 1 optional skipped"
          />
        </div>
      </Specimen>

      <Specimen
        id="timeline"
        title="Route timeline"
        source="lab/route-timeline"
        spec="§10"
        description="Drive, wait, and service per vehicle with time-window brackets. Click a service block to select the stop; the playback cursor is a simulation, not live tracking."
      >
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button size="icon-sm" variant="outline" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <Slider
            className="w-56"
            min={8 * 60}
            max={14 * 60}
            step={1}
            value={cursor}
            onValueChange={(v) => setCursor(v as number)}
            aria-label="Playback time"
          />
          <span className="font-mono text-xs tabular-nums">{formatClock(cursor)}</span>
          <RouteLegend
            routes={[1, 2, 3]}
            active={activeRoute}
            onToggle={(r) => setActiveRoute(activeRoute === r ? null : r)}
            className="ml-auto"
          />
        </div>
        <RouteTimeline
          routes={timelineRoutes}
          from={7.75 * 60}
          to={14 * 60}
          selectedStop={selectedStop}
          onSelectStop={setSelectedStop}
          activeRoute={activeRoute}
          cursor={cursor}
        />
      </Specimen>

      <Specimen id="table" title="Data table" source="lab/data-table" spec="§2 §4" description="TanStack Table on the shadcn table. Sort, filter, multi-select; clicking a row selects the same stop as the timeline above.">
        <DataTable
          columns={stopColumns}
          data={stops}
          selected={selectedStop}
          onSelectedChange={setSelectedStop}
          filterPlaceholder="Filter stops…"
          className="bg-card"
          toolbar={
            <Select defaultValue="all">
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All routes</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                <SelectItem value="warnings">With warnings</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </Specimen>

      <div className="grid gap-10 xl:grid-cols-2 [&>*]:min-w-0">
        <Specimen id="diagnostics" title="Preflight diagnostics" source="lab/diagnostic-list" spec="§10" description="Only provable issues block a solve.">
          <DiagnosticList
            onSelectRef={setSelectedStop}
            items={[
              { severity: "blocking", title: "Required stop is unreachable", detail: "No road path from Main depot in the OSRM dataset.", refs: ["c-09"] },
              { severity: "blocking", title: "Demand exceeds every vehicle's capacity", detail: "c-07 needs 26 units; largest vehicle holds 24.", refs: ["c-07"] },
              { severity: "warning", title: "2 stops use ZCTA approximate coordinates", refs: ["c-03", "c-08"] },
              { severity: "info", title: "1 optional stop was skipped", detail: "An observed tradeoff: the reward was less than the detour cost." },
            ]}
          />
        </Specimen>

        <Specimen id="matrix" title="Matrix inspector" source="lab/matrix-heatmap" spec="§7" description="Directed durations. Hover a cell for the reverse edge; asymmetry and unreachable edges are explicit.">
          <MatrixHeatmap nodes={matrixNodes} values={durationMatrix} unit="min" />
        </Specimen>
      </div>

      <Specimen id="settings" title="Settings rows" source="lab/setting-source" spec="§11" description="Label, description, where the value comes from, and reset-to-inherited.">
        <div className="bg-card divide-y rounded-xl border px-4">
          <SettingRow label="Estimated speed" description="Used to turn Haversine distances into durations." source="workspace">
            <InputGroup className="w-28">
              <InputGroupInput defaultValue={25} type="number" />
              <InputGroupAddon align="inline-end">
                <InputGroupText>mph</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
          </SettingRow>
          <SettingRow label="Search time" description="Solver budget per run. Time limits do not reproduce across machines." source="scenario">
            <Select defaultValue="120">
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 s</SelectItem>
                <SelectItem value="30">30 s</SelectItem>
                <SelectItem value="120">120 s</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow label="Solver seed" source="run">
            <Input className="w-28 font-mono" defaultValue={3} />
          </SettingRow>
          <SettingRow label="ZIP fallback" description="Allow ZCTA approximate coordinates with a review warning." source="default">
            <Switch defaultChecked />
          </SettingRow>
          <SettingRow label="Wall-clock hard limit" description="Bounds every resolved budget. Set by SOLVE_HARD_LIMIT_SECONDS." source="deployment">
            <span className="text-muted-foreground w-28 font-mono text-sm">300 s</span>
          </SettingRow>
        </div>
      </Specimen>

      <Specimen id="imports" title="Imports" source="lab/import-dropzone" spec="§6" description="Drop target, then a non-destructive preview with column mapping and row-level validation.">
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <ImportDropzone className="bg-background" />
          <div className="bg-background overflow-x-auto rounded-xl border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="w-8" />
                  {importPreview.columns.map((c, i) => (
                    <th key={c} className="px-3 py-2 text-left align-top font-normal">
                      <div className="font-mono font-medium">{c}</div>
                      <div className="text-muted-foreground mt-1 flex items-center gap-1 whitespace-nowrap">
                        <ArrowRight className="size-3" />
                        {importPreview.mapping[i]}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {importPreview.rows.map((row, i) => {
                  const issue = importPreview.issues[i]
                  return (
                    <tr key={i} className={cn("border-b last:border-0", issue && "bg-destructive/5")}>
                      <td className="text-muted-foreground pl-3 font-mono tabular-nums">{i + 1}</td>
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-1.5 font-mono whitespace-nowrap">
                          {cell}
                        </td>
                      ))}
                      {issue && <td className="text-destructive pr-3 whitespace-nowrap">{issue}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="text-muted-foreground flex items-center gap-3 border-t px-3 py-2 text-xs">
              <span>
                <span className="text-foreground font-medium">2</span> valid · <span className="text-destructive font-medium">2</span> need attention
              </span>
              <Button size="xs" className="ml-auto" disabled>
                Import 2 rows
              </Button>
            </div>
          </div>
        </div>
      </Specimen>

      <Specimen id="runs" title="Runs & jobs" spec="§9" description="Run list with durable job states, and the live job panel with coarse persisted progress events.">
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <ul className="bg-card divide-y rounded-xl border">
            {runs.map((r) => (
              <li key={r.id} className="hover:bg-muted/40 flex items-center gap-3 px-4 py-2.5 text-sm transition-colors">
                <JobStatusDot state={r.state} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.label}</div>
                  <div className="text-muted-foreground font-mono text-[11px]">
                    {r.id} · seed {r.seed} · {r.budget}
                  </div>
                </div>
                {r.state === "running" && <Progress value={r.progress ?? null} className="w-24" />}
                {r.cost && <span className="font-mono text-xs tabular-nums">{r.cost}</span>}
                <span className="text-muted-foreground w-20 text-right text-xs">{r.finished ?? ""}</span>
                <JobStatusBadge state={r.state} className="hidden w-28 justify-center sm:inline-flex" />
              </li>
            ))}
          </ul>

          <div className="bg-card flex flex-col rounded-xl border">
            <div className="flex items-center gap-2 border-b p-3">
              <JobStatusBadge state="running" />
              <span className="font-mono text-xs">run-0143</span>
              <Button size="xs" variant="outline" className="ml-auto">
                <Square /> Cancel
              </Button>
            </div>
            <div className="space-y-2 p-3">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Search budget</span>
                <span className="font-mono tabular-nums">18.6 / 30 s</span>
              </div>
              <Progress value={62} />
            </div>
            <ol className="text-muted-foreground relative flex-1 space-y-2 border-t p-3 font-mono text-[11px]">
              {jobEvents.map((e, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-foreground/60 tabular-nums">{e.at}</span>
                  <span className={cn(i === jobEvents.length - 1 && "text-foreground")}>{e.text}</span>
                </li>
              ))}
            </ol>
            <div className="text-muted-foreground flex items-center gap-2 border-t p-3 text-xs">
              <RotateCcw className="size-3" /> Attempt 1 of 3 · lease renews every 10 s
            </div>
          </div>
        </div>
      </Specimen>

      <Specimen id="compare" title="Comparison" source="lab/config-diff" spec="§10" description="What changed between two runs. Incompatible objectives or matrices are called out, not ranked.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="bg-background flex items-center gap-2 rounded-lg border px-2.5 py-1">
              <RouteSwatch route={1} size="sm" /> run-0142
            </span>
            <ArrowRight className="text-muted-foreground size-4" />
            <span className="bg-background flex items-center gap-2 rounded-lg border px-2.5 py-1">
              <RouteSwatch route={5} size="sm" /> run-0151
            </span>
            <Badge variant="outline" className="border-route-4/50 text-route-4 ml-auto">
              Allocation differs · objective scores not directly comparable
            </Badge>
          </div>
          <ConfigDiff rows={configDiff} labels={["run-0142 · seed 0", "run-0151 · 2 vans"]} className="bg-background" />
        </div>
      </Specimen>

      <Specimen id="exports" title="Exports" source="lab/code-block" spec="§13" description="Python reproduction bundle preview. Runs without web credentials.">
        <CodeBlock code={pythonExport} filename="reproduce/model.py" className="bg-background" />
      </Specimen>
    </Group>
  )
}
