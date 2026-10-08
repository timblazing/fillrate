<h1 align="center">Fillrate</h1>

<p align="center">An open source tool for allocating scarce inventory and building full truckloads.</p>

<p align="center">
  <a href="https://fillrate.blasingame.dev">Website</a> ·
  <a href="#run-it-locally">Run locally</a> ·
  <a href="https://github.com/timblazing/fillrate/issues">Report an issue</a> ·
  <a href="LICENSE">MIT license</a>
</p>

Allocate limited inventory to open orders, group delivery stops, and build trailer loads with a real vehicle-routing solver. Then compare plans by revenue, trailer fill, truck count and miles.

> Fillrate is being simplified. See [`docs/product.md`](docs/product.md) for the direction.

## Features

- **CSV import.** Orders and inventory from CSV, or start from the bundled example. Addresses geocode with the free US Census geocoder, with a labeled ZIP fallback.
- **Allocation.** Piece-level allocation of short stock by order date, then value.
- **Clustering.** k-means on stop locations, with a k and seed explorer to check how stable the grouping is.
- **Load building.** [PyVRP](https://pyvrp.org/) builds loads per cluster using linear-foot capacity, open routes, a per-leg mile limit and optional time windows.
- **Validation.** An independent validator checks every plan and explains why each line did or didn't ship.
- **Map and inspection.** Cluster map, per-shipment timeline and optional road path display via the public Valhalla server (display only, drawn by your browser on request; routing © Valhalla / FOSSGIS, data © OpenStreetMap contributors).
- **Comparison.** Put runs side by side on fill, revenue, trucks and miles.
- **Exports.** JSON, CSV, GeoJSON and a Python replay bundle that reproduces a run with PyVRP.

Distances are estimated as straight-line miles × a circuity factor (default 1.2). Roads never feed the optimizer.

## Run it locally

Local Fillrate is single-user with no account. Keep it on your own machine for real data.

**Docker:**

```sh
mkdir -p data
docker run --rm -p 127.0.0.1:3000:3000 \
  -v "$PWD/data:/app/data" ghcr.io/timblazing/fillrate:latest
```

Open http://localhost:3000. Data is stored in `./data/fillrate.sqlite`.

**From source** (Node 24, [Bun](https://bun.sh), [uv](https://docs.astral.sh/uv/) with Python 3.13):

```sh
bun install
(cd services/optimizer && uv sync)
bun run dev                       # terminal 1: http://localhost:3000
bun run optimizer                 # terminal 2: the Python solver service (127.0.0.1:8000)
```

Built with Next.js, SQLite, Python and PyVRP. Contributors and coding agents, see [`AGENTS.md`](AGENTS.md).

## License

[MIT](LICENSE)
