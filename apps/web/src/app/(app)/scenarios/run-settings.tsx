import type { Dispatch, SetStateAction } from "react"
import { ChevronDownIcon } from "lucide-react"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import type { ScenarioRunSettings } from "@/lib/run-defaults"
import { METERS_PER_MILE } from "@/lib/shipment-sheet"
import { Field, Pick } from "./workbench-ui"

// Number settings, shown in feet, miles and dollars; `scale` converts to the stored integer unit.
const numberSettings: [keyof ScenarioRunSettings, string, number?][] = [
  ["trailer_capacity", "Trailer capacity (ft)", 100],
  ["max_leg_m", "Maximum leg (miles)", METERS_PER_MILE],
  ["k", "Clusters (blank = auto)"],
  ["kmeans_seed", "Cluster seed"],
  ["solver_seed", "Solver seed"],
  ["solver_time_limit_s", "Time per cluster (seconds)"],
  ["inventory_percent", "Inventory available (%)"],
  ["h3_resolution", "H3 resolution (H3 method)"],
  ["solver_max_iterations", "Iterations (blank = time limit)"],
  ["max_cluster_diameter_m", "Cluster diameter (miles; blank = off)", METERS_PER_MILE],
  ["travel_circuity", "Travel circuity"],
  ["cluster_circuity", "Cluster circuity"],
  ["cost_per_truck_cents", "Cost per truck ($)", 100],
  ["cost_per_mile_cents", "Cost per mile ($)", 100],
]
const shown = (value: unknown, scale = 1) => (value == null ? "" : String(scale === 1 ? value : Math.round(((value as number) / scale) * 100) / 100))

const preflightItems = [
  { value: "block" as const, label: "Block run" },
  { value: "warn" as const, label: "Warn only" },
]
const strategyItems = [
  { value: "kmeans" as const, label: "k-means (default)" },
  { value: "h3" as const, label: "H3 cells (deterministic baseline)" },
  { value: "none" as const, label: "No clustering (baseline; needs every stop in one solve)" },
]
const objectiveItems = [
  { value: "trucks_then_distance" as const, label: "Fewest trucks, then miles" },
  { value: "weighted_distance" as const, label: "Fewest miles with truck penalty" },
  { value: "cost" as const, label: "Lowest cost" },
]
const allocationItems = [
  { value: "order_date_then_value" as const, label: "Order date, then value (default)" },
  { value: "first_come" as const, label: "First come" },
  { value: "priority" as const, label: "Priority, then order date" },
  { value: "proportional" as const, label: "Fair share (heuristic)" },
]
const fulfillmentItems = [
  { value: "piece" as const, label: "Partial lines allowed (default)" },
  { value: "whole_order" as const, label: "Whole orders only" },
]
const preflightChecks = ["missing_coordinates", "far_from_depot", "oversize_stop", "approximate_coordinates"] as const

export function RunSettingsPanel({
  settings,
  setSettings,
  updateSetting,
}: {
  settings: ScenarioRunSettings
  setSettings: Dispatch<SetStateAction<ScenarioRunSettings>>
  updateSetting: (name: keyof ScenarioRunSettings, value: number | null) => void
}) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1.5 rounded-md font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Run settings
        <ChevronDownIcon className="size-4 transition-transform group-data-[panel-open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="space-y-4 p-1 pt-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {numberSettings.map(([name, label, scale = 1]) => (
              <Field key={name} label={label}>
                <Input
                  type="number"
                  min="0"
                  step={scale !== 1 || name.includes("circuity") || name === "solver_time_limit_s" ? "any" : "1"}
                  value={shown(settings[name], scale)}
                  onChange={e =>
                    updateSetting(name, e.target.value === "" ? null : scale === 1 ? Number(e.target.value) : Math.round(Number(e.target.value) * scale))
                  }
                />
              </Field>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Pick
              label="Clustering method"
              value={settings.cluster_strategy}
              items={strategyItems}
              onChange={value => setSettings(previous => ({ ...previous, cluster_strategy: value }))}
            />
            <Pick
              label="Objective"
              value={settings.objective}
              items={objectiveItems}
              onChange={value => setSettings(previous => ({ ...previous, objective: value }))}
            />
            <Pick
              label="Allocation"
              value={settings.allocation_strategy}
              items={allocationItems}
              onChange={value => setSettings(previous => ({ ...previous, allocation_strategy: value }))}
            />
            <Pick
              label="Order fulfillment"
              value={settings.fulfillment_policy}
              items={fulfillmentItems}
              onChange={value => setSettings(previous => ({ ...previous, fulfillment_policy: value }))}
            />
            {settings.objective === "weighted_distance" && (
              <Field label="Truck penalty (miles)">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={shown(settings.weighted_truck_penalty_m, METERS_PER_MILE)}
                  onChange={e =>
                    updateSetting("weighted_truck_penalty_m", e.target.value === "" ? null : Math.round(Number(e.target.value) * METERS_PER_MILE))
                  }
                />
              </Field>
            )}
            {preflightChecks.map(check => (
              <Pick
                key={check}
                label={check === "approximate_coordinates" ? "ZIP-approximate stops" : check.replaceAll("_", " ")}
                value={settings.preflight[check]}
                items={preflightItems}
                onChange={value => setSettings(previous => ({ ...previous, preflight: { ...previous.preflight, [check]: value } }))}
              />
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Cost objective requires both rates. Cluster diameter is optional and off by default; maximum leg limits each drive. Run settings are saved with
            each run.
          </p>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  )
}
