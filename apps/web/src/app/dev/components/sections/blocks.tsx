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

// Block ids match the gallery toc (`specimen.tsx`) and the full-screen route `/dev/blocks/[id]`.
const blocks = {
  workbench: {
    Block: WorkbenchBlock,
    title: "Workbench",
    spec: "§4 §10",
    description: "Results section: cluster map, inspector (cluster → trucks → one truck's load), and the cluster's order lines. Click a stop, a truck, or a cluster swatch.",
  },
  "orders-inventory": {
    Block: OrdersInventoryBlock,
    title: "Orders & inventory",
    spec: "§4 §6 §8",
    description: "Data section: what was imported, coordinate provenance, stock against demand, and every order line.",
  },
  "run-pipeline": {
    Block: RunPipelineBlock,
    title: "Run pipeline",
    spec: "§8a §9",
    description: "Resolved settings with their sources, preflight, and the live stage view. Press Run pipeline in the header.",
  },
  results: {
    Block: ResultsBlock,
    title: "Results",
    spec: "§10",
    description: "Run summary, then clusters and their truck loads, unshipped reasons, and the map. Replaces reading the raw output by hand.",
  },
  "k-explorer": {
    Block: KExplorerBlock,
    title: "k explorer",
    spec: "§8a",
    description: "Clustering only, k 3–12 × seeds 0–9. Pick a k from the chart or table; the map colors stops by assignment confidence at that k.",
  },
  comparison: {
    Block: ComparisonBlock,
    title: "Iteration comparison",
    spec: "§8a §10",
    description: "A sweep of nine runs. Tick two rows to diff their settings and see metric deltas.",
  },
}

export type BlockId = keyof typeof blocks

export function Blocks() {
  return (
    <Group
      id="blocks"
      index={6}
      title="Blocks"
      description="Full screens composed from the components above, on the same fixture run. These are the M2 design candidates for the pipeline (spec §15): the user reviews them before M3 builds them for real."
    >
      {Object.entries(blocks).map(([id, { Block, title, spec, description }]) => (
        <Specimen
          key={id}
          id={id}
          title={title}
          spec={spec}
          bodyClassName={flush}
          description={description}
          actions={
            <Button variant="outline" size="xs" render={<a href={`/dev/blocks/${id}`} target="_blank" rel="noreferrer" />}>
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
