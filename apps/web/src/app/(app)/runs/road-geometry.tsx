"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { RunSummary } from "@fillrate/contracts"
import { fetchRoadPath, type LonLat, ROAD_COPY, ROAD_CREDIT, type RoadPath, routeStops } from "@/lib/road-geometry"

export type RoadGeometry = {
  paths: Record<string, RoadPath>
  shown: Set<string>
  busy: string | null
  error: string | null
  load: (truckId: string, stops: LonLat[]) => void
}

/** Load the inspected shipment only; reuse its road geometry within this result view. */
export function useRoadGeometry(): RoadGeometry {
  const [paths, setPaths] = useState<Record<string, RoadPath>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cached = useRef(new Set<string>())
  const pending = useRef<{ truckId: string; controller: AbortController } | null>(null)

  useEffect(() => () => {
    pending.current?.controller.abort()
    pending.current = null
  }, [])

  const load = useCallback(async (truckId: string, stops: LonLat[]) => {
    if (pending.current?.truckId === truckId) return
    pending.current?.controller.abort()
    pending.current = null
    setError(null)
    if (cached.current.has(truckId)) {
      setBusy(null)
      return
    }
    const controller = new AbortController()
    pending.current = { truckId, controller }
    setBusy(truckId)
    try {
      const path = await fetchRoadPath(stops, controller.signal)
      if (controller.signal.aborted) return
      cached.current.add(truckId)
      setPaths((current) => ({ ...current, [truckId]: path }))
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not reach the routing service.")
    } finally {
      if (pending.current?.controller === controller) {
        pending.current = null
        setBusy(null)
      }
    }
  }, [])

  const shown = useMemo(() => new Set(Object.keys(paths)), [paths])
  return { paths, shown, busy, error, load }
}

/** Automatically load the selected shipment, with compact distance and fallback status. */
export function RoadGeometryStatus({ geo, summary, truckId }: { geo: RoadGeometry; summary: RunSummary; truckId: string | null }) {
  const stops = useMemo(() => routeStops(summary, truckId), [summary, truckId])
  const load = geo.load
  useEffect(() => {
    if (truckId && stops) load(truckId, stops)
  }, [truckId, stops, load])
  if (!truckId) return null
  const truck = summary.trucks.find((t) => t.id === truckId)
  const estimateMiles = truck ? truck.distance_m / 1609.344 : null
  const path = geo.paths[truckId]
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs" data-testid="road-geometry" role="status">
      {path ? (
        <span title={ROAD_COPY} className="tabular-nums" data-testid="road-miles">
          Road miles: {path.miles.toFixed(1)}{estimateMiles != null && ` · Plan estimate: ${estimateMiles.toFixed(1)}`}
        </span>
      ) : geo.error ? (
        <>
          <span title={geo.error} data-testid="road-geometry-error">Road path unavailable · Estimated path shown</span>
          {stops && <Button size="sm" variant="ghost" onClick={() => load(truckId, stops)}>Retry road path</Button>}
        </>
      ) : !stops ? (
        <span>A stop has no coordinates · Estimated path shown</span>
      ) : (
        <><Spinner className="size-3" /> Loading road path</>
      )}
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
