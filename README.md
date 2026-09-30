# Fillrate

Private web workbench for planning order-fulfillment truckloads. Fillrate allocates scarce inventory to open orders piece by piece, groups the stops with k-means, builds 53 ft truckloads per cluster with [PyVRP](https://github.com/PyVRP/PyVRP), and compares iterations on truck fill, cluster tightness, and revenue. Every result explains itself: cluster cards, truck loads, and a reason for each line that didn't ship.

Served privately at `fillrate.blasingame.dev`. See `fillrate-technical-spec.md` for the full specification and `docs/progress.md` for current status.

```sh
bun install
bun run dev    # http://localhost:3000, component gallery at /dev/components
```
