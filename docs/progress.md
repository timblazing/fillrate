# Progress

## Milestones (spec §15)
- [x] **M1 Thin durable fulfillment slice**
  - [x] Monorepo skeleton, root Bun workspace, git
  - [x] `apps/web`: Next.js 16 + Tailwind 4 + coss ui (Base UI) + mapcn, light/dark/system theme (migrated from shadcn radix-nova on 2026-09-29)
  - [x] Component gallery at `/dev/components`
  - [x] Gallery expanded into the design-system reference: Foundations, Primitives, Lab components (`src/components/lab`), Charts (Recharts + bklit), Map, Blocks
  - [x] Gallery rebuilt for spec v1.3 (2026-09-29): every specimen runs on one synthetic 2,000-order fixture pipeline
  - [x] Blocks open full screen at `/dev/blocks/<id>` for review screenshots
  - [x] Build-progress dashboard at `/dev` (static snapshot that refreshes in the browser from GitHub `main`; parses the spec and docs, estimates in `docs/status.json`), shared `/dev` header with the app icon
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
  - [x] First green `ci.yml` (run 36776415077) and `image.yml` (run 36776618684): amd64 and arm64 each built natively and passed the smoke run; `latest` and `sha-953cb1c` published as a multi-arch manifest
- [ ] **M2 Accepted design** (spec v1.8 §15 "M2 scope"; implementation done 2026-09-30, waiting on round-two answers and `fillrate.fig`)
  - [x] Round-one answers recorded (`docs/reviews/fillrate-design-review-2026-09-30.json`, spec v1.8, `docs/decisions.md`)
  - [x] Wording in one copy module (`src/lib/copy.ts`): Cluster / Shipment / Unshipped; internal names unchanged; CSV exports carry a header note
  - [x] Map first on `/runs/<id>`, the Results Block and the Workbench
  - [x] Fill % (`ShipmentFill`) is the per-shipment visual; the to-scale trailer moved to shipment detail and sheet
  - [x] `FILL_LOW` 0.80, `FILL_FULL` 0.90 (display-only); every legend and "Needs attention" list reads them
  - [x] Coordinate badges only for ZIP-approximate and missing; "Show all sources" toggle and "Coordinate problems" filter; map popups follow
  - [x] Stock coverage: pieces short, fill rate %, shorted orders; on hand and dollars short in a popover
  - [x] "Steps" expanded by default during and after a run; collapse remembered per browser
  - [x] Blocking preflight checks in the contract (`RunSettings.preflight`, `excluded_line_ids`, `RunSummary.preflight`, reason `excluded_by_user`), enforced by the pipeline (`preflight_blocked`), and in the Run pipeline Block with the three resolutions; the bundled example declares them as warnings
  - [x] Revenue first: metric groups, run headline, iteration table default sort, A/B comparison
  - [x] Four unshipped groups (no stock, beyond the 500 mi leg limit, did not fit, bad or missing address data), "Other" only when present
  - [x] Shipment sheet: `/runs/<id>/sheet` (one per page, black-and-white print, optional location/pieces columns) and `export?format=csv&table=sheet`
  - [x] k explorer "Use this k" carries k and seed; sweeps lead with k, seed, inventory and mileage, the rest under "More"; changed-assumption chips
  - [x] Cost per truck / per mile and objective selector design (`ObjectiveSettings`), with the fallback notice
  - [x] 500-mile copy is per drive; cluster-diameter policy **off by default** in the pipeline (`max_cluster_diameter_m: null`), example uses fixed k = 4
  - [x] Revised Blocks and `/runs/<id>` checked at 1440 px and 390 px (no page-level horizontal scroll); map selections have keyboard-reachable table equivalents
  - [x] Round-two review restored at `/dev/review` with new `r2.*` question ids
  - [ ] `fillrate.fig`: Components page on coss parts; Foundations gains `--chart-*`, `--info/--success/--warning(-foreground)`, `--destructive-foreground`, fill bands (OpenPencil app was not running this session)
  - [ ] Round-two answers recorded and Blocks accepted (or changes applied and re-accepted)
- [x] **M3 Operational core** (done 2026-10-01)
  - [x] CSV preview/commit, scenario editing and versioning, real imported runs and exports
  - [x] Cost objective, customer-aware stops, blocking preflight, durable cluster checkpoints and deterministic stage reuse
  - [x] Compressed large travel artifacts and a measured 2,000-order benchmark
  - [x] A solver exception in one cluster gives an invalid partial plan; the other clusters stay validated and inspectable (spec §9)
  - [x] Production operator-key access checked against `next start` and in the image smoke (`deploy/smoke_import.py`): refusal without the key, preview → save → preflight block → excluded-line run → validated result → private export → branch → conflict
  - [x] Narrow-width (390 px) browser check: `/scenarios` and an imported `/runs/<id>` have no page-level horizontal scroll; imported run pages without access return 404
  - [x] 2,000-order benchmark inside the tested image on amd64 and arm64 GitHub runners (`image.yml` job summary and artifacts)
- [ ] M4 Experiments / first release (k explorer, bounded sweeps, comparison signatures, partition bounds, H3 layer/baseline, lesson and small Python replay export)
- [ ] M5 Allocation depth and imports (CP-SAT, other strategies, whole-order mode, geocoding)
- [ ] M6 Remaining PyVRP features and roads (Valhalla, `truck` costing)
- [ ] M7 Learning and exports
- [ ] M8 Verification and handoff

## Current state

Spec **v1.8** is the implementation target. Fillrate is a public GitHub project; public writes and real-data use still need access, isolation and abuse controls before launch (spec §14).

**M1 is complete.** A real synthetic run now goes end to end: `POST /api/v1/runs` (idempotency key; production requires `RUN_KEY`) → SQLite job → the Python supervisor claims it over the loopback transport → a child process runs the pipeline (`services/optimizer/src/fillrate_optimizer/pipeline.py`) → nine stage artifacts and the run summary commit atomically → `/runs/<id>` shows the map, clusters, truck loads, unplanned lines with evidence, per-product reconciliation and provenance, with JSON/CSV export. The bundled scenario is `examples/m1-synthetic.json` (Memphis DC, 69 orders; regenerate with `uv run python -m fillrate_optimizer.synthetic`). It exercises stock shortage, a split oversize stop, a 396 + 198 mi chain to a stop 594 mi from the depot (planned), an isolated unreachable stop, an unresolved coordinate and an oversize piece.

Verification (2026-09-30): optimizer pytest 49 passed; Vitest 22 passed, including transport auth/fencing tests and three end-to-end tests with the real Python worker (success + reconciliation; cancel kills the solver and frees the worker; SIGKILLed worker → lease expiry → attempt 2 on a new worker); Ruff, lint, typecheck, build and contract regeneration pass. A production `next start` + worker run solved, validated and exported in about 2 s; production without `RUN_KEY` refuses submissions. In GitHub Actions, CI passed (including the worker e2e tests) and both image architectures passed `deploy/smoke.sh` before publishing.

Run locally: `bun run dev` in one terminal and `bun run worker` in another, then open `/runs`. The web process writes `data/worker.token` for the native worker.

The gallery (`src/app/dev/components`) is rebuilt around the v1.3 fulfillment pipeline. Every specimen reads one deterministic synthetic scenario (`fixtures/`: Memphis DC, 2,000 orders / 2,829 lines, 640 accounts, six SKUs with scarce stock) run through a TypeScript stand-in of the pipeline: piece-level "order date, then value" allocation, stop aggregation and trailer splits, k-means on 3D unit vectors with auto-k and bisecting diameter repair, a sweep heuristic standing in for PyVRP truck loads, metrics, and unshipped reasons. A k-explorer fixture (k 3–12 × seeds 0–9, inertia, ARI stability, co-assignment confidence) and a nine-run sweep with non-dominated marking feed the comparison views. The fixture is gallery-only; the real pipeline is Python (small synthetic slice in M1, operational expansion in M3).

Sections: Foundations (adds status colors and fill bands), Primitives (pipeline copy), Fulfillment components, Charts, Map (pipeline map + confidence map), Blocks (Workbench, Orders & inventory, Run pipeline, Results, k explorer, Iteration comparison), and Later milestones (route timeline, matrix inspector with prohibited legs).

The gallery page loads specimens on demand: each specimen's body mounts when it comes within one viewport of the screen (`Specimen` `load`, default `lazy`). The Charts, Map, and Blocks groups are `windowed`, so they also unmount when scrolled away and free their WebGL contexts. Measured in Chromium at 1440×900: JS heap after load went from 84 MB to 24 MB, DOM nodes from 33k to 2.5k, and live maps from 4 to 0. After scrolling to the bottom, heap went from 102 MB to 62 MB. `toc` moved to `components/toc.ts` so the server route `/dev/blocks/[id]` can import it.

Communication pass (2026-09-30, from the premium-planner research): new `PlanFlow`, `RunCompare`, `EditSession`, `FillBandLegend`; stage outputs; grouped section tabs; workbench Loads/Order lines/Unshipped tabs with View presets; timeline unassigned pool; trade-off label cleanup. See `docs/decisions.md`.

Lab components (`src/components/lab`): new `ClusterCard`/`LimitBar`/`TruckFillStrip`, `TrailerFill`/`FillMeter`/`FillPercent`, `TruckLoad`, `UnshippedLines`, `PipelineStages`, `RunMetricGroups`, `IterationTable`, `StockTable`, `LineStateBadge`, `StopPointsLayer`/`FitBounds` (map), `ClusterSwatch`/`ClusterLegend`/`TruckTag`; `DataTable` gained pagination; `CoordinateSourceBadge` gained `unresolved`; status colors moved to the coss `--info/--success/--warning/--destructive-foreground` tokens. Shared units/formatting in `src/lib/units.ts`, provisional pipeline types in `src/lib/fulfillment.ts` (to be replaced by generated contracts).

**M2 implementation is in (2026-09-30); acceptance is open.** Spec v1.8 §15 "M2 scope" items 1–15 and 17 are built (checklist above). Exit evidence still missing: round-two answers with explicit acceptance, and item 16 (`fillrate.fig` Components on coss, missing Foundations tokens), which needs the OpenPencil desktop app. Verification: optimizer pytest 54 passed (new: diameter off by default, preflight block/warn, `excluded_by_user` reconciliation, unknown exclusions rejected); Vitest 24 passed (new: shipment sheets agree with validated trucks, a blocking preflight fails permanently on attempt 1, review store upsert/delete); Ruff, lint (one pre-existing `globe.tsx` warning), typecheck, contract regeneration and build pass. A dev run of the example (k = 4) gave 19 shipments, valid, partial coverage, all three checks recorded as warnings.

**M3 is complete (2026-10-01).** `/scenarios` imports order and inventory CSVs (column mapping, row errors, samples, templates), saves immutable versions with authorship, optimistic conflicts and branches, edits lines/stock/coordinates, reviews preflight checks (block, exclude lines, or warn) and starts real worker runs with the full settings, including the cost objective. Runs reuse deterministic stages and checkpoint each cluster. Imported data needs `SCENARIO_KEY` in production. Evidence and benchmarks are under "M3 done" below.

## Design workflow (M2 prep)
1. **Foundations** page in `fillrate.fig`: variables named exactly like the CSS tokens in `apps/web/src/app/globals.css` (light + dark modes), plus type scale, radius, spacing, and `route-1..8`.
2. Export tokens → `globals.css`; check them in `/dev/components`.
3. **Components**: coss ui/mapcn components bound to those variables, compared against the gallery.
4. **Blocks**: app shell, orders and inventory, run pipeline, k explorer, cluster cards, truck loads, unshipped reasons, iteration comparison, and map (spec v1.3 §8a, §10). Route timeline is secondary.
5. Record the accepted direction in `docs/decisions.md`. M2 then builds the Blocks as real React screens.

## M3 done (2026-10-01)
Exit evidence: commit `0c4c32c`. `ci.yml` run 36802654448 passed; `image.yml` run 36802773247 built amd64 and arm64, and each image passed the bundled smoke plus the imported-scenario smoke (validated run, 8 shipments, $855.00 planned, branch saved, stale save → 409). Benchmarks in the tested image, 2,000 orders / 640 locations / k = 8, 4-CPU runners:

| Budget | amd64 total (solve) | arm64 total (solve) | Shipments |
| --- | --- | --- | --- |
| 500 iterations per cluster | 4.62 s (4.11 s) | 4.15 s (3.69 s) | 205 |
| Default 10 s per cluster | 81.0 s (80.5 s) | 80.9 s (80.5 s) | 203 |

Both stay far below `RUN_WALL_LIMIT_SECONDS` (600). GitHub runners stand in for the deployment VPS and Raspberry Pi; measuring the real machines is an M4 release gate (spec §15). Local Mac: 2.66 s and 80.7 s (`services/optimizer/benchmarks/*.json`).

## M3 checkpoint (2026-09-30)
Imported CSV completed preview → immutable save → real worker → validated shipment in a browser. Local checks passed: 43 Vitest, 72 pytest, Ruff, lint, typecheck and production build. A synthetic 2,000-order / 640-location / 8-cluster run took 2.733 s on this Mac; solve was 2.366 s (`services/optimizer/benchmarks/m3_2000_result.json`). Production imported-data access uses `SCENARIO_KEY`; public multi-user isolation is still a release gate. Cluster tasks are sequential but completed clusters resume after lease expiry. Solver exceptions still fail a run; matrix subpart reuse across changed partitions remains open. Actual cost rates await the primary user.

## Known gaps
- The home page (`/`) is a minimal hero: title, one-line description, GitHub and "See my progress" (`/dev`) buttons beside the cobe globe (`components/animated/hero-globe.tsx`). It has no header and does not link the component gallery; the `/dev` header logo links back to `/`.
- SQLite lives in `/app/data` (not the spec's `/data`, kept for the existing review deployment) and is ephemeral unless a volume is mounted there.
- Cluster solves run sequentially inside one leased job (default solve concurrency is one); each cluster is a durable checkpoint that resumes after lease expiry. Matrix subpart reuse across changed partitions (spec §9 "may") is not implemented; travel takes about 0.06 s at 2,000 orders, so it waits for M4 sweeps.
- Imported runs are visible only with the operator key; the `fillrate_operator` cookie (set when a run is started from `/scenarios`) is what lets `/runs/<id>` open them, so opening an imported run link in a fresh browser shows 404 until a run is started there.
- The pipeline stores integer-meter matrices from haversine × circuity only; no service-radius policy (disabled by default per spec) and no Valhalla.
- A capacity-forced prohibited leg (B reachable only via A, but A + B exceed a trailer) ends as "no valid candidate": PyVRP prefers an overloaded infeasible route over a MAX_VALUE edge. Correctly reported, never counted as planned.
- `ghcr.io/timblazing/fillrate:latest` is now the combined web + optimizer image. Deployments keep `/app/data`; starting runs in production needs `RUN_KEY`.
- Several workflow actions still target Node 20 (GitHub forces Node 24 and warns); bump their major versions when available.
- No Playwright browser smoke yet (spec §14 CI item); the image smoke covers the public API only.
- The legacy `solve_loads` spike in `loads.py` keeps its zero default truck penalty for its capability fixtures; the pipeline uses `solve_partition` with the derived penalty and shared location nodes. The gallery still uses its v1.3 TypeScript stand-in.
- The prior decision suggesting all stops beyond 500 miles from the depot should be dropped is superseded: with a per-leg constraint, an intermediate visit may make such a stop reachable. Spec §7 defines the distinction.
- The cluster-diameter limit is off by default (M2). With it off, auto-k only enforces `MAX_STOPS`, so auto k is usually 1; runs default to a fixed k. Trucks-then-miles stays the default objective; the cost objective works in the solver but needs his real rates.
- The synthetic `/api/v1/runs` API still only overrides k and seeds; full settings, preflight policies and exclusions go through `/api/v1/scenarios/runs` (operator key), which enforces preflight at submission.
- CSV exports now start with a `# …` note line naming the UI labels (M2 item 1). Tools that do not skip comment lines see it as a first row.
- The Run pipeline Block shows the previous (simulated) run's steps while preflight blocks a new one; resolution choices are local state only.
- Runs created before this change have no `summary.preflight` and show no preflight panel.
- If uv fails with "Bad CPU type" from a Python 2.7 framework install on PATH, set `UV_PYTHON=python3.13`.
- Chart and route palettes are placeholders (neutral shadcn chart colors, provisional route colors). Gallery charts use `--route-*` for series until a real chart palette lands.
- New tokens `--chart-background/-foreground/-foreground-muted/-label/-grid` (aliases for bklit) and the coss status tokens `--info/--success/--warning(-foreground)`, `--destructive-foreground` are not on the OpenPencil Foundations page yet.
- bklit radar logs harmless motion "undefined is not animatable" warnings in dev (vendored code).
- `MatrixHeatmap` renders every cell; 500-stop matrices will need virtualization.
- No sample order/inventory rows from the primary user yet (round two asks again).
- Chart recipes shared by charts and blocks live in `src/app/dev/components/recipes.tsx` until contracts exist.
- The gallery fixture's truck loads come from a sweep heuristic, not PyVRP; numbers are illustrative of shape, not solver quality.
- The Blocks are revised per round one and still need the user's round-two acceptance (spec §15).
- The project is now targeted for public access. Public scenario writes, real customer data, and solver submissions need identity/data isolation, limits, and abuse controls before launch (spec v1.7 §14).
- Vitest persistence/contract tests and optimizer pytest exist. Playwright end-to-end pipeline coverage remains for the next slice.
- The OpenPencil Components page still mirrors shadcn components; it needs redoing against coss ui (M2 item 16; needs the OpenPencil app open).
- `components/ui/chart.tsx` and `resizable.tsx` are still shadcn (coss has no equivalent).

## Waiting on the primary user (come back to this)
Round two is live at `/dev/review` (production needs `REVIEW_KEY`; send the link with `?key=`). It asks him to:
- Accept or change each revised Block, `/runs/<id>` and the shipment sheet.
- Give cost per truck and cost per mile (needed for the "lowest cost" objective in M3).
- Say what to change in the Results flow strip, and pick the ★ label.
- Decide whether a stop >500 mi from the depot but reachable through another stop should still block, and whether a stop larger than one trailer should block or just split.
- Confirm the 90% "full" band.
- Paste example order and inventory rows (fake values), and say what to fix first.

Owner: open `fillrate.fig` in the OpenPencil app so the Components page can be rebuilt on coss parts (M2 item 16).

## Next step
Start M4 (k explorer on real runs, bounded sweeps, comparison signatures, partition bounds, H3 baseline, flagship lesson). In parallel: send the round-two review link and record the answers (including cost per truck and per mile); with OpenPencil open, rebuild the `fillrate.fig` Components page on coss parts and add the missing Foundations tokens, then mark M2 done.
