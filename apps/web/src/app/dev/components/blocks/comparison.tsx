"use client"

import { Plus } from "lucide-react"
import { useState } from "react"

import { IterationTable } from "@/components/lab/iteration-table"
import { RunCompare } from "@/components/lab/run-compare"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

import { iterations, settingsDiff } from "../fixtures"
import { TradeoffChart } from "../recipes"
import { AppShell } from "./shell"

// Iteration comparison (spec §8a, §10): the sweep table, the trade-off plot, and a PTV-style A vs B comparison.
export function ComparisonBlock() {
  const sweep = iterations()
  const [selected, setSelected] = useState<string[]>(["run-0212", "run-0220"])
  const [aId, bId] = selected.length === 2 ? selected : [selected[0] ?? "run-0212", selected[0] ?? "run-0212"]
  const a = sweep.find((r) => r.id === aId)!
  const b = sweep.find((r) => r.id === bId)!

  return (
    <AppShell
      active="Experiments"
      crumb="Sweep · Sep 29"
      height={1180}
      actions={
        <Button size="sm">
          <Plus /> Add runs
        </Button>
      }
    >
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{sweep.length} runs</span>
            <span className="text-muted-foreground">of 25 max · same scenario v14 and matrix · varied:</span>
            {/* What the primary user varies leads (design review `compare.vary`); the rest sits under More. */}
            {["k", "seed", "inventory available", "mileage"].map((v) => (
              <Badge key={v} variant="outline">
                {v}
              </Badge>
            ))}
            <Badge variant="outline" className="text-muted-foreground border-dashed">
              More: allocation rule, n_init
            </Badge>
            <span className="text-muted-foreground ml-auto text-xs">
              ★ {sweep.filter((r) => r.nonDominated).length} best trade-off · sorted by planned revenue · tick two runs to compare
            </span>
          </div>

          <IterationTable rows={sweep} baselineId="run-0212" selected={selected} onSelectedChange={setSelected} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <section className="bg-card h-fit space-y-2 rounded-xl border p-4">
              <h3 className="text-sm font-medium">Trade-off</h3>
              <TradeoffChart runs={sweep} highlight={selected} />
            </section>
            {selected.length === 2 ? (
              <RunCompare a={a} b={b} settings={settingsDiff(a, b)} scenarioLabel="Same scenario v14 · same matrix" />
            ) : (
              <div className="text-muted-foreground flex items-center justify-center rounded-xl border border-dashed p-8 text-sm">
                Tick two runs in the table to compare them.
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </AppShell>
  )
}
