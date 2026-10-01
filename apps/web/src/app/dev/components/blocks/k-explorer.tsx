"use client"

import { Check } from "lucide-react"
import dynamic from "next/dynamic"
import { useState } from "react"

import { Explainer } from "@/components/lab/explainer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toastManager } from "@/components/ui/toast"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

import { baseline, exploreK } from "../fixtures"
import { KElbowChart } from "../recipes"
import { AppShell, type Section } from "./shell"

const PipelineMap = dynamic(() => import("../pipeline-map"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> })

// k explorer (spec §8a "Cluster stability"): clustering-only runs over a k range × seeds, to pick a k whose
// groupings don't depend on the seed. Replaces the primary user's rerun-until-it-looks-stable loop.
export function KExplorerBlock() {
  const run = baseline()
  const explorer = exploreK()
  const [section, setSection] = useState<Section>("Cluster")
  const [range, setRange] = useState<number[]>([3, 12])
  const [k, setK] = useState(7)
  const [seed, setSeed] = useState(0)
  const [adopted, setAdopted] = useState<{ k: number; seed: number } | null>(null)
  const use = () => {
    setAdopted({ k, seed })
    toastManager.add({ type: "success", title: `Run settings: k = ${k}, seed ${seed}`, description: "The next Run pipeline uses this fixed k and k-means seed." })
  }
  const detail = explorer.detail(k)
  const confidence = new Map(explorer.stopIds.map((id, i) => [id, detail.confidence[i]]))
  const low = detail.confidence.filter((c) => c < 0.7).length
  const row = explorer.rows.find((r) => r.k === k)!
  const rows = explorer.rows.filter((r) => r.k >= range[0] && r.k <= range[1])
  // With the diameter policy off (spec v1.8) no k needs repair, so stability alone ranks them.
  const bestStable = [...explorer.rows].filter((r) => r.repairs === 0).sort((a, b) => b.stability - a.stability)[0]
  const anyRepairs = explorer.rows.some((r) => r.repairs > 0)

  return (
    <AppShell section={section} onSection={setSection} height={820}>
      <div className="grid h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ScrollArea className="border-r">
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-56 space-y-2">
                <Label className="text-xs">
                  k range <span className="text-muted-foreground font-mono">{range[0]}–{range[1]}</span>
                </Label>
                <Slider value={range} onValueChange={(v) => setRange(v as number[])} min={2} max={16} step={1} aria-label="k range" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Seeds</Label>
                <Input defaultValue="0–9" className="w-24 font-mono" size="sm" />
              </div>
              <div className="text-muted-foreground text-xs">
                {rows.length * explorer.seeds.length} clustering runs · {explorer.stopIds.length} stops
              </div>
            </div>

            <div className="bg-card rounded-xl border p-3">
              <KElbowChart rows={rows} chosen={k} onChoose={setK} />
            </div>

            <table className="bg-card w-full overflow-hidden rounded-xl border text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="px-3 py-2 text-left font-medium">k</th>
                  <th className="px-3 py-2 text-right font-medium">Variance (mi²)</th>
                  {anyRepairs && <th className="px-3 py-2 text-right font-medium">Need repair</th>}
                  <th className="px-3 py-2 text-right font-medium">
                    <span className="inline-flex items-center gap-1">
                      Stability
                      <Explainer
                        term="Seed stability"
                        meaning="Mean adjusted Rand index between every pair of seeds' assignments. 1 means every seed produced the same grouping."
                        units="−0.5 to 1"
                        example="0.78: most stops keep the same neighbors across seeds"
                        field="k explorer (descriptive statistic)"
                      />
                    </span>
                  </th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.k}
                    onClick={() => setK(r.k)}
                    className={cn("hover:bg-muted/40 cursor-pointer border-b transition-colors last:border-0", r.k === k && "bg-muted")}
                  >
                    <td className="px-3 py-1.5 font-mono font-medium">{r.k}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">{(r.inertia / 1_000_000).toFixed(1)}M</td>
                    {anyRepairs && (
                      <td className={cn("px-3 py-1.5 text-right font-mono text-xs tabular-nums", r.repairs && "text-warning-foreground")}>{r.repairs}</td>
                    )}
                    <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">
                      <span className="inline-flex items-center gap-2">
                        <span className="bg-muted h-1.5 w-16 overflow-hidden rounded-full">
                          <span className="bg-route-1 block h-full" style={{ width: `${Math.max(0, (r.stability - 0.5) / 0.5) * 100}%` }} />
                        </span>
                        {r.stability.toFixed(2)}
                      </span>
                    </td>
                    <td className="pr-3 text-right">
                      {r.k === bestStable.k && (
                        <Badge variant="success" size="sm">
                          best stable
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ScrollArea>

        <div className="flex min-h-0 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b p-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                k = {k} · stability {row.stability.toFixed(2)}
                {row.repairs ? ` · ${row.repairs} clusters over the diameter policy` : ""}
              </div>
              <div className="text-muted-foreground text-xs">
                {low} of {explorer.stopIds.length} stops below 70% confidence (red) · reference seed {seed}
              </div>
            </div>
            <Label className="text-muted-foreground gap-1.5 text-xs font-normal">
              Seed
              <Input
                type="number"
                min={0}
                max={9}
                value={seed}
                onChange={(e) => setSeed(Math.max(0, Math.min(9, Number(e.target.value) || 0)))}
                className="w-16 font-mono"
                size="sm"
              />
            </Label>
            <Button size="sm" variant={adopted?.k === k && adopted.seed === seed ? "outline" : "default"} onClick={use}>
              {adopted?.k === k && adopted.seed === seed ? (
                <>
                  <Check /> In run settings
                </>
              ) : (
                `Use this k`
              )}
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            <PipelineMap key={k} embedded run={run} confidence={confidence} defaultMode="confidence" selectedCluster={null} />
          </div>
        </div>
      </div>
    </AppShell>
  )
}
