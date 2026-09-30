import { Crosshair, FileInput, Hand, Landmark, MapPinned, Route, Ruler, TableProperties } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Coordinate provenance (spec §6). ZCTA is approximate and always visibly flagged.
export type CoordinateSource = "imported" | "manual" | "census" | "zcta"

const coordinateSources: Record<
  CoordinateSource,
  { label: string; icon: typeof Crosshair; hint: string; approximate?: boolean }
> = {
  imported: { label: "Imported", icon: FileInput, hint: "Coordinate supplied in the import file" },
  manual: { label: "Manual", icon: Hand, hint: "Placed or corrected on the map" },
  census: { label: "Census", icon: Landmark, hint: "Census address match (interpolated, not rooftop)" },
  zcta: {
    label: "ZCTA approx.",
    icon: MapPinned,
    hint: "ZIP/ZCTA internal point fallback. Review before solving.",
    approximate: true,
  },
}

export function CoordinateSourceBadge({ source, className }: { source: CoordinateSource; className?: string }) {
  const { label, icon: Icon, hint, approximate } = coordinateSources[source]
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge variant="outline" className={cn(approximate && "border-route-4/50 bg-route-4/10 text-route-4 border-dashed", className)} />
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
export type TravelMode = "haversine" | "osrm" | "imported"

const travelModes: Record<TravelMode, { label: string; icon: typeof Ruler; hint: string }> = {
  haversine: { label: "Estimated · Haversine", icon: Ruler, hint: "Straight-line distance at a constant speed" },
  osrm: { label: "OSRM road network", icon: Route, hint: "Directed road distances and durations" },
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
