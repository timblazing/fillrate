"use client"

import { ComparisonBlock } from "../blocks/comparison"
import { KExplorerBlock } from "../blocks/k-explorer"
import { OrdersInventoryBlock } from "../blocks/orders-inventory"
import { ResultsBlock } from "../blocks/results"
import { RunPipelineBlock } from "../blocks/run-pipeline"
import { WorkbenchBlock } from "../blocks/workbench"
import { Group, Specimen } from "../specimen"

const flush = "p-0 overflow-hidden"

export function Blocks() {
  return (
    <Group
      id="blocks"
      index={6}
      title="Blocks"
      description="Full screens composed from the components above, on the same fixture run. These are the M2 design candidates for the pipeline (spec §15): the user reviews them before M3 builds them for real."
    >
      <Specimen id="workbench" title="Workbench" spec="§4 §10" bodyClassName={flush} description="Results section: cluster map, inspector (cluster → trucks → one truck's load), and the cluster's order lines. Click a stop, a truck, or a cluster swatch.">
        <WorkbenchBlock />
      </Specimen>
      <Specimen id="orders-inventory" title="Orders & inventory" spec="§4 §6 §8" bodyClassName={flush} description="Data section: what was imported, coordinate provenance, stock against demand, and every order line.">
        <OrdersInventoryBlock />
      </Specimen>
      <Specimen id="run-pipeline" title="Run pipeline" spec="§8a §9" bodyClassName={flush} description="Resolved settings with their sources, preflight, and the live stage view. Press Run pipeline in the header.">
        <RunPipelineBlock />
      </Specimen>
      <Specimen id="results" title="Results" spec="§10" bodyClassName={flush} description="Run summary, then clusters and their truck loads, unshipped reasons, and the map. Replaces reading the raw output by hand.">
        <ResultsBlock />
      </Specimen>
      <Specimen id="k-explorer" title="k explorer" spec="§8a" bodyClassName={flush} description="Clustering only, k 3–12 × seeds 0–9. Pick a k from the chart or table; the map colors stops by assignment confidence at that k.">
        <KExplorerBlock />
      </Specimen>
      <Specimen id="comparison" title="Iteration comparison" spec="§8a §10" bodyClassName={flush} description="A sweep of nine runs. Tick two rows to diff their settings and see metric deltas.">
        <ComparisonBlock />
      </Specimen>
    </Group>
  )
}
