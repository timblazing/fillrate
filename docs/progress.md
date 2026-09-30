# Progress

## Milestones (spec §15)
- [ ] **M1 Thin durable fulfillment slice**
  - [x] Monorepo skeleton, root Bun workspace, git
  - [x] `apps/web`: Next.js 16 + Tailwind 4 + coss ui (Base UI) + mapcn, light/dark/system theme (migrated from shadcn radix-nova on 2026-09-29)
  - [x] Component gallery at `/dev/components`
  - [x] Gallery expanded into the design-system reference: Foundations, Primitives, Lab components (`src/components/lab`), Charts (Recharts + bklit), Map, Blocks
  - [x] Gallery rebuilt for spec v1.3 (2026-09-29): every specimen runs on one synthetic 2,000-order fixture pipeline
  - [x] Blocks open full screen at `/dev/blocks/<id>` for review screenshots
  - [x] Build-progress dashboard at `/dev` (static; parses the spec and docs, estimates in `apps/web/src/app/dev/status.ts`), shared `/dev` header with the app icon
  - [x] `AGENTS.md`, `CLAUDE.md`, `docs/decisions.md`, `docs/progress.md`
  - [x] Pinned Python 3.13 / uv / PyVRP / OR-Tools / scikit-learn / FastAPI (`services/optimizer`), `/health` + `/capabilities`
  - [x] PyVRP capability fixtures: capacity, fixed truck cost, open routes (workaround), prohibited legs (preprocessing + validator)
  - [x] Drizzle schema + migrations, SQLite pragmas, migrate-on-start (`packages/db`)
  - [x] Generated persistence/stage envelope contracts (`packages/contracts`), database claim/lease fencing
  - [x] Authenticated loopback worker transport (`packages/db/src/transport.ts`, 127.0.0.1:3100, bearer token) and Python supervisor (`fillrate-worker`; child process per run, killed on cancel)
  - [x] Durable synthetic fulfillment slice: preflight → allocate → aggregate → cluster/repair → travel/reachability → real PyVRP → independent validation → summary, persisted as nine content-addressed stage artifacts; `/runs` map/table screens; JSON and CSV export
  - [x] Spec v1.6 integration: truck-count-first objective with derived bound F = n·L + 1, graph reachability instead of depot-radius filtering (`unreachable` vs `unreachable_in_partition`), versioned stage manifests, independent metric reconstruction and per-product reconciliation
  - [x] Web `Dockerfile` (Next.js standalone, port 3000) and manual `image.yml` → `ghcr.io/timblazing/fillrate:latest`
  - [x] Single image with web + optimizer + worker (tini, `deploy/entrypoint.sh`), `HEALTHCHECK`, `deploy/smoke.sh`; arm64 image built and smoke-tested locally once (2026-09-30)
  - [x] `ci.yml` (lint, typecheck, Vitest incl. Python worker e2e, pytest, Ruff, contract drift, build) and `image.yml` (after CI on `main`, tags, manual; native amd64 + arm64 runners, smoke before push, multi-arch manifest from tested digests)
  - [ ] First green `ci.yml` and `image.yml` runs on GitHub (both architectures pass the smoke run) — the last M1 exit evidence
- [ ] **M2 Design** (in progress in `fillrate.fig` via OpenPencil; see below). Blocks now center on the pipeline screens (spec v1.3 §15).
- [ ] M3 Operational core (CSV/versioned scenarios → real pipeline screens, per-cluster jobs, stage reuse, 2,000-order benchmark)
- [ ] M4 Experiments / first release (k explorer, bounded sweeps, comparison signatures, partition bounds, H3 layer/baseline, lesson and small Python replay export)
- [ ] M5 Allocation depth and imports (CP-SAT, other strategies, whole-order mode, geocoding)
- [ ] M6 Remaining PyVRP features and roads (Valhalla, `truck` costing)
- [ ] M7 Learning and exports
- [ ] M8 Verification and handoff

## Current state

Spec **v1.7** is the implementation target. Fillrate is a public GitHub project; public writes and real-data use still need access, isolation and abuse controls before launch (spec §14).

**M1 is complete in code, pending its first GitHub Actions runs.** A real synthetic run now goes end to end: `POST /api/v1/runs` (idempotency key; production requires `RUN_KEY`) → SQLite job → the Python supervisor claims it over the loopback transport → a child process runs the pipeline (`services/optimizer/src/fillrate_optimizer/pipeline.py`) → nine stage artifacts and the run summary commit atomically → `/runs/<id>` shows the map, clusters, truck loads, unplanned lines with evidence, per-product reconciliation and provenance, with JSON/CSV export. The bundled scenario is `examples/m1-synthetic.json` (Memphis DC, 69 orders; regenerate with `uv run python -m fillrate_optimizer.synthetic`). It exercises stock shortage, a split oversize stop, a 396 + 198 mi chain to a stop 594 mi from the depot (planned), an isolated unreachable stop, an unresolved coordinate and an oversize piece.

Verification (2026-09-30): optimizer pytest 49 passed; Vitest 22 passed, including transport auth/fencing tests and three end-to-end tests with the real Python worker (success + reconciliation; cancel kills the solver and frees the worker; SIGKILLed worker → lease expiry → attempt 2 on a new worker); Ruff, lint, typecheck, build and contract regeneration pass. A production `next start` + worker run solved, validated and exported in about 2 s; production without `RUN_KEY` refuses submissions. The arm64 image built and passed `deploy/smoke.sh` locally; amd64 and the workflows themselves have not run yet.

Run locally: `bun run dev` in one terminal and `bun run worker` in another, then open `/runs`. The web process writes `data/worker.token` for the native worker.

The gallery (`src/app/dev/components`) is rebuilt around the v1.3 fulfillment pipeline. Every specimen reads one deterministic synthetic scenario (`fixtures/`: Memphis DC, 2,000 orders / 2,829 lines, 640 accounts, six SKUs with scarce stock) run through a TypeScript stand-in of the pipeline: piece-level "order date, then value" allocation, stop aggregation and trailer splits, k-means on 3D unit vectors with auto-k and bisecting diameter repair, a sweep heuristic standing in for PyVRP truck loads, metrics, and unshipped reasons. A k-explorer fixture (k 3–12 × seeds 0–9, inertia, ARI stability, co-assignment confidence) and a nine-run sweep with non-dominated marking feed the comparison views. The fixture is gallery-only; the real pipeline is Python (small synthetic slice in M1, operational expansion in M3).

Sections: Foundations (adds status colors and fill bands), Primitives (pipeline copy), Fulfillment components, Charts, Map (pipeline map + confidence map), Blocks (Workbench, Orders & inventory, Run pipeline, Results, k explorer, Iteration comparison), and Later milestones (route timeline, matrix inspector with prohibited legs).

The gallery page loads specimens on demand: each specimen's body mounts when it comes within one viewport of the screen (`Specimen` `load`, default `lazy`). The Charts, Map, and Blocks groups are `windowed`, so they also unmount when scrolled away and free their WebGL contexts. Measured in Chromium at 1440×900: JS heap after load went from 84 MB to 24 MB, DOM nodes from 33k to 2.5k, and live maps from 4 to 0. After scrolling to the bottom, heap went from 102 MB to 62 MB. `toc` moved to `components/toc.ts` so the server route `/dev/blocks/[id]` can import it.

Communication pass (2026-09-30, from the premium-planner research): new `PlanFlow`, `RunCompare`, `EditSession`, `FillBandLegend`; stage outputs; grouped section tabs; workbench Loads/Order lines/Unshipped tabs with View presets; timeline unassigned pool; trade-off label cleanup. See `docs/decisions.md`.

Lab components (`src/components/lab`): new `ClusterCard`/`LimitBar`/`TruckFillStrip`, `TrailerFill`/`FillMeter`/`FillPercent`, `TruckLoad`, `UnshippedLines`, `PipelineStages`, `RunMetricGroups`, `IterationTable`, `StockTable`, `LineStateBadge`, `StopPointsLayer`/`FitBounds` (map), `ClusterSwatch`/`ClusterLegend`/`TruckTag`; `DataTable` gained pagination; `CoordinateSourceBadge` gained `unresolved`; status colors moved to the coss `--info/--success/--warning/--destructive-foreground` tokens. Shared units/formatting in `src/lib/units.ts`, provisional pipeline types in `src/lib/fulfillment.ts` (to be replaced by generated contracts).

## Design workflow (M2 prep)
1. **Foundations** page in `fillrate.fig`: variables named exactly like the CSS tokens in `apps/web/src/app/globals.css` (light + dark modes), plus type scale, radius, spacing, and `route-1..8`.
2. Export tokens → `globals.css`; check them in `/dev/components`.
3. **Components**: coss ui/mapcn components bound to those variables, compared against the gallery.
4. **Blocks**: app shell, orders and inventory, run pipeline, k explorer, cluster cards, truck loads, unshipped reasons, iteration comparison, and map (spec v1.3 §8a, §10). Route timeline is secondary.
5. Record the accepted direction in `docs/decisions.md`. M2 then builds the Blocks as real React screens.

## Known gaps
- The home page (`/`) is a minimal placeholder: a spinning cobe globe (`components/animated/globe-card.tsx`) linking to the GitHub repo. The component gallery (`/dev/components`, `/dev/blocks/<id>`) is now served in production too, but is not linked from `/`.
- SQLite lives in `/app/data` (not the spec's `/data`, kept for the existing review deployment) and is ephemeral unless a volume is mounted there.
- The travel artifact stores each cluster's full matrix as JSON; fine for M1, but a 500-stop cluster approaches the 8 MiB artifact cap. Chunked/binary matrix artifacts are M3 work.
- Stage reuse/caching is not implemented: every run recomputes all stages (manifests record input hashes for M3 reuse).
- The pipeline stores integer-meter matrices from haversine × circuity only; no service-radius policy (disabled by default per spec) and no Valhalla.
- A capacity-forced prohibited leg (B reachable only via A, but A + B exceed a trailer) ends as "no valid candidate": PyVRP prefers an overloaded infeasible route over a MAX_VALUE edge. Correctly reported, never counted as planned.
- No Playwright browser smoke yet (spec §14 CI item); the image smoke covers the public API only.
- Run settings exposed publicly are only k, k-means seed and solver seed; everything else comes from the bundled example.
- The legacy `solve_loads` spike in `loads.py` keeps its zero default truck penalty for its capability fixtures; the pipeline uses `solve_partition` with the derived penalty and shared location nodes. The gallery still uses its v1.3 TypeScript stand-in.
- The prior decision suggesting all stops beyond 500 miles from the depot should be dropped is superseded: with a per-leg constraint, an intermediate visit may make such a stop reachable. Spec §7 defines the distinction.
- Truck-count-first priority and no separate depot radius are provisional v1.6 defaults; the owner's two clarifying questions were still unanswered when the draft was written. Existing friend questionnaire items remain pending below.
- If uv fails with "Bad CPU type" from a Python 2.7 framework install on PATH, set `UV_PYTHON=python3.13`.
- Chart and route palettes are placeholders (neutral shadcn chart colors, provisional route colors). Gallery charts use `--route-*` for series until a real chart palette lands.
- New tokens `--chart-background/-foreground/-foreground-muted/-label/-grid` (aliases for bklit) and the coss status tokens `--info/--success/--warning(-foreground)`, `--destructive-foreground` are not on the OpenPencil Foundations page yet.
- bklit radar logs harmless motion "undefined is not animatable" warnings in dev (vendored code).
- `MatrixHeatmap` renders every cell; 500-stop matrices will need virtualization.
- Spec v1.3: the per-piece value tiebreak and combining orders at one address are still assumptions, and there is no sample data from the primary user yet (see the `docs/decisions.md` follow-up entry).
- Chart recipes shared by charts and blocks live in `src/app/dev/components/recipes.tsx` until contracts exist.
- The gallery fixture's truck loads come from a sweep heuristic, not PyVRP; numbers are illustrative of shape, not solver quality.
- The Blocks are M2 design candidates and still need the user's review and acceptance (spec §15).
- The project is now targeted for public access. Public scenario writes, real customer data, and solver submissions need identity/data isolation, limits, and abuse controls before launch (spec v1.7 §14).
- Vitest persistence/contract tests and optimizer pytest exist. Playwright end-to-end pipeline coverage remains for the next slice.
- The OpenPencil Components page still mirrors shadcn components; it needs redoing against coss ui (see the gallery).
- `components/ui/chart.tsx` and `resizable.tsx` are still shadcn (coss has no equivalent).

## Waiting on the primary user (come back to this)
The Google Form is superseded by the in-app review at `/dev/review?key=<REVIEW_KEY>` (25 questions over the revised Blocks). Responses: `/dev/review/responses?key=…` (JSON at `/dev/review/responses/json?key=…`). Deploying it needs a `/app/data` volume and `REVIEW_KEY` in compose. When answers arrive:
- Record the accepted design direction and any requested changes in `docs/decisions.md`, then tick M2's review step.
- Close the open v1.3 assumptions it also asks about: value tiebreak per piece vs. order total, and whether orders at one address combine into one stop.
- Use his example rows (dummy values) to confirm the order and inventory CSV columns for M3 imports.

## Next step
Push to `main` and get `ci.yml` and `image.yml` green on both architectures; fix whatever the first runs expose, then tick M1. After that, M3: CSV import, scenario editing/versioning, real pipeline screens replacing the gallery stand-ins, stage reuse, and the 2,000-order benchmark. Design-review answers still gate M2 acceptance.
