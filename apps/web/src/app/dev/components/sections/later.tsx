"use client"

import { Pause, Play } from "lucide-react"
import { useEffect, useState } from "react"

import { MatrixHeatmap } from "@/components/lab/matrix-heatmap"
import { RouteLegend } from "@/components/lab/route-swatch"
import { RouteTimeline, formatClock } from "@/components/lab/route-timeline"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

import { baseline, depot, lookups } from "../fixtures"
import { haversineMiles } from "../fixtures/pipeline"
import { timelineRoutes } from "../sample-data"
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
        description="Drive, wait, and service per vehicle with time-window brackets, for time-window lessons. The playback cursor is a simulation, not live tracking."
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
        />
      </Specimen>

      <Specimen
        id="matrix"
        title="Matrix inspector"
        description={`Solver miles (haversine × ${run.settings.circuity}) for ${truck.id}'s stops plus one far stop. Legs over ${run.settings.maxLegMiles} mi are prohibited before PyVRP sees the matrix (∞).`}
      >
        <MatrixHeatmap nodes={nodes.map((n) => n.id)} values={matrix} unit="mi" className="max-w-3xl" />
      </Specimen>
    </Group>
  )
}
