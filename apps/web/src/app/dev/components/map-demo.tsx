"use client"

import { useTheme } from "next-themes"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import {
  Map,
  MapControls,
  MapMarker,
  MapRoute,
  MarkerContent,
  MarkerPopup,
  MarkerTooltip,
} from "@/components/ui/map"
import { useCssColors } from "@/lib/css-color"
import { cn } from "@/lib/utils"

import { depot, routeCoordinates, routeIds, stops } from "./sample-data"

// Route lines here are straight schematic connections, not road geometry (spec §4).
export default function MapDemo({ embedded = false }: { embedded?: boolean }) {
  const { resolvedTheme } = useTheme()
  const [activeRoute, setActiveRoute] = useState<number | null>(null)
  const [selectedStop, setSelectedStop] = useState<string | null>(null)
  const routeColors = useCssColors(
    routeIds.map((route) => `--route-${route}`),
    resolvedTheme
  )

  return (
    <div className={cn("flex flex-col gap-3", embedded && "h-full")}>
      <div className={cn("flex flex-wrap items-center gap-2 text-sm", embedded && "hidden")}>
        <span className="text-muted-foreground">Routes (schematic):</span>
        {routeIds.map((route) => (
          <button
            key={route}
            type="button"
            onClick={() => setActiveRoute(activeRoute === route ? null : route)}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
              activeRoute === route ? "bg-muted" : "hover:bg-muted/50"
            )}
            aria-pressed={activeRoute === route}
          >
            <span className="size-2.5 rounded-full" style={{ background: `var(--route-${route})` }} />
            Route {route}
          </button>
        ))}
        {selectedStop && <Badge variant="secondary">Selected: {selectedStop}</Badge>}
      </div>
      <div className={cn("overflow-hidden", embedded ? "h-full" : "h-[460px] rounded-xl border")}>
        <Map
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          center={[depot.longitude, depot.latitude]}
          zoom={11.5}
        >
          {routeIds.map((route) => (
            routeColors[`--route-${route}`] && <MapRoute
              key={route}
              id={`route-${route}`}
              coordinates={routeCoordinates(route)}
              color={routeColors[`--route-${route}`]}
              width={3}
              dashArray={[2, 1.5]}
              opacity={activeRoute === null || activeRoute === route ? 0.9 : 0.25}
              active={activeRoute === route}
              activeWidth={5}
            />
          ))}

          <MapMarker longitude={depot.longitude} latitude={depot.latitude}>
            <MarkerContent>
              <div className="bg-foreground text-background flex size-7 items-center justify-center rounded-md text-[10px] font-semibold shadow">
                D
              </div>
            </MarkerContent>
            <MarkerTooltip>{depot.label}</MarkerTooltip>
          </MapMarker>

          {stops.map((stop) => (
            <MapMarker
              key={stop.id}
              longitude={stop.longitude}
              latitude={stop.latitude}
              onClick={() => setSelectedStop(stop.id)}
            >
              <MarkerContent>
                <div
                  className={cn(
                    "size-4 rounded-full border-2 border-white shadow",
                    selectedStop === stop.id && "ring-ring ring-2 ring-offset-1"
                  )}
                  style={{
                    background: stop.route ? `var(--route-${stop.route})` : "var(--muted-foreground)",
                  }}
                />
              </MarkerContent>
              <MarkerPopup closeButton>
                <div className="bg-popover text-popover-foreground w-52 space-y-1 rounded-md border p-3 text-xs shadow-md">
                  <div className="text-sm font-medium">{stop.label}</div>
                  <div className="text-muted-foreground">
                    {stop.route ? `Route ${stop.route}` : "Unassigned"} · demand {stop.demand}
                  </div>
                  <div>Window {stop.window}</div>
                  {stop.source === "zcta" && (
                    <Badge variant="outline" className="mt-1">
                      Approximate (ZCTA)
                    </Badge>
                  )}
                </div>
              </MarkerPopup>
            </MapMarker>
          ))}

          <MapControls position="top-right" showZoom showCompass showFullscreen />
        </Map>
      </div>
    </div>
  )
}
