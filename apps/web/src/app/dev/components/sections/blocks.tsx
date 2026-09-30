"use client"

import { Maximize2 } from "lucide-react"

import { Button } from "@/components/ui/button"

import { ComparisonBlock } from "../blocks/comparison"
import { KExplorerBlock } from "../blocks/k-explorer"
import { OrdersInventoryBlock } from "../blocks/orders-inventory"
import { ResultsBlock } from "../blocks/results"
import { RunPipelineBlock } from "../blocks/run-pipeline"
import { FullscreenContext } from "../blocks/shell"
import { WorkbenchBlock } from "../blocks/workbench"
import { Group, Specimen } from "../specimen"

const flush = "p-0 overflow-hidden"

// Block ids match the gallery toc (`toc.ts`) and the full-screen route `/dev/blocks/[id]`.
export const blocks = {
  workbench: {
    Block: WorkbenchBlock,
    title: "Workbench",
    description: "Results section: cluster map, inspector (cluster → trucks → one truck's load), and the cluster's order lines. Click a stop, a truck, or a cluster swatch.",
  },
  "orders-inventory": {
    Block: OrdersInventoryBlock,
    title: "Orders & inventory",
    description: "Data section: what was imported, coordinate provenance, stock against demand, and every order line.",
  },
  "run-pipeline": {
    Block: RunPipelineBlock,
    title: "Run pipeline",
    description: "Resolved settings with their sources, preflight, and the live stage view. Press Run pipeline in the header.",
  },
  results: {
    Block: ResultsBlock,
    title: "Results",
    description: "Run summary, then clusters and their truck loads, unshipped reasons, and the map. Replaces reading the raw output by hand.",
  },
  "k-explorer": {
    Block: KExplorerBlock,
    title: "k explorer",
    description: "Clustering only, k 3–12 × seeds 0–9. Pick a k from the chart or table; the map colors stops by assignment confidence at that k.",
  },
  comparison: {
    Block: ComparisonBlock,
    title: "Iteration comparison",
    description: "A sweep of nine runs. Tick two rows to diff their settings and see metric deltas.",
  },
}

export type BlockId = keyof typeof blocks

export function Blocks() {
  return (
    <Group
      id="blocks"
      load="windowed"
      index={6}
      title="Blocks"
      description="Full screens composed from the components above, on the same fixture run. These are the M2 design candidates for the pipeline: the user reviews them before M3 builds them for real."
    >
      {Object.entries(blocks).map(([id, { Block, title, description }]) => (
        <Specimen
          key={id}
          id={id}
          title={title}
          bodyClassName={flush}
          description={description}
          actions={
            <Button variant="outline" size="xs" className="gap-1.5" render={<a href={`/dev/blocks/${id}`} target="_blank" rel="noreferrer" />}>
              <Maximize2 /> Open full screen
            </Button>
          }
        >
          <Block />
        </Specimen>
      ))}
    </Group>
  )
}

/** One block filling the viewport, for review and screenshots. */
export function FullscreenBlock({ id }: { id: BlockId }) {
  const { Block } = blocks[id]
  return (
    <FullscreenContext value={true}>
      <Block />
    </FullscreenContext>
  )
}
