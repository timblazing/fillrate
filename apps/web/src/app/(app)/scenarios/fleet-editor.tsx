"use client"

import { useState } from "react"
import { fleetProblems, MAX_FLEET_TYPES, type FleetType } from "@fillrate/db/fleet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** A number the user types: committed whenever the text parses, reset when the value changes elsewhere. */
function DraftNumber({ label, value, parse, show, onCommit, testId, placeholder }: { label: string; value: number | null | undefined; parse: (text: string) => number | null | undefined; show: (value: number | null | undefined) => string; onCommit: (value: number | null) => void; testId: string; placeholder?: string }) {
  const [text, setText] = useState(show(value))
  // A value changed elsewhere (a removed row shifts the rows below it) replaces the draft; the user's own typing never does.
  const [seen, setSeen] = useState(value)
  if (value !== seen) { setSeen(value); if (parse(text) !== (value ?? null)) setText(show(value)) }
  const parsed = parse(text)
  return <Input aria-label={label} data-testid={testId} aria-invalid={parsed === undefined} inputMode="decimal" placeholder={placeholder} value={text} onChange={e => { setText(e.target.value); const next = parse(e.target.value); if (next !== undefined) onCommit(next) }} />
}
const feet = (hundredths: number | null | undefined) => (hundredths == null ? "" : String(hundredths / 100))
/** Feet with at most two decimals to integer hundredths of a foot; undefined while the text is not a length. */
const parseFeet = (text: string) => (/^\d+(\.\d{1,2})?$/.test(text.trim()) ? Math.round(Number(text) * 100) : undefined)
/** A whole number, or blank for "unlimited" / "not set" (null); undefined while the text is not a count. */
const parseWhole = (text: string) => (text.trim() === "" ? null : /^\d+$/.test(text.trim()) ? Number(text) : undefined)
const whole = (value: number | null | undefined) => (value == null ? "" : String(value))

const TRAILER: FleetType = { id: "trailer-53", label: "53 ft trailer", count: null, capacity: 5300, fixed_cost_cents: null, per_mile_cents: null }

/**
 * Vehicle types for the run (spec §3, M6). Without a fleet the run uses one unlimited 53 ft trailer. Counts apply to the
 * whole dispatch; a blank count is unlimited. Basic shows label, count and length; Advanced adds the ID and the cents
 * rates the lowest-cost objective prices each type by.
 */
export function FleetEditor({ fleet, objective, onChange }: { fleet: FleetType[] | undefined; objective: string; onChange: (fleet: FleetType[] | undefined) => void }) {
  const problems = fleetProblems({ fleet, objective })
  const set = (index: number, patch: Partial<FleetType>) => onChange((fleet ?? []).map((type, i) => (i === index ? { ...type, ...patch } : type)))
  const add = () => {
    const taken = new Set((fleet ?? []).map(t => t.id))
    let n = (fleet?.length ?? 0) + 1
    while (taken.has(`type-${n}`)) n++
    onChange([...(fleet ?? []), { id: `type-${n}`, label: `Vehicle type ${n}`, count: null, capacity: 2600, fixed_cost_cents: null, per_mile_cents: null }])
  }
  return <div className="space-y-4" data-testid="fleet-editor">
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="size-4" data-testid="fleet-enabled" checked={fleet !== undefined} onChange={e => onChange(e.target.checked ? [{ ...TRAILER }] : undefined)} />Use a fleet of vehicle types</label>
      {fleet === undefined && <span className="text-muted-foreground text-xs">Off: every shipment is one 53 ft trailer, as many as needed.</span>}
    </div>
    {fleet !== undefined && <>
      <p className="text-muted-foreground text-xs text-pretty">Each cluster is solved with one PyVRP vehicle type per row. Counts cover the whole dispatch, so clusters are solved in order against the vehicles earlier ones left, and the plan is checked again across clusters. A blank count is unlimited. The trailer capacity setting is not used.</p>
      <div className="space-y-3">
        {fleet.map((type, index) => <div key={index} className="rounded-lg border p-3" data-testid="fleet-row">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex min-w-0 flex-col gap-1.5 text-sm"><span className="font-medium">Label</span><Input aria-label={`Vehicle type ${index + 1} label`} data-testid="fleet-label" value={type.label} onChange={e => set(index, { label: e.target.value })} /></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm"><span className="font-medium">Count (blank = unlimited)</span><DraftNumber label={`Vehicle type ${index + 1} count`} testId="fleet-count" value={type.count} parse={parseWhole} show={whole} onCommit={value => set(index, { count: value })} placeholder="Unlimited" /></label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm"><span className="font-medium">Length (ft)</span><DraftNumber label={`Vehicle type ${index + 1} length in feet`} testId="fleet-capacity" value={type.capacity} parse={text => { const v = parseFeet(text); return v === undefined || v === null ? undefined : v }} show={feet} onCommit={value => value !== null && set(index, { capacity: value })} /></label>
          </div>
          <details className="mt-3"><summary className="text-muted-foreground cursor-pointer text-xs font-medium">Advanced: ID and cost rates</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="flex min-w-0 flex-col gap-1.5 text-sm"><span className="font-medium">ID</span><Input aria-label={`Vehicle type ${index + 1} ID`} data-testid="fleet-id" value={type.id} onChange={e => set(index, { id: e.target.value })} /></label>
              <label className="flex min-w-0 flex-col gap-1.5 text-sm"><span className="font-medium">Fixed cost (cents)</span><DraftNumber label={`Vehicle type ${index + 1} fixed cost in cents`} testId="fleet-fixed" value={type.fixed_cost_cents} parse={parseWhole} show={whole} onCommit={value => set(index, { fixed_cost_cents: value })} placeholder="Lowest cost only" /></label>
              <label className="flex min-w-0 flex-col gap-1.5 text-sm"><span className="font-medium">Cost per mile (cents)</span><DraftNumber label={`Vehicle type ${index + 1} cost per mile in cents`} testId="fleet-mile" value={type.per_mile_cents} parse={parseWhole} show={whole} onCommit={value => set(index, { per_mile_cents: value })} placeholder="Lowest cost only" /></label>
            </div>
          </details>
          <div className="mt-3"><Button size="sm" variant="outline" disabled={fleet.length === 1} onClick={() => onChange(fleet.filter((_, i) => i !== index))}>Remove {type.label || `type ${index + 1}`}</Button></div>
        </div>)}
      </div>
      <Button size="sm" variant="outline" data-testid="fleet-add" disabled={fleet.length >= MAX_FLEET_TYPES} onClick={add}>Add vehicle type</Button>
      {problems.length > 0 && <ul className="text-destructive-foreground list-disc space-y-1 pl-5 text-xs" role="alert" data-testid="fleet-problems">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
    </>}
  </div>
}
