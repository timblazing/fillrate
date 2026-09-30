"use client"

import { Pause, Play } from "lucide-react"
import { useEffect, useState } from "react"

import { EditSession, type EditEvaluation } from "@/components/lab/edit-session"
import { MatrixHeatmap } from "@/components/lab/matrix-heatmap"
import { RouteLegend, TruckTag } from "@/components/lab/route-swatch"
import { RouteTimeline, formatClock } from "@/components/lab/route-timeline"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { TRAILER_CAPACITY } from "@/lib/units"

import { baseline, depot, lookups } from "../fixtures"
import { haversineMiles } from "../fixtures/pipeline"
import { timelineRoutes, timelineUnassigned } from "../sample-data"
import { Group, Specimen } from "../specimen"

// Components for the general PyVRP lessons (time windows, road matrices). Kept current, but secondary to the pipeline.
export function Later() {
  const run = baseline()
  const look = lookups(run)
  const [selectedStop, setSelectedStop] = useState<string | null>("c-05")
  const [activeRoute, setActiveRoute] = useState<number | null>(null)
  const [cursor, setCursor] = useState(9 * 60 + 40)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setCursor((c) => (c >= 14 * 60 ? 8 * 60 : c + 2)), 40)
    return () => clearInterval(id)
  }, [playing])

  // Solver-mile matrix for one truck's depot + stops, plus one far stop; legs over the limit are prohibited.
  const truck = run.trucks.find((t) => t.cluster === 6 && t.stops.length >= 5) ?? run.trucks[0]
  const far = run.stops.find((s) => s.depotMiles > run.settings.maxLegMiles)!
  const nodes = [
    { id: "D", lat: depot.latitude, lon: depot.longitude },
    ...truck.stops.slice(0, 6).map((id) => {
      const s = look.stops.get(id)!
      return { id: s.id.replace("S-", ""), lat: s.latitude, lon: s.longitude }
    }),
    { id: far.id.replace("S-", ""), lat: far.latitude, lon: far.longitude },
  ]
  const matrix = nodes.map((a) =>
    nodes.map((b) => {
      const mi = Math.round(haversineMiles([a.lat, a.lon], [b.lat, b.lon]) * run.settings.circuity)
      return mi > run.settings.maxLegMiles ? null : mi
    })
  )

  // A manual edit on a working copy: move the emptiest truck's stops onto the cluster truck that ends up fullest
  // without going over capacity, then drop the empty truck.
  const cluster3 = run.trucks.filter((t) => t.cluster === 3)
  const emptiest = [...cluster3].sort((a, b) => a.fill - b.fill)[0]
  const target = cluster3
    .filter((t) => t !== emptiest && t.load + emptiest.load <= TRAILER_CAPACITY)
    .sort((a, b) => b.load - a.load)[0]
  const moved = emptiest.stops.map((id) => look.stops.get(id)!)
  const last = look.stops.get(target.stops[target.stops.length - 1])!
  let extra = 0
  let prev: [number, number] = [last.latitude, last.longitude]
  for (const m of moved) {
    extra += haversineMiles(prev, [m.latitude, m.longitude]) * run.settings.circuity
    prev = [m.latitude, m.longitude]
  }
  const legOk = extra <= run.settings.maxLegMiles
  const edit: EditEvaluation = {
    violations: legOk ? [] : [`New leg into ${moved[0].id} is ${Math.round(extra)} mi, over the ${run.settings.maxLegMiles} mi limit`],
    trucks: { before: run.metrics.trucks, after: run.metrics.trucks - 1 },
    loadedMiles: { before: run.metrics.loadedMiles, after: run.metrics.loadedMiles - emptiest.loadedMiles + extra },
    affected: [
      { id: emptiest.id, cluster: 3, before: emptiest.fill, after: null },
      { id: target.id, cluster: 3, before: target.fill, after: (target.load + emptiest.load) / TRAILER_CAPACITY },
    ],
  }
  const editChanges = [
    ...moved.map((m) => ({
      id: m.id,
      text: (
        <span className="flex flex-wrap items-center gap-1.5">
          Moved <span className="font-mono">{m.id}</span> <span className="text-muted-foreground">({m.label}, {m.city})</span> from
          <TruckTag id={emptiest.id} cluster={3} /> to <TruckTag id={target.id} cluster={3} /> as its last visit
        </span>
      ),
    })),
    {
      id: "drop",
      text: (
        <span className="flex flex-wrap items-center gap-1.5">
          Removed <TruckTag id={emptiest.id} cluster={3} /> (now empty)
        </span>
      ),
    },
  ]

  return (
    <Group
      id="later"
      index={7}
      title="Later milestones"
      description="General PyVRP components for M6–M7 lessons (time windows, road matrices). The primary pipeline has open routes and no time windows, so these are secondary."
    >
      <Specimen
        id="timeline"
        title="Route timeline"
        description="Drive, wait, and service per vehicle with time-window brackets, for time-window lessons. Service blocks carry their visit number, long waits are labeled, and visits no route could take sit in an Unassigned pool. The playback cursor is a simulation, not live tracking."
      >
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button size="icon-sm" variant="outline" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause /> : <Play />}
          </Button>
          <Slider className="w-56" min={8 * 60} max={14 * 60} step={1} value={cursor} onValueChange={(v) => setCursor(v as number)} aria-label="Playback time" />
          <span className="font-mono text-xs tabular-nums">{formatClock(cursor)}</span>
          <RouteLegend routes={[1, 2, 3]} active={activeRoute} onToggle={(r) => setActiveRoute(activeRoute === r ? null : r)} className="ml-auto" />
        </div>
        <RouteTimeline
          routes={timelineRoutes}
          from={7.75 * 60}
          to={14 * 60}
          selectedStop={selectedStop}
          onSelectStop={setSelectedStop}
          activeRoute={activeRoute}
          cursor={cursor}
          unassigned={timelineUnassigned}
        />
      </Specimen>

      <Specimen
        id="matrix"
        title="Matrix inspector"
        description={`Solver miles (haversine × ${run.settings.circuity}) for ${truck.id}'s stops plus one far stop. Legs over ${run.settings.maxLegMiles} mi are prohibited before PyVRP sees the matrix (∞).`}
      >
        <MatrixHeatmap nodes={nodes.map((n) => n.id)} values={matrix} unit="mi" unreachableLabel={`prohibited: over the ${run.settings.maxLegMiles} mi leg limit`} className="max-w-3xl" />
      </Specimen>

      <Specimen
        id="edit-session"
        title="Edit working copy"
        description="Manual plan edits collect on a copy of the run. Evaluate re-validates the copy with the same matrix and limits and shows what changed; only then can it be saved as a manual baseline. Discard leaves the run untouched."
      >
        <EditSession runId="run-0212" changes={editChanges} evaluation={edit} className="max-w-3xl" />
      </Specimen>
    </Group>
  )
}
