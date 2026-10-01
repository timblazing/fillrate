import { CircleSlash, Crosshair, FileInput, Hand, Landmark, MapPinned, Route, Ruler, TableProperties } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Coordinate provenance (spec §6). ZCTA is approximate and always visibly flagged; unresolved never becomes (0,0).
export type CoordinateSource = "imported" | "manual" | "census" | "zcta" | "unresolved"

const coordinateSources: Record<
  CoordinateSource,
  { label: string; icon: typeof Crosshair; hint: string; tone?: "approximate" | "missing" }
> = {
  imported: { label: "Imported", icon: FileInput, hint: "Coordinate supplied in the import file" },
  manual: { label: "Manual", icon: Hand, hint: "Placed or corrected on the map" },
  census: { label: "Census", icon: Landmark, hint: "Census address match (interpolated, not rooftop)" },
  zcta: {
    label: "ZIP approx.",
    icon: MapPinned,
    hint: "ZIP/ZCTA internal point fallback. Review before running.",
    tone: "approximate",
  },
  unresolved: {
    label: "Unresolved",
    icon: CircleSlash,
    hint: "No coordinates. Excluded from allocation until placed on the map.",
    tone: "missing",
  },
}

/**
 * Design review `orders.coords`: only problems carry a badge by default (ZIP-approximate and missing). File,
 * Census and manual coordinates stay unbadged unless the viewer asks for "Show all sources". Popups follow suit.
 */
export const isCoordinateProblem = (source: CoordinateSource) => source === "zcta" || source === "unresolved"

/** The badge, or nothing when the source is not a problem and `showAll` is off. */
export function CoordinateSourceFlag({ source, showAll = false, className }: { source: CoordinateSource; showAll?: boolean; className?: string }) {
  if (!showAll && !isCoordinateProblem(source)) return null
  return <CoordinateSourceBadge source={source} className={className} />
}

export function CoordinateSourceBadge({ source, className }: { source: CoordinateSource; className?: string }) {
  const { label, icon: Icon, hint, tone } = coordinateSources[source]
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant={tone === "approximate" ? "warning" : tone === "missing" ? "error" : "outline"}
            className={cn(tone === "approximate" && "border-dashed", className)}
          />
        }
      >
        <Icon />
        {label}
      </TooltipTrigger>
      <TooltipPopup>{hint}</TooltipPopup>
    </Tooltip>
  )
}

// Travel matrix provenance (spec §7). Haversine is always labeled as an estimate.
export type TravelMode = "haversine" | "valhalla" | "imported"

const travelModes: Record<TravelMode, { label: string; icon: typeof Ruler; hint: string }> = {
  haversine: {
    label: "Estimated · haversine",
    icon: Ruler,
    hint: "Great-circle miles × the circuity factor. The 500 mi single-drive limit uses these solver miles.",
  },
  valhalla: { label: "Valhalla road network", icon: Route, hint: "Directed road distances and durations (truck costing)" },
  imported: { label: "Imported matrix", icon: TableProperties, hint: "User-supplied directed matrix" },
}

export function TravelModeBadge({
  mode,
  detail,
  className,
}: {
  mode: TravelMode
  detail?: string
  className?: string
}) {
  const { label, icon: Icon, hint } = travelModes[mode]
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge variant={mode === "haversine" ? "secondary" : "outline"} className={className} />}>
        <Icon />
        {label}
        {detail && <span className="text-muted-foreground font-normal">· {detail}</span>}
      </TooltipTrigger>
      <TooltipPopup>{hint}</TooltipPopup>
    </Tooltip>
  )
}
