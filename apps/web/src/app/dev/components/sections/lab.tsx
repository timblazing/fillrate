"use client"

import { ArrowRight, Play, RotateCcw, Square } from "lucide-react"
import { useMemo, useState } from "react"

import { ClusterCard } from "@/components/lab/cluster-card"
import { CodeBlock } from "@/components/lab/code-block"
import { ConfigDiff } from "@/components/lab/config-diff"
import { DataTable } from "@/components/lab/data-table"
import { DiagnosticList } from "@/components/lab/diagnostic-list"
import { Explainer } from "@/components/lab/explainer"
import { ImportDropzone } from "@/components/lab/import-dropzone"
import { IterationTable } from "@/components/lab/iteration-table"
import { JobStatusBadge, JobStatusDot, jobStates } from "@/components/lab/job-status"
import { LineStateBadge, type LineState, lineStates } from "@/components/lab/line-state"
import { PipelineStages } from "@/components/lab/pipeline-stages"
import { CoordinateSourceBadge, TravelModeBadge } from "@/components/lab/provenance-badge"
import { ClusterLegend, ClusterSwatch, TruckTag } from "@/components/lab/route-swatch"
import { RunMetricGroups } from "@/components/lab/run-metrics"
import { SettingRow, SettingSourceBadge } from "@/components/lab/setting-source"
import { StockTable } from "@/components/lab/stock-table"
import { FillMeter, FillPercent, TrailerFill } from "@/components/lab/trailer-fill"
import { TruckLoad } from "@/components/lab/truck-load"
import { UnshippedLines } from "@/components/lab/unshipped-lines"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from "@/components/ui/number-field"
import { Progress } from "@/components/ui/progress"
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatCount, formatMiles } from "@/lib/units"
import { cn } from "@/lib/utils"

import { baseline, depot, iterations, lookups, stockRows } from "../fixtures"
import { orderRows } from "../fixtures/order-rows"
import { useSimulatedRun } from "../fixtures/stages"
import { orderColumns } from "../order-columns"
import { Group, Row, Specimen } from "../specimen"
import { configDiffRows, importPreview, lineFilterItems, pythonExport, runEvents, strategyItems } from "./lab-data"

export function Lab() {
  const run = baseline()
  const look = lookups(run)
  const sweep = iterations()
  const [cluster, setCluster] = useState<number>(3)
  const [stop, setStop] = useState<string | null>(null)
  const [lineFilter, setLineFilter] = useState<LineState | "all">("all")
  const [compare, setCompare] = useState<string[]>(["run-0212", "run-0214"])
  const live = useSimulatedRun(run)

  const clusterTrucks = run.trucks.filter((t) => t.cluster === cluster)
  const byFill = run.trucks.filter((t) => t.stops.length >= 3).sort((a, b) => b.fill - a.fill)
  const fillExamples = [byFill[0], byFill[Math.floor(byFill.length / 2)], byFill[byFill.length - 1]]
  const splitStop = run.stops.find((s) => s.split?.index === 1 && s.truck)
  const splitTruck = splitStop ? look.trucks.get(splitStop.truck!) : undefined
  const loadExamples = [...clusterTrucks].sort((a, b) => b.fill - a.fill)
  const rows = orderRows(run)
  const filteredRows = useMemo(() => (lineFilter === "all" ? rows : rows.filter((r) => r.state === lineFilter)), [rows, lineFilter])
  const beyond = run.stops.filter((s) => s.depotMiles > run.settings.maxLegMiles)
  const zcta = run.stops.filter((s) => look.locations.get(s.locationId)?.source === "zcta")
  const unresolved = new Set(run.unshipped.filter((u) => u.reason === "data-quality").map((u) => u.locationId))
  const k8 = sweep.find((r) => r.id === "run-0214")!

  return (
    <Group
      id="lab"
      index={3}
      title="Fulfillment components"
      description="Product components in src/components/lab, shown with one synthetic 2,000-order run (Memphis DC, six SKUs, scarce stock) so every number agrees across specimens. The fixture follows spec §8/§8a; PyVRP is stood in for by a sweep heuristic until the optimizer exists."
    >
      <Specimen id="status" title="Status & provenance" source="lab/job-status · lab/provenance-badge · lab/route-swatch · lab/explainer" spec="§4 §6 §7 §9 §11">
        <div className="space-y-6">
          <Row label="Job states">
            {jobStates.map((s) => (
              <JobStatusBadge key={s} state={s} />
            ))}
          </Row>
          <Row label="Order line states">
            {lineStates.map((s) => (
              <LineStateBadge key={s} state={s} />
            ))}
          </Row>
          <Row label="Coordinate source">
            {(["imported", "census", "manual", "zcta", "unresolved"] as const).map((s) => (
              <CoordinateSourceBadge key={s} source={s} />
            ))}
          </Row>
          <Row label="Travel mode">
            <TravelModeBadge mode="haversine" detail="× 1.2 circuity" />
            <TravelModeBadge mode="osrm" detail="car · TN 2026-09-01" />
            <TravelModeBadge mode="imported" />
          </Row>
          <Row label="Setting source">
            {(["default", "workspace", "scenario", "run", "deployment"] as const).map((s) => (
              <SettingSourceBadge key={s} source={s} />
            ))}
          </Row>
          <Row label="Clusters & trucks">
            <ClusterLegend clusters={run.clusters.map((c) => c.id)} active={cluster} onToggle={setCluster} />
            <span className="text-muted-foreground mx-2">·</span>
            {clusterTrucks.slice(0, 4).map((t) => (
              <TruckTag key={t.id} id={t.id} cluster={t.cluster} />
            ))}
          </Row>
          <Row label="Contextual explainers">
            {[
              {
                term: "Circuity factor",
                meaning: "Straight-line (haversine) miles are multiplied by this to approximate road miles. The leg and diameter limits use the multiplied miles.",
                units: "unitless multiplier",
                example: "Memphis → Nashville: 200 mi × 1.2 = 240 solver mi",
                field: "travel.circuity_factor",
              },
              {
                term: "Linear feet",
                meaning: "Trailer floor length a load takes up. It is the only capacity dimension for 53 ft trailers.",
                units: "feet (stored as hundredths)",
                example: "3 vanities × 0.6 ft = 1.8 ft",
                field: "OrderLine.lf_per_piece · VehicleType.capacity",
              },
              {
                term: "Maximum leg",
                meaning: "No truck may drive further than this between consecutive stops, or from the depot to its first stop. Longer legs are removed from the matrix PyVRP sees.",
                units: "solver miles",
                example: "Memphis DC → Houston: 582 mi, so Houston stops are not loaded",
                field: "travel.max_leg_miles (preprocessing)",
              },
              {
                term: "Assignment confidence",
                meaning: "Across k-means seeds, how often this stop lands with the same neighbors. Low values are border stops that switch clusters from seed to seed.",
                units: "0–100%",
                example: "94%: the stop always groups with the Nashville stops",
                field: "k explorer (descriptive, not a solver input)",
              },
            ].map((e) => (
              <span key={e.term} className="flex items-center gap-1.5 text-sm font-medium">
                {e.term}
                <Explainer {...e} />
              </span>
            ))}
          </Row>
        </div>
      </Specimen>

      <Specimen
        id="fill"
        title="Truck fill"
        source="lab/trailer-fill"
        spec="§1 §8a"
        description="A 53 ft trailer drawn to scale: one segment per stop in visit order, hatching is empty floor. Under 60% is flagged; 85% and up reads as full. These are the fullest, median, and emptiest trucks of the run."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
          <div className="space-y-5">
            {fillExamples.map((t) => (
              <div key={t.id} className="space-y-1.5">
                <div className="flex items-center gap-3 text-sm">
                  <TruckTag id={t.id} cluster={t.cluster} />
                  <span className="text-muted-foreground text-xs">
                    {t.stops.length} stops · {formatMiles(t.loadedMiles)} loaded
                  </span>
                </div>
                <TrailerFill
                  cluster={t.cluster}
                  segments={t.stops.map((id) => {
                    const s = look.stops.get(id)!
                    return { id, load: s.load, label: `${s.label} · ${s.city}` }
                  })}
                />
              </div>
            ))}
            {splitStop && splitTruck && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-3 text-sm">
                  <TruckTag id={splitTruck.id} cluster={splitTruck.cluster} />
                  <Badge variant="outline" size="sm">
                    split stop · visit 1/{splitStop.split!.of}
                  </Badge>
                </div>
                <TrailerFill
                  cluster={splitTruck.cluster}
                  selected={splitStop.id}
                  segments={splitTruck.stops.map((id) => {
                    const s = look.stops.get(id)!
                    return { id, load: s.load, label: `${s.label} · ${s.city}` }
                  })}
                />
              </div>
            )}
          </div>
          <div className="bg-background space-y-3 rounded-xl border p-4">
            <div className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">Inline</div>
            {fillExamples.map((t) => (
              <div key={t.id} className="flex items-center gap-3 text-xs">
                <span className="w-14 font-mono">{t.id}</span>
                <FillMeter fill={t.fill} className="flex-1" />
              </div>
            ))}
            <div className="flex items-center gap-3 text-xs">
              <span className="w-14 font-mono">{fillExamples[0].id}</span>
              <FillMeter fill={fillExamples[0].fill} cluster={fillExamples[0].cluster} className="flex-1" />
            </div>
            <div className="flex gap-4 pt-1 text-2xl tracking-tight">
              <FillPercent fill={0.93} />
              <FillPercent fill={0.74} />
              <FillPercent fill={0.41} />
            </div>
          </div>
        </div>
      </Specimen>

      <Specimen
        id="stages"
        title="Pipeline stages"
        source="lab/pipeline-stages"
        spec="§8a §9"
        description="One run, six stored stages. Solve fans out into one durable PyVRP job per cluster. Press Run to watch the live states; real runs poll persisted job state every ~2 s."
      >
        <div className="bg-background space-y-5 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <JobStatusBadge state={live.running ? "running" : "succeeded"} />
            <span className="font-mono text-xs">run-0212</span>
            <span className="text-muted-foreground text-xs">k auto · seed 0 · 10 s per cluster</span>
            <div className="ml-auto flex items-center gap-2">
              {live.running && <Progress value={Math.round(live.progress * 100)} className="w-32" />}
              <Button size="sm" variant={live.running ? "outline" : "default"} onClick={live.running ? live.reset : live.start}>
                {live.running ? <Square /> : <Play />} {live.running ? "Cancel" : "Run pipeline"}
              </Button>
            </div>
          </div>
          <PipelineStages stages={live.stages} />
        </div>
      </Specimen>

      <Specimen
        id="run-metrics"
        title="Run metrics"
        source="lab/run-metrics"
        spec="§8a §10"
        description="The three metric groups, side by side with no composite score. Here run-0214 (k = 8) against the baseline (auto k = 6)."
      >
        <RunMetricGroups metrics={k8.metrics} baseline={run.metrics} maxDiameter={run.settings.maxDiameterMiles} />
      </Specimen>

      <Specimen
        id="cluster-cards"
        title="Cluster cards"
        source="lab/cluster-card"
        spec="§10"
        description="Per cluster: stops, trucks, loaded feet, fill, revenue, one bar per truck (amber = under 60%), and widest pair against the 500 mi limit. Click to select."
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {run.clusters.map((c) => (
            <ClusterCard
              key={c.id}
              cluster={c}
              trucks={run.trucks.filter((t) => t.cluster === c.id)}
              area={look.clusterArea(c.id)}
              maxDiameter={run.settings.maxDiameterMiles}
              selected={cluster === c.id}
              onSelect={() => setCluster(c.id)}
            />
          ))}
        </div>
      </Specimen>

      <Specimen
        id="truck-loads"
        title="Truck loads"
        source="lab/truck-load"
        spec="§10"
        description={`Stop sequence with leg miles and the order lines on board. Open route from ${depot.label}. Cluster ${cluster}'s fullest and emptiest trucks; select a cluster card above to switch.`}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {[loadExamples[0], loadExamples[loadExamples.length - 1]].map((t, i) => (
            <TruckLoad
              key={t.id}
              truck={t}
              stops={look.stops}
              lines={look.lines}
              products={look.products}
              depotLabel={depot.label}
              maxLeg={run.settings.maxLegMiles}
              selectedStop={stop}
              onSelectStop={setStop}
              defaultExpanded={i === 0 ? t.stops[0] : undefined}
            />
          ))}
        </div>
      </Specimen>

      <Specimen
        id="unshipped"
        title="Unshipped lines"
        source="lab/unshipped-lines"
        spec="§10"
        description="Every line that does not ship, with its reason: no stock (and who took it), beyond the leg limit, did not fit, or excluded for data quality. Click a reason to filter."
      >
        <UnshippedLines items={run.unshipped} products={look.products} locations={look.locations} />
      </Specimen>

      <Specimen id="stock" title="Inventory coverage" source="lab/stock-table" spec="§8" description="Stock against open demand per SKU. The notch is 100% coverage.">
        <StockTable rows={stockRows(run)} />
      </Specimen>

      <Specimen
        id="orders"
        title="Order lines table"
        source="lab/data-table · lab/line-state"
        spec="§4 §5"
        description={`All ${formatCount(rows.length)} lines of ${formatCount(2000)} orders, paginated. Pieces show allocated/ordered; the state says where each line ended up.`}
      >
        <DataTable
          columns={orderColumns}
          data={filteredRows}
          pageSize={12}
          filterPlaceholder="Line, account, product…"
          className="bg-card"
          toolbar={
            <Select value={lineFilter} onValueChange={(v) => setLineFilter(v as LineState | "all")} items={lineFilterItems}>
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {lineFilterItems.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </Specimen>

      <Specimen
        id="iterations"
        title="Iteration table"
        source="lab/iteration-table"
        spec="§8a §10"
        description="One row per run, grouped by the three metrics, with the varied settings as chips. ★ = non-dominated; underline = best in column. Tick two runs to compare."
      >
        <IterationTable rows={sweep} baselineId="run-0212" selected={compare} onSelectedChange={setCompare} />
      </Specimen>

      <div className="grid gap-10 xl:grid-cols-2 [&>*]:min-w-0">
        <Specimen id="diagnostics" title="Preflight checks" source="lab/diagnostic-list" spec="§6 §8a §10" description="Computed from this scenario before a run. Only provable problems block.">
          <DiagnosticList
            items={[
              {
                severity: "warning",
                title: `${beyond.length} stops are beyond the ${run.settings.maxLegMiles} mi leg limit`,
                detail: `Nearest-first legs from ${depot.label} exceed the limit, so these stops will be allocated but not loaded.`,
                refs: beyond.slice(0, 4).map((s) => s.id),
              },
              {
                severity: "warning",
                title: `${unresolved.size} accounts have no coordinates`,
                detail: "PO-box-only ZIPs have no ZCTA. Their lines are excluded until placed on the map.",
              },
              {
                severity: "warning",
                title: `${zcta.length} stops use ZCTA approximate coordinates`,
                refs: zcta.slice(0, 3).map((s) => s.id),
              },
              {
                severity: "info",
                title: `${run.splits.length} stops exceed one trailer and will be split`,
                refs: run.splits.slice(0, 3).map((s) => s.stop),
              },
            ]}
          />
          <div className="text-muted-foreground mt-4 mb-2 text-[11px] font-medium tracking-wider uppercase">Blocked scenario</div>
          <DiagnosticList
            items={[
              {
                severity: "blocking",
                title: "Trailer capacity is 0 ft",
                detail: "Fleet → 53 ft trailer has no linear-feet capacity, so no stop can be loaded.",
              },
            ]}
          />
        </Specimen>

        <Specimen id="settings" title="Settings rows" source="lab/setting-source" spec="§11" description="Label, meaning, where the value comes from, and reset to inherited.">
          <div className="bg-card divide-y rounded-xl border px-4">
            <SettingRow label="Circuity factor" description="Haversine miles × this factor. The primary user's mileage cushion." source="workspace">
              <NumberField defaultValue={1.2} step={0.05} min={1} max={2} className="w-28">
                <NumberFieldGroup>
                  <NumberFieldDecrement />
                  <NumberFieldInput />
                  <NumberFieldIncrement />
                </NumberFieldGroup>
              </NumberField>
            </SettingRow>
            <SettingRow label="Maximum leg" description="Between consecutive stops and from the depot, in solver miles." source="default">
              <InputGroup className="w-28">
                <InputGroupInput defaultValue={500} type="number" />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>mi</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </SettingRow>
            <SettingRow label="Cluster count (k)" description="Auto picks the smallest k whose clusters all pass the diameter check." source="scenario">
              <ToggleGroup defaultValue={["7"]} variant="outline" size="sm">
                <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
                <ToggleGroupItem value="7">k = 7</ToggleGroupItem>
              </ToggleGroup>
            </SettingRow>
            <SettingRow label="Allocation strategy" description="Order date first, then net value per piece." source="default">
              <Select defaultValue="date-value" items={strategyItems}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {strategyItems.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </SettingRow>
            <SettingRow label="ZIP fallback" description="Allow ZCTA approximate coordinates with a review warning." source="default">
              <Switch defaultChecked />
            </SettingRow>
            <SettingRow label="Stops per cluster solve" description="MAX_STOPS. Bounds every cluster PyVRP solves." source="deployment">
              <span className="text-muted-foreground w-28 font-mono text-sm">500</span>
            </SettingRow>
          </div>
        </Specimen>
      </div>

      <Specimen id="imports" title="Imports" source="lab/import-dropzone" spec="§6" description="Order-lines CSV: drop, map columns to canonical fields, and fix row errors before anything is saved.">
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-3">
            <ImportDropzone className="bg-background" accept=".csv" />
            <div className="text-muted-foreground flex items-center justify-between px-1 text-xs">
              <span>Templates</span>
              <span className="flex gap-3">
                <a href="#imports" className="text-foreground underline underline-offset-4">
                  order-lines.csv
                </a>
                <a href="#imports" className="text-foreground underline underline-offset-4">
                  inventory.csv
                </a>
              </span>
            </div>
          </div>
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
                      <td className="text-muted-foreground pl-3 font-mono tabular-nums">{i + 2}</td>
                      {row.map((cell, j) => (
                        <td key={j} className={cn("px-3 py-1.5 font-mono whitespace-nowrap", issue?.cols.includes(j) && "text-destructive-foreground font-medium")}>
                          {cell}
                        </td>
                      ))}
                      {issue && <td className="text-destructive-foreground pr-3 whitespace-nowrap">{issue.text}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="text-muted-foreground flex items-center gap-3 border-t px-3 py-2 text-xs">
              <span>
                <span className="text-foreground font-medium">2,826</span> valid · <span className="text-destructive-foreground font-medium">3</span> need attention ·
                1,996 orders · 640 accounts
              </span>
              <Button size="xs" className="ml-auto" disabled>
                Import 2,826 lines
              </Button>
            </div>
          </div>
        </div>
      </Specimen>

      <Specimen id="runs" title="Runs & jobs" spec="§9" description="A sweep in progress and the job panel for one cluster solve. Progress events are coarse and persisted, never per-iteration.">
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <ul className="bg-card divide-y rounded-xl border">
            {[
              ...sweep.slice(-4).map((r) => ({ id: r.id, label: r.label, state: r.state, meta: `k ${r.metrics.k} · ${r.metrics.trucks} trucks`, finished: r.finished })),
              { id: "run-0221", label: "Inventory 90%", state: "running" as const, meta: "cluster 4 of 6", finished: "", progress: 58 },
              { id: "run-0222", label: "k = 9", state: "queued" as const, meta: "waiting for worker", finished: "" },
              { id: "run-0198", label: "Circuity 1.1", state: "failed" as const, meta: "cluster 5 solve exceeded 300 s", finished: "yesterday" },
            ].map((r) => (
              <li key={r.id} className="hover:bg-muted/40 flex items-center gap-3 px-4 py-2.5 text-sm transition-colors">
                <JobStatusDot state={r.state} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.label}</div>
                  <div className="text-muted-foreground font-mono text-[11px]">
                    {r.id} · {r.meta}
                  </div>
                </div>
                {"progress" in r && <Progress value={r.progress} className="w-24" />}
                <span className="text-muted-foreground w-20 text-right text-xs">{r.finished}</span>
                <JobStatusBadge state={r.state} className="hidden w-28 justify-center sm:inline-flex" />
              </li>
            ))}
          </ul>

          <div className="bg-card flex flex-col rounded-xl border">
            <div className="flex items-center gap-2 border-b p-3">
              <JobStatusBadge state="running" />
              <ClusterSwatch cluster={4} size="sm" />
              <span className="font-mono text-xs">run-0221 · solve C4</span>
              <Button size="xs" variant="outline" className="ml-auto">
                <Square /> Cancel run
              </Button>
            </div>
            <div className="space-y-2 p-3">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Search budget</span>
                <span className="font-mono tabular-nums">6.2 / 10 s</span>
              </div>
              <Progress value={62} />
            </div>
            <ol className="text-muted-foreground relative flex-1 space-y-2 border-t p-3 font-mono text-[11px]">
              {runEvents.map((e, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-foreground/60 tabular-nums">{e.at}</span>
                  <span className={cn(i === runEvents.length - 1 && "text-foreground")}>{e.text}</span>
                </li>
              ))}
            </ol>
            <div className="text-muted-foreground flex items-center gap-2 border-t p-3 text-xs">
              <RotateCcw className="size-3" /> Attempt 1 of 3 · lease renews every 10 s
            </div>
          </div>
        </div>
      </Specimen>

      <Specimen id="compare" title="Run diff" source="lab/config-diff" spec="§10" description="What changed between the two ticked runs in the iteration table. Same scenario version and matrix, so metrics compare directly.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="bg-background rounded-lg border px-2.5 py-1 font-mono text-xs">run-0212 · baseline</span>
            <ArrowRight className="text-muted-foreground size-4" />
            <span className="bg-background rounded-lg border px-2.5 py-1 font-mono text-xs">run-0214 · k = 8</span>
            <Badge variant="success" className="ml-auto">
              Same scenario v14 · same matrix
            </Badge>
          </div>
          <ConfigDiff rows={configDiffRows} labels={["run-0212", "run-0214"]} className="bg-background" />
        </div>
      </Specimen>

      <Specimen id="exports" title="Exports" source="lab/code-block" spec="§13" description="Python reproduction bundle preview: the whole pipeline, runnable without the web app.">
        <CodeBlock code={pythonExport} filename="run-0214/reproduce.py" className="bg-background" />
      </Specimen>
    </Group>
  )
}
