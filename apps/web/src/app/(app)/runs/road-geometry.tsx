"use client"

import { Route } from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import type { RunSummary } from "@fillrate/contracts"
import { fetchRoadPath, type LonLat, ROAD_COPY, ROAD_CREDIT, type RoadPath, routeStops } from "@/lib/road-geometry"

export type RoadGeometry = {
  paths: Record<string, RoadPath>
  /** Shipments whose road lines are drawn (fetched and not hidden). */
  shown: Set<string>
  busy: string | null
  error: string | null
  /** Fetches the road path for a shipment on first use (depot first, then stops in route order); later calls show or hide it. */
  toggle: (truckId: string, stops: LonLat[]) => void
}

/** Road paths fetched on demand from the public Valhalla server, kept in memory only. One request batch per click. */
export function useRoadGeometry(): RoadGeometry {
  const [paths, setPaths] = useState<Record<string, RoadPath>>({})
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const toggle = useCallback(
    async (truckId: string, stops: LonLat[]) => {
      setError(null)
      if (paths[truckId]) {
        setHidden((h) => {
          const next = new Set(h)
          if (!next.delete(truckId)) next.add(truckId)
          return next
        })
        return
      }
      if (inFlight.current) return
      inFlight.current = true
      setBusy(truckId)
      try {
        const path = await fetchRoadPath(stops)
        setPaths((p) => ({ ...p, [truckId]: path }))
        setHidden((h) => {
          const next = new Set(h)
          next.delete(truckId)
          return next
        })
      } catch (e) {
        setError(e instanceof Error && e.message ? e.message : "Could not reach the Valhalla server.")
      }
      inFlight.current = false
      setBusy(null)
    },
    [paths],
  )

  const shown = useMemo(() => new Set(Object.keys(paths).filter((id) => !hidden.has(id))), [paths, hidden])
  return { paths, shown, busy, error, toggle }
}

/** The "Show road path" action for one selected shipment, with road miles beside the estimate. */
export function RoadGeometryControl({ geo, summary, truckId }: { geo: RoadGeometry; summary: RunSummary; truckId: string | null }) {
  const stops = useMemo(() => routeStops(summary, truckId), [summary, truckId])
  const truck = summary.trucks.find((t) => t.id === truckId)
  const estimateMiles = truck ? truck.distance_m / 1609.344 : null
  const path = truckId ? geo.paths[truckId] : undefined
  const visible = !!truckId && geo.shown.has(truckId)
  const busy = !!truckId && geo.busy === truckId
  return (
    <div className="flex flex-col gap-2" data-testid="road-geometry">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!truckId || !stops} loading={busy} onClick={() => truckId && stops && geo.toggle(truckId, stops)} data-testid="road-geometry-button">
          <Route aria-hidden /> {visible ? "Hide road path" : "Show road path"}
        </Button>
        {path && visible ? (
          <span className="text-xs tabular-nums" data-testid="road-miles">
            Road miles: {path.miles.toFixed(1)}
            {estimateMiles != null && ` (estimate: ${estimateMiles.toFixed(1)})`}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">{!truckId ? "Select a shipment to draw its road path." : !stops ? "A stop on this shipment has no coordinates." : "Draws this shipment's road path from the public Valhalla server."}</span>
        )}
      </div>
      {geo.error && (
        <p className="text-destructive-foreground text-xs" role="alert" data-testid="road-geometry-error">
          Road path unavailable: {geo.error} Straight lines are shown instead.
        </p>
      )}
      {path && visible && <p className="text-muted-foreground text-xs">{ROAD_COPY}</p>}
    </div>
  )
}

/** Legend for the route layers: line style differs (solid road, dashed schematic), not only color. Credits Valhalla and OSM while a road path is shown. */
export function RouteLegend({ road, schematic, color }: { road: boolean; schematic: boolean; color?: string }) {
  const stroke = color ?? "currentColor"
  return (
    <>
      <ul className="bg-background/90 absolute bottom-6 left-2 flex max-w-[min(32rem,calc(100%-1rem))] flex-col gap-1 rounded-md px-2 py-1 text-[11px] backdrop-blur" aria-label="Route layers" data-testid="route-legend">
        {road && (
          <li className="flex items-center gap-2" data-layer="valhalla_road">
            <svg width="28" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="28" y2="4" stroke={stroke} strokeWidth="3.5" />
            </svg>
            <span className="min-w-0">Road path (Valhalla truck)</span>
          </li>
        )}
        {schematic && (
          <li className="text-muted-foreground flex items-center gap-2" data-layer="schematic_straight_line">
            <svg width="28" height="8" aria-hidden className="shrink-0">
              <line x1="0" y1="4" x2="28" y2="4" stroke={stroke} strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            <span>Schematic straight line</span>
          </li>
        )}
      </ul>
      {road && (
        <p className="bg-background/80 text-muted-foreground absolute right-2 bottom-6 max-w-[min(24rem,50%)] rounded px-1.5 py-0.5 text-right text-[10px] backdrop-blur" data-testid="road-credit">
          {ROAD_CREDIT}
        </p>
      )}
    </>
  )
}
