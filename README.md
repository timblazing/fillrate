<h1 align="center">Fillrate</h1>

<p align="center">An open source workbench for order fulfillment and truckload planning.</p>

<p align="center">
  <a href="https://fillrate.blasingame.dev">Website</a> ·
  <a href="docs/local.md">Run locally</a> ·
  <a href="https://github.com/timblazing/fillrate/issues">Report an issue</a> ·
  <a href="LICENSE">MIT license</a>
</p>

Allocate limited inventory to open orders, group delivery stops, and build trailer loads. Compare plans by revenue, trailer fill, shipment count, and travel distance to see how different assumptions change the result.

## What you can do

- **Bring your own data.** Import orders and inventory from CSV, or start with a bundled example. Review locations and save scenario versions.
- **Build a fulfillment plan.** Choose an allocation strategy, cluster delivery stops, and solve loads with capacity, time-window, and fleet constraints.
- **Compare alternatives.** Try different allocations, cluster counts, capacities, and solver seeds. Rank comparable plans by the measures you care about.
- **Inspect the result.** Explore delivery clusters, shipments, trailer utilization, and orders left unshipped. Review routes and adjust visit order with the manual plan editor.
- **Take your work with you.** Export JSON, CSV, GeoJSON routes, and Python replay bundles.

## Compare plans

See revenue, fill, distance, and shipment counts side by side, and choose your own ranking priorities.

## Explore delivery clusters

Compare cluster counts and see how consistently locations group together across solver seeds.

Travel can use geographic estimates or a road matrix; maps and results identify the method used.

## Use Fillrate

The [hosted app](https://fillrate.blasingame.dev) is available by request. You can also [run Fillrate locally](docs/local.md) with Bun, npm, or Docker, without an account.

Built with Next.js, SQLite, and Python, using [PyVRP](https://pyvrp.org/) for routing and [OR-Tools](https://developers.google.com/optimization) for allocation.

## License

[MIT](LICENSE)
