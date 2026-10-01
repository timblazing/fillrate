"use client"

import { ChevronRight } from "lucide-react"
import { useState } from "react"

import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { COST_FALLBACK, legRule } from "@/lib/copy"
import { cn } from "@/lib/utils"

export type Objective = "cost" | "trucks_then_miles" | "miles_with_penalty"

const objectives: { id: Objective; label: string; hint: string }[] = [
  { id: "cost", label: "Lowest cost", hint: "Cost per truck × shipments + cost per mile × loaded miles" },
  { id: "trucks_then_miles", label: "Fewest trucks, then miles", hint: "Any plan with fewer shipments wins; miles break ties" },
  { id: "miles_with_penalty", label: "Fewest miles with truck penalty", hint: "Miles plus a fixed penalty per truck" },
]

// Fleet / Constraints inspector design (spec v1.8 §15 M2 items 14 and 15). Lowest cost is the primary user's
// choice and the default once both rates exist; until then the solver uses fewest trucks, then miles, and says
// so. The cluster-diameter limit is an optional policy under Advanced, off by default. Solver support is M3 (§8b).
export function ObjectiveSettings({ className }: { className?: string }) {
  const [truckCost, setTruckCost] = useState("")
  const [mileCost, setMileCost] = useState("")
  const ratesSet = Number(truckCost) > 0 && Number(mileCost) > 0
  const [choice, setChoice] = useState<Objective | null>(null)
  const objective: Objective = choice ?? (ratesSet ? "cost" : "trucks_then_miles")
  const [advanced, setAdvanced] = useState(false)
  const [diameterOn, setDiameterOn] = useState(false)

  return (
    <div className={cn("bg-card space-y-4 rounded-xl border p-3.5 text-sm", className)}>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cost-truck" className="text-xs">
            Cost per truck
          </Label>
          <InputGroup>
            <InputGroupAddon>$</InputGroupAddon>
            <InputGroupInput id="cost-truck" inputMode="decimal" placeholder="not set" value={truckCost} onChange={(e) => setTruckCost(e.target.value)} />
          </InputGroup>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cost-mile" className="text-xs">
            Cost per mile
          </Label>
          <InputGroup>
            <InputGroupAddon>$</InputGroupAddon>
            <InputGroupInput id="cost-mile" inputMode="decimal" placeholder="not set" value={mileCost} onChange={(e) => setMileCost(e.target.value)} />
          </InputGroup>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-xs font-medium">Objective</legend>
        <RadioGroup value={objective} onValueChange={(v) => setChoice(v as Objective)}>
          {objectives.map((o) => (
            <Label key={o.id} className="items-start gap-2 font-normal">
              <Radio value={o.id} disabled={o.id === "cost" && !ratesSet} className="mt-0.5" />
              <span className="min-w-0">
                <span className={cn("block text-sm", o.id === "cost" && !ratesSet && "text-muted-foreground")}>
                  {o.label}
                  {o.id === "cost" && <span className="text-muted-foreground text-xs"> · default once rates are set</span>}
                </span>
                <span className="text-muted-foreground block text-xs">{o.hint}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        {!ratesSet && <p className="text-warning-foreground text-xs">{COST_FALLBACK}</p>}
      </fieldset>

      <div className="space-y-1">
        <div className="text-xs font-medium">Max single drive</div>
        <div className="flex items-center gap-2">
          <Input defaultValue="500" className="w-20 font-mono" size="sm" aria-label="Max single drive in miles" />
          <span className="text-muted-foreground text-xs">mi</span>
        </div>
        <p className="text-muted-foreground text-xs">{legRule()}</p>
      </div>

      <div className="border-t pt-3">
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-medium"
        >
          <ChevronRight className={cn("size-3.5 transition-transform duration-150", advanced && "rotate-90")} aria-hidden />
          Advanced
        </button>
        {advanced && (
          <div className="mt-2 space-y-2">
            <Label className="gap-2 text-xs font-normal">
              <Switch checked={diameterOn} onCheckedChange={setDiameterOn} />
              Limit cluster diameter (optional policy)
            </Label>
            {diameterOn ? (
              <div className="flex items-center gap-2 pl-11">
                <Input defaultValue="500" className="w-20 font-mono" size="sm" aria-label="Max cluster diameter in miles" />
                <span className="text-muted-foreground text-xs">mi widest pair; clusters over it are split</span>
              </div>
            ) : (
              <p className="text-muted-foreground pl-11 text-xs">Off. Widest pair is still reported as a tightness metric.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
