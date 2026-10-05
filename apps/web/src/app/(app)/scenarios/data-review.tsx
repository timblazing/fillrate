"use client"

import type { ScenarioDocument } from "@fillrate/contracts"
import type { GeocodeCapabilities, GeocodeJob, GeocodeOptions } from "@fillrate/db/geocode"
import { COORDINATE_SOURCES, type DataReview } from "@fillrate/db/review"
import { Crosshair, MapPinned, Search, Undo2 } from "lucide-react"
import dynamic from "next/dynamic"
import { useState } from "react"

import { CoordinateSourceBadge, CoordinateSourceFlag, isCoordinateProblem } from "@/components/lab/provenance-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCount, plural } from "@/lib/units"

const CoordinateMap = dynamic(() => import("./coordinate-map"), { ssr: false, loading: () => <div className="bg-muted/40 h-full animate-pulse" /> })

type Location = ScenarioDocument["locations"][number]

/** Data review (spec §6, M5): counts, coordinate sources and stock gaps to check before saving or running. */
export function DataReviewPanel({ review }: { review: DataReview }) {
  const notes: [string, "warning" | "error" | "info"][] = []
  if (review.geocodable) notes.push([`${plural(review.geocodable, "address", "addresses")} without coordinates yet. Resolve addresses, or place them on the map.`, "warning"])
  if (review.noAddress) notes.push([`${plural(review.noAddress, "stop")} with neither coordinates nor an address. Place them on the map or exclude their lines.`, "error"])
  if (review.coordinates.zcta) notes.push([`${plural(review.coordinates.zcta, "stop")} placed by ZIP code only (ZCTA internal point). Review before running.`, "warning"])
  if (review.censusNonExact) notes.push([`${plural(review.censusNonExact, "Census match", "Census matches")} not exact (a near-miss address). Check them on the map.`, "info"])
  if (review.sharedCoordinates) notes.push([`${plural(review.sharedCoordinates, "stop")} share an identical coordinate with another stop.`, "info"])
  if (review.zeroPieceLines) notes.push([`${plural(review.zeroPieceLines, "line")} order zero pieces.`, "info"])
  if (review.zeroValueLines) notes.push([`${plural(review.zeroValueLines, "line")} have a zero net value.`, "info"])
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4 text-sm" aria-label="Data review">
      <h3 className="font-medium">Data review</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        {([["Orders", review.orders], ["Lines", review.lines], ["Customers", review.customers], ["Products", review.products], ["Stops", review.locations], ["Corrected by hand", review.corrected]] as const).map(([label, n]) => (
          <div key={label}>
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-base font-medium tabular-nums">{formatCount(n)}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground text-xs">Coordinates</span>
        {COORDINATE_SOURCES.filter((s) => review.coordinates[s]).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <CoordinateSourceBadge source={s} />
            <span className="tabular-nums">{formatCount(review.coordinates[s])}</span>
          </span>
        ))}
        {review.orderDates && <span className="text-muted-foreground ml-auto text-xs">Order dates {review.orderDates.first} – {review.orderDates.last}</span>}
      </div>
      {review.shortProducts.length > 0 && (
        <p className="text-muted-foreground text-xs">
          {plural(review.shortProducts.length, "product")} ordered beyond stock:{" "}
          {review.shortProducts.slice(0, 5).map((p) => `${p.product_id} (${formatCount(p.ordered)} ordered, ${formatCount(p.available)} on hand)`).join(", ")}
          {review.shortProducts.length > 5 ? ", …" : ""}. Allocation decides who gets them.
        </p>
      )}
      {notes.length > 0 && (
        <ul className="flex flex-col gap-1">
          {notes.map(([text, tone]) => (
            <li key={text} className="flex items-start gap-2">
              <Badge variant={tone} size="sm" className="mt-0.5">{tone === "error" ? "Fix" : tone === "warning" ? "Review" : "Note"}</Badge>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Census batch geocoding with the ZIP/ZCTA fallback. Hidden entirely when the server offers neither. */
export function GeocodePanel({ capabilities, review, job, busy, onStart }: {
  capabilities: GeocodeCapabilities | null
  review: DataReview
  job: GeocodeJob | null
  busy: boolean
  onStart: (options: GeocodeOptions) => void
}) {
  const [fallback, setFallback] = useState(true)
  const [regeocode, setRegeocode] = useState(false)
  if (!capabilities || (!capabilities.census && !capabilities.zcta)) return null
  const running = job?.status === "queued" || job?.status === "running"
  const report = job?.status === "succeeded" ? job.report : null
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4 text-sm" aria-label="Resolve addresses">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Resolve addresses</h3>
        <span className="text-muted-foreground text-xs">
          {capabilities.census ? `Census geocoder (${capabilities.census.benchmark}), up to ${formatCount(capabilities.census.batch_limit)} addresses per batch` : "Census geocoding is off on this server"}
          {capabilities.zcta ? ` · ZIP fallback ${capabilities.zcta.dataset}` : ""}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        Census matches are interpolated along street address ranges, not rooftop points. The ZIP fallback uses the internal point of the Census ZIP Code
        Tabulation Area (ZCTA) with the same code. A ZCTA approximates a ZIP code&apos;s area; PO-box-only and single-business ZIPs have no ZCTA and stay
        unresolved. Coordinates from your file are kept unless you ask to re-geocode. The result is saved as a new version.
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {capabilities.zcta && (
          <label className="flex items-center gap-2">
            <Switch checked={fallback} onCheckedChange={setFallback} /> Use the ZIP fallback when Census finds no match
          </label>
        )}
        {capabilities.census && (
          <label className="flex items-center gap-2">
            <Switch checked={regeocode} onCheckedChange={setRegeocode} /> Also re-geocode coordinates from the file (manual placements are kept)
          </label>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || running || (!review.geocodable && !regeocode)} loading={running} onClick={() => onStart({ fallback: fallback && capabilities.zcta ? "zcta" : "off", regeocode })}>
          <MapPinned aria-hidden /> {regeocode ? "Re-geocode addresses" : `Resolve ${plural(review.geocodable, "address", "addresses")}`}
        </Button>
        {running && <span className="text-muted-foreground text-xs tabular-nums">{job?.progress ? `${formatCount(job.progress.done)} of ${formatCount(job.progress.total)} addresses` : "Queued"}</span>}
        {job?.status === "failed" && <span role="alert" className="text-destructive-foreground text-xs">{job.error}</span>}
      </div>
      {report && (
        <p className="text-xs" role="status">
          Census: {formatCount(report.census_exact)} exact, {formatCount(report.census_non_exact)} not exact · ZIP fallback: {formatCount(report.zcta)} · still unresolved:{" "}
          {formatCount(report.unresolved)}
          {report.unresolved ? ` (${report.no_zip} without a ZIP, ${report.zip_without_zcta} with a ZIP that has no ZCTA)` : ""}
          {report.kept ? ` · ${report.kept} kept their earlier coordinate` : ""} · {formatCount(report.cached)} from cache, {formatCount(report.requested)} sent in{" "}
          {plural(report.batches, "batch", "batches")}.{job?.branched ? " The scenario changed meanwhile, so the result was saved as a branch." : ""}
        </p>
      )}
    </div>
  )
}

function CoordinateCell({ label, value, onCommit }: { label: string; value: number | null; onCommit: (value: string) => void }) {
  return <Input key={String(value)} aria-label={label} className="w-24 font-mono text-xs" defaultValue={value ?? ""} onBlur={(e) => onCommit(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }} />
}

/**
 * Coordinate review (spec §6; design review `orders.coords`): problems first, badges only on problems unless
 * "Show all sources" is on. Place or drag stops on the map, type coordinates, or look up one address.
 */
export function CoordinateReview({ doc, canFind, busy, undoLabel, onPlace, onAxis, onFind, onUndo, onError }: {
  doc: ScenarioDocument
  canFind: boolean
  busy: boolean
  undoLabel: string | null
  onPlace: (id: string, lat: number, lon: number) => void
  /** One typed value; a stop stays unresolved until it has both (never (0, 0) by default). */
  onAxis: (id: string, axis: "lat" | "lon", value: number | null) => void
  onFind: (id: string, address: string) => void
  onUndo: () => void
  onError: (message: string) => void
}) {
  const problems = doc.locations.filter((l) => isCoordinateProblem(l.coordinate_source))
  const [onlyProblems, setOnlyProblems] = useState(problems.length > 0)
  const [showAll, setShowAll] = useState(false)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const rows = onlyProblems ? problems : doc.locations
  const shown = rows.slice(page * 25, (page + 1) * 25)
  const axis = (loc: Location, which: "lat" | "lon", raw: string) => {
    const n = raw.trim() ? Number(raw) : null
    if (n !== null && (!Number.isFinite(n) || Math.abs(n) > (which === "lat" ? 90 : 180))) { onError(`${which === "lat" ? "Latitude must be from -90 to 90" : "Longitude must be from -180 to 180"}.`); return }
    if (n !== loc[which]) onAxis(loc.id, which, n)
  }
  const select = (id: string | null) => { setSelected(id); setPlacing(false); if (id && onlyProblems && !problems.some((p) => p.id === id)) setOnlyProblems(false) }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={onlyProblems ? "default" : "outline"} onClick={() => { setOnlyProblems(true); setPage(0) }}>Coordinate problems ({formatCount(problems.length)})</Button>
        <Button size="sm" variant={onlyProblems ? "outline" : "default"} onClick={() => { setOnlyProblems(false); setPage(0) }}>All stops ({formatCount(doc.locations.length)})</Button>
        <label className="text-muted-foreground flex items-center gap-2 text-xs"><Switch checked={showAll} onCheckedChange={setShowAll} /> Show all sources</label>
        {undoLabel && <Button size="sm" variant="ghost" className="ml-auto" onClick={onUndo}><Undo2 aria-hidden /> Undo {undoLabel}</Button>}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader><TableRow><TableHead>Location</TableHead><TableHead>Latitude</TableHead><TableHead>Longitude</TableHead><TableHead>Source</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {shown.map((loc) => (
                  <TableRow key={loc.id} data-state={loc.id === selected ? "selected" : undefined} onClick={() => select(loc.id)} className="cursor-pointer">
                    <TableCell className="max-w-44">
                      <div className="truncate font-medium">{loc.label}</div>
                      {loc.address && loc.address !== loc.label && <div className="text-muted-foreground truncate text-xs">{loc.address}</div>}
                      {loc.original && <div className="text-muted-foreground text-xs">Was {loc.original.coordinate_source}{loc.original.lat != null ? ` ${loc.original.lat.toFixed(5)}, ${loc.original.lon!.toFixed(5)}` : ""}</div>}
                    </TableCell>
                    {(["lat", "lon"] as const).map((a) => (
                      <TableCell key={a} onClick={(e) => e.stopPropagation()}>
                        <CoordinateCell label={`${a === "lat" ? "Latitude" : "Longitude"} ${loc.label}`} value={loc[a]} onCommit={(v) => axis(loc, a, v)} />
                      </TableCell>
                    ))}
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <CoordinateSourceFlag source={loc.coordinate_source} showAll={showAll} />
                        {loc.geocode?.match_type === "non_exact" && <span className="text-muted-foreground text-[11px]">not exact</span>}
                        {loc.geocode?.zcta && <span className="text-muted-foreground text-[11px]">ZCTA {loc.geocode.zcta}</span>}
                      </div>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        <Button size="icon-sm" aria-label={`Place ${loc.label} on the map`} title="Place on the map" variant={placing && selected === loc.id ? "default" : "outline"} onClick={() => { setSelected(loc.id); setPlacing(!(placing && selected === loc.id)) }}>
                          <Crosshair aria-hidden />
                        </Button>
                        {canFind && loc.address && (
                          <Button size="icon-sm" aria-label={`Find ${loc.label} by address`} title="Find by address (Census, then ZIP)" variant="outline" disabled={busy} onClick={() => onFind(loc.id, loc.address!)}><Search aria-hidden /></Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!shown.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center">{onlyProblems ? "No coordinate problems." : "No locations."}</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button>
            <span className="text-sm tabular-nums">{rows.length ? page * 25 + 1 : 0}–{Math.min((page + 1) * 25, rows.length)} of {rows.length}</span>
            <Button size="sm" variant="outline" disabled={(page + 1) * 25 >= rows.length} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
        <div className="h-[360px] overflow-hidden rounded-xl border xl:h-auto xl:min-h-[420px]">
          <CoordinateMap depot={doc.depot} locations={doc.locations} selected={selected} placing={placing} onSelect={select} onPlace={(id, lat, lon) => { onPlace(id, lat, lon); setPlacing(false) }} />
        </div>
      </div>
      <p className="text-muted-foreground text-xs">Edits mark the stop as placed by hand and keep its earlier coordinate and source. Save a version to keep them.</p>
    </div>
  )
}
