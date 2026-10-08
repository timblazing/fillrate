"use client"

import type { RouteGeometryResponse } from "@fillrate/contracts"
import { Route } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { INELIGIBLE_COPY, ROAD_COPY, roadLabel } from "@/lib/road-geometry"

type Status =
  | { eligible: true; fetched_trucks: string[] }
  | { eligible: false; reason: string; message: string; fetched_trucks: string[] }

export type RoadGeometry = {
  status: Status | null
  geometries: Record<string, RouteGeometryResponse>
  /** Trucks whose road lines are drawn (fetched and not hidden). */
  shown: Set<string>
  busy: string | null
  error: string | null
  toggle: (truckId: string) => void
}

/** Eligibility, fetched geometries and show/hide for one run. Fetches nothing until a truck's button is pressed. */
export function useRoadGeometry(runId: string, enabled: boolean): RoadGeometry {
  const [status, setStatus] = useState<Status | null>(null)
  const [geometries, setGeometries] = useState<Record<string, RouteGeometryResponse>>({})
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    fetch(`/api/v1/runs/${runId}/geometry`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as Status) : null))
      .then((body) => live && setStatus(body))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [runId, enabled])

  const toggle = useCallback(
    async (truckId: string) => {
      setError(null)
      if (geometries[truckId]) {
        setHidden((h) => {
          const next = new Set(h)
          if (next.has(truckId)) next.delete(truckId)
          else next.add(truckId)
          return next
        })
        return
      }
      setBusy(truckId)
      try {
        const res = await fetch(`/api/v1/runs/${runId}/geometry`, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ truck: truckId }),
        })
        const body = await res.json()
        if (!res.ok) setError(body.error?.message ?? "Could not fetch road geometry.")
        else {
          setGeometries((g) => ({ ...g, [truckId]: body as RouteGeometryResponse }))
          setHidden((h) => {
            const next = new Set(h)
            next.delete(truckId)
            return next
          })
        }
      } catch {
        setError("Could not reach the server.")
      }
      setBusy(null)
    },
    [geometries, runId],
  )

  const shown = useMemo(() => new Set(Object.keys(geometries).filter((id) => !hidden.has(id))), [geometries, hidden])
  return { status, geometries, shown, busy, error, toggle }
}

const km = (m: number | null | undefined) => (m == null ? "—" : `${(m / 1000).toFixed(1)} km`)
const signed = (n: number | null | undefined, unit: string, digits = 1) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(digits)} ${unit}`)

/** The "Show road geometry" action for one truck, its explanation and the matrix-versus-route discrepancies. */
export function RoadGeometryControl({ geo, truckId }: { geo: RoadGeometry; truckId: string | null }) {
  const { status } = geo
  if (!status) return null
  if (!status.eligible) {
    return (
      <p className="text-muted-foreground text-xs" data-testid="road-geometry-ineligible" data-reason={status.reason}>
        {INELIGIBLE_COPY[status.reason] ?? status.message}
      </p>
    )
  }
  const geometry = truckId ? geo.geometries[truckId] : undefined
  const visible = !!truckId && geo.shown.has(truckId)
  const busy = !!truckId && geo.busy === truckId
  return (
    <div className="flex flex-col gap-2" data-testid="road-geometry">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!truckId} loading={busy} onClick={() => truckId && geo.toggle(truckId)} data-testid="road-geometry-button">
          <Route aria-hidden /> {visible ? "Hide road geometry" : "Show road geometry"}
        </Button>
        <span className="text-muted-foreground text-xs">
          {truckId ? "Fetches Valhalla's route for this shipment only." : "Select a shipment to fetch its road geometry."}
        </span>
      </div>
      {geo.error && (
        <Alert variant="error">
          <AlertTitle>Road geometry unavailable</AlertTitle>
          <AlertDescription>{geo.error}</AlertDescription>
        </Alert>
      )}
      {geometry && visible && <Discrepancies geometry={geometry} />}
    </div>
  )
}

function Discrepancies({ geometry }: { geometry: RouteGeometryResponse }) {
  const summary = geometry.summary as { drawn: number; missing: number; notable: number; route_m: number; matrix_m: number; route_s: number; matrix_s: number }
  return (
    <div className="bg-card flex flex-col gap-2 rounded-lg border p-3 text-xs" data-testid="road-geometry-notes">
      <p className="font-medium">{roadLabel(geometry)}</p>
      <p className="text-muted-foreground">{ROAD_COPY}</p>
      <p className="tabular-nums">
        {summary.drawn} of {geometry.legs.length} legs drawn · roads {km(summary.route_m)} vs matrix {km(summary.matrix_m)} ({signed(summary.route_m - summary.matrix_m, "m", 0)}) · {summary.notable} with a notable difference
        {summary.missing > 0 && ` · ${summary.missing} with no road route (not drawn, never replaced by a straight line)`}
      </p>
      <details>
        <summary className="cursor-pointer font-medium">Matrix versus road route, by leg</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left tabular-nums" data-testid="road-geometry-legs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pr-3 font-medium">Leg</th>
                <th className="pr-3 font-medium">Matrix</th>
                <th className="pr-3 font-medium">Road</th>
                <th className="pr-3 font-medium">Δ distance</th>
                <th className="pr-3 font-medium">Δ time</th>
              </tr>
            </thead>
            <tbody>
              {geometry.legs.map((leg) => (
                <tr key={leg.index} className={leg.notable ? "font-medium" : undefined} data-notable={leg.notable}>
                  <td className="pr-3">
                    {leg.from_id} → {leg.to_id}
                  </td>
                  <td className="pr-3">{km(leg.matrix_m)} · {leg.matrix_s ?? "—"} s</td>
                  {leg.coordinates ? (
                    <>
                      <td className="pr-3">{km(leg.route_m)} · {Math.round(leg.route_s ?? 0)} s</td>
                      <td className="pr-3">{signed(leg.delta_m, "m", 0)} ({leg.relative_m == null ? "—" : `${(leg.relative_m * 100).toFixed(1)}%`})</td>
                      <td className="pr-3">{signed(leg.delta_s, "s", 0)}</td>
                    </>
                  ) : (
                    <td className="pr-3" colSpan={3}>
                      No road route ({leg.status}){leg.error ? `: ${leg.error}` : ""}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

/** Legend for the route layers: line style differs (solid road, dashed schematic), not only color. */
export function RouteLegend({ road, schematic, color }: { road: string | null; schematic: boolean; color?: string }) {
  const stroke = color ?? "currentColor"
  return (
    <ul className="bg-background/90 absolute bottom-6 left-2 flex max-w-[min(32rem,calc(100%-1rem))] flex-col gap-1 rounded-md px-2 py-1 text-[11px] backdrop-blur" aria-label="Route layers" data-testid="route-legend">
      {road && (
        <li className="flex items-center gap-2" data-layer="valhalla_road">
          <svg width="28" height="8" aria-hidden className="shrink-0">
            <line x1="0" y1="4" x2="28" y2="4" stroke={stroke} strokeWidth="3.5" />
          </svg>
          <span className="min-w-0 break-all">{road}</span>
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
  )
}
