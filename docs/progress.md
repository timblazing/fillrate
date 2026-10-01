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
- [ ] **M2 Accepted design** (spec v1.9 §15 "M2 scope"; round two accepted 2026-10-01; only `fillrate.fig` remains)
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
  - [x] Round-two review run at `/dev/review` with new `r2.*` question ids, then removed (2026-10-01)
  - [x] Round-two answers recorded (`docs/reviews/fillrate-design-review-2026-10-01.json`, spec v1.9): every Block, `/runs/<id>` and the shipment sheet accepted; ★ = "Best trade-off"; 90% full confirmed; flow strip kept; no cost rates
  - [x] Round-two policy applied: a far stop reachable through another stop only warns (`far_via_stop`, Python and TS preflight); a stop larger than one trailer splits by default (`oversize_stop: warn`)
  - [ ] `fillrate.fig`: Components page on coss parts; Foundations gains `--chart-*`, `--info/--success/--warning(-foreground)`, `--destructive-foreground`, fill bands (OpenPencil app was not running this session)
- [x] **M3 Operational core** (done 2026-10-01)
  - [x] CSV preview/commit, scenario editing and versioning, real imported runs and exports
  - [x] Cost objective, customer-aware stops, blocking preflight, durable cluster checkpoints and deterministic stage reuse
  - [x] Compressed large travel artifacts and a measured 2,000-order benchmark
  - [x] A solver exception in one cluster gives an invalid partial plan; the other clusters stay validated and inspectable (spec §9)
  - [x] Production operator-key access checked against `next start` and in the image smoke (`deploy/smoke_import.py`): refusal without the key, preview → save → preflight block → excluded-line run → validated result → private export → branch → conflict
  - [x] Narrow-width (390 px) browser check: `/scenarios` and an imported `/runs/<id>` have no page-level horizontal scroll; imported run pages without access return 404
  - [x] 2,000-order benchmark inside the tested image on amd64 and arm64 GitHub runners (`image.yml` job summary and artifacts)
- [ ] M4 Experiments / first release (k explorer, bounded sweeps, comparison signatures, ranked Best option / 2nd / 3rd, partition bounds, H3 layer/baseline, lesson and small Python replay export)
  - [x] k explorer statistics engine (`services/optimizer/src/fillrate_optimizer/explorer.py`): inertia per seed, raw/repaired stability (mean pairwise ARI, unclipped), per-location seed agreement (N/A for singletons, no dense all-pairs array), task cap with no silent truncation; 8 pytest cases
  - [x] Explorer as a durable job (`runs.kind = explorer`, worker dispatch, `explorer` artifact) + `POST /api/v1/explorer` + `/explore/<id>` screen (elbow/stability chart, k and H3 tables, seed-agreement map, raw vs repaired, "Use this k" for the example and for imported scenarios via `/scenarios`)
  - [x] Clustering methods in `RunSettings`: `cluster_strategy` kmeans | h3 | none, `h3_resolution`; no-clustering baseline fails with `baseline_ineligible` over MAX_STOPS or an enabled diameter limit; `inventory_percent` sweep axis
  - [x] Bounded sweeps (`experiments`, `experiment_runs`; all-or-nothing creation; preview before enqueue; never truncated), comparison signatures/cohorts, strict Pareto with declared rounding, ranked Best option / 2nd best / 3rd with a saved, editable lexicographic order; `/experiments` builder and `/experiments/<id>` view; JSON/CSV export with order and metric directions
  - [x] Partition lower bounds shown on `/runs/<id>` and in sweep rows; H3 map layer toggle (resolution 5, by stop count)
  - [x] Python replay bundle (`export?format=python`, zip with scenario, settings, deterministic stage artifacts, pinned optimizer source + lock, `replay.py`); e2e test replays a run with REPLAY OK
  - [x] Public abuse controls: global hourly/daily run budget (`PUBLIC_SYNTHETIC_RUNS=1`, `rate_events` ledger, no forwarded-header trust), bounded queue (`MAX_QUEUED_RUNS`, default 50)
  - [x] Flagship lesson scenario `examples/lesson-fulfillment.json` (2,000 orders, 600 locations, scarce stock; valid and complete, 443 shipments, ~2 s)
  - [x] Examples registry (`EXAMPLES` in `lib/server/runs.ts`: `m1`, `lesson`): `example` on `POST /api/v1/runs` (default `m1`), `/api/v1/explorer` and `/api/v1/experiments(/preview)` (default `lesson`); `GET /api/v1/examples`; scenario switch (`?example=`) on `/runs` and `/experiments`; explorer "Use this k" and re-runs keep the example
  - [x] Flagship lesson page `/learn/fulfillment-pipeline` (header link "Lesson"): stock against demand, four steps that start real runs (pipeline with k and inventory %, explorer, per-cluster loads, ranked sweep), measured expected observations, per-browser parameters and a reset
  - [x] Image smoke covers the lesson explorer (23 tasks), a two-run ranked sweep with CSV and a replay-bundle download (`deploy/smoke_experiments.py`); verified locally against dev
  - [ ] Release gates needing the owner: target-hardware timings (VPS, Pi) and recovery checks
  - [ ] Playwright browser smoke (spec §16; consolidated in M8). The lesson, `/runs` and `/experiments` were checked by hand at 1440 and 390 px
- [x] **M5 Allocation depth and imports** (CP-SAT, other strategies, whole-order mode, geocoding; done 2026-10-01)
  - [x] Allocation strategies in the pipeline (`allocation.py`): order date then value (default), first come, priority, proportional fair share (heuristic), optimized CP-SAT (revenue or priority then revenue, optional "respect order date", per-stage status)
  - [x] Whole-order fulfillment policy for every strategy; an order with an excluded line is excluded as a whole (`excluded_with_order`)
  - [x] Order `priority` (1–100, default 1) in the model and an optional `priority` CSV column
  - [x] Allocation provenance in the run summary (`summary.allocation`) and the stage artifact (residual, shortages, CP-SAT stages)
  - [x] Exact small-case oracle tests (CP-SAT vs exhaustive search, piece and whole-order, date rule, lexicographic priority); stock/reconciliation tests for every strategy × policy
  - [x] `/scenarios` run settings: Allocation, Order fulfillment and Optimized allocation selects
  - [x] Allocation provenance on `/runs/<id>` (Steps and Provenance: strategy, policy, heuristic or CP-SAT, each stage's status, best value and bound when not proven optimal)
  - [x] Allocation strategy and fulfillment policy as sweep axes (strategy compares within a cohort; whole-order is a changed-assumption cohort)
  - [x] Census batch geocoding (≤10,000 per request, chunked by a durable geocoding job, saved as a new version or a branch) and the one-line endpoint for single addresses; cache by normalized address, provider, benchmark and mode; raw responses stored as artifacts
  - [x] ZIP/ZCTA fallback from the pinned 2024 Gazetteer (`fillrate_optimizer.zcta`, SHA-256 checked; `bun run zcta:build` for dev, a Dockerfile stage for the image); `approximate_coordinates` policy (warn by default, can block)
  - [x] Location provenance: original address, geocode match record, and the original coordinate kept when a correction or re-geocode replaces it
  - [x] GeoJSON point and canonical scenario JSON imports beside CSV; data review in the import preview and on the loaded scenario; coordinate review with problem filter, map placement/drag, address lookup and undo
  - [x] Source-independent reproduction: CSV, GeoJSON and JSON give one canonical document (Vitest); coordinate provenance never changes the plan (pytest)
  - [x] Image evidence: `image.yml` run 36828389128 (commit `126422b`, after `ci.yml` 36828119214) built the ZCTA stage (33,791 ZCTAs) and passed `smoke_geocode.py` on amd64 and arm64 (Census: 1 exact; ZCTA fallback: 1)
- [ ] M6 Roads and advanced routing (Valhalla, `truck` costing)
  - [x] Python travel-provider groundwork: validated raw directed snapshots, estimated/imported providers, and bounded Valhalla truck matrix assembly (`travel_provider.py`, `valhalla.py`); no browser or worker selection yet
  - [x] Directed-matrix, missing-edge, unit/order, provider-limit, retry/cancellation and real PyVRP synthetic-terminal fixtures; independent validators reject missing physical edges
  - [ ] Durable matrix snapshots, run selection, preflight, cache/comparison identities and offline replay integration
  - [ ] Pinned Valhalla Compose deployment, extract metadata and live coverage/configuration evidence; matrix inspector and inspected-route geometry
  - [ ] Capability-gated fleet/window/depot/group/pickup-delivery/reload increments, manual evaluator and verified warm starts
- [ ] M7 Learning and exports
- [ ] M8 Verification and handoff

## Current state

Spec **v1.9** is the implementation target. Fillrate is a public GitHub project; public writes and real-data use still need access, isolation and abuse controls before launch (spec §14).

**M1 is complete.** A real synthetic run now goes end to end: `POST /api/v1/runs` (idempotency key; production requires `RUN_KEY`) → SQLite job → the Python supervisor claims it over the loopback transport → a child process runs the pipeline (`services/optimizer/src/fillrate_optimizer/pipeline.py`) → nine stage artifacts and the run summary commit atomically → `/runs/<id>` shows the map, clusters, truck loads, unplanned lines with evidence, per-product reconciliation and provenance, with JSON/CSV export. The bundled scenario is `examples/m1-synthetic.json` (Memphis DC, 69 orders; regenerate with `uv run python -m fillrate_optimizer.synthetic`). It exercises stock shortage, a split oversize stop, a 396 + 198 mi chain to a stop 594 mi from the depot (planned), an isolated unreachable stop, an unresolved coordinate and an oversize piece.

Verification (2026-09-30): optimizer pytest 49 passed; Vitest 22 passed, including transport auth/fencing tests and three end-to-end tests with the real Python worker (success + reconciliation; cancel kills the solver and frees the worker; SIGKILLed worker → lease expiry → attempt 2 on a new worker); Ruff, lint, typecheck, build and contract regeneration pass. A production `next start` + worker run solved, validated and exported in about 2 s; production without `RUN_KEY` refuses submissions. In GitHub Actions, CI passed (including the worker e2e tests) and both image architectures passed `deploy/smoke.sh` before publishing.

Run locally: `bun run dev` in one terminal and `bun run worker` in another, then open `/runs`. The web process writes `data/worker.token` for the native worker.

The gallery (`src/app/dev/components`) is rebuilt around the v1.3 fulfillment pipeline. Every specimen reads one deterministic synthetic scenario (`fixtures/`: Memphis DC, 2,000 orders / 2,829 lines, 640 accounts, six SKUs with scarce stock) run through a TypeScript stand-in of the pipeline: piece-level "order date, then value" allocation, stop aggregation and trailer splits, k-means on 3D unit vectors with auto-k and bisecting diameter repair, a sweep heuristic standing in for PyVRP truck loads, metrics, and unshipped reasons. A k-explorer fixture (k 3–12 × seeds 0–9, inertia, ARI stability, co-assignment confidence) and a nine-run sweep with non-dominated marking feed the comparison views. The fixture is gallery-only; the real pipeline is Python (small synthetic slice in M1, operational expansion in M3).

Sections: Foundations (adds status colors and fill bands), Primitives (pipeline copy), Fulfillment components, Charts, Map (pipeline map + confidence map), Blocks (Workbench, Orders & inventory, Run pipeline, Results, k explorer, Iteration comparison), and Later milestones (route timeline, matrix inspector with prohibited legs).

The gallery page loads specimens on demand: each specimen's body mounts when it comes within one viewport of the screen (`Specimen` `load`, default `lazy`). The Charts, Map, and Blocks groups are `windowed`, so they also unmount when scrolled away and free their WebGL contexts. Measured in Chromium at 1440×900: JS heap after load went from 84 MB to 24 MB, DOM nodes from 33k to 2.5k, and live maps from 4 to 0. After scrolling to the bottom, heap went from 102 MB to 62 MB. `toc` moved to `components/toc.ts` so the server route `/dev/blocks/[id]` can import it.

Communication pass (2026-09-30, from the premium-planner research): new `PlanFlow`, `RunCompare`, `EditSession`, `FillBandLegend`; stage outputs; grouped section tabs; workbench Loads/Order lines/Unshipped tabs with View presets; timeline unassigned pool; trade-off label cleanup. See `docs/decisions.md`.

Lab components (`src/components/lab`): new `ClusterCard`/`LimitBar`/`TruckFillStrip`, `TrailerFill`/`FillMeter`/`FillPercent`, `TruckLoad`, `UnshippedLines`, `PipelineStages`, `RunMetricGroups`, `IterationTable`, `StockTable`, `LineStateBadge`, `StopPointsLayer`/`FitBounds` (map), `ClusterSwatch`/`ClusterLegend`/`TruckTag`; `DataTable` gained pagination; `CoordinateSourceBadge` gained `unresolved`; status colors moved to the coss `--info/--success/--warning/--destructive-foreground` tokens. Shared units/formatting in `src/lib/units.ts`, provisional pipeline types in `src/lib/fulfillment.ts` (to be replaced by generated contracts).

**M2 round two is accepted (2026-10-01).** The primary user accepted every revised Block, `/runs/<id>` and the shipment sheet; the only open M2 item is `fillrate.fig` (item 16, needs the OpenPencil app). Round two also changed two policies (spec v1.9): far stops reachable through another stop warn (`far_via_stop`), and oversize stops split by default. Verification: pytest 82 passed, Vitest 43 passed, Ruff, lint, typecheck pass. **Earlier (2026-09-30):** Spec v1.8 §15 "M2 scope" items 1–15 and 17 are built (checklist above). Exit evidence still missing: round-two answers with explicit acceptance, and item 16 (`fillrate.fig` Components on coss, missing Foundations tokens), which needs the OpenPencil desktop app. Verification: optimizer pytest 54 passed (new: diameter off by default, preflight block/warn, `excluded_by_user` reconciliation, unknown exclusions rejected); Vitest 24 passed (new: shipment sheets agree with validated trucks, a blocking preflight fails permanently on attempt 1, review store upsert/delete); Ruff, lint (one pre-existing `globe.tsx` warning), typecheck, contract regeneration and build pass. A dev run of the example (k = 4) gave 19 shipments, valid, partial coverage, all three checks recorded as warnings.

**M3 is complete (2026-10-01).** `/scenarios` imports order and inventory CSVs (column mapping, row errors, samples, templates), saves immutable versions with authorship, optimistic conflicts and branches, edits lines/stock/coordinates, reviews preflight checks (block, exclude lines, or warn) and starts real worker runs with the full settings, including the cost objective. Runs reuse deterministic stages and checkpoint each cluster. Imported data needs `SCENARIO_KEY` in production. Evidence and benchmarks are under "M3 done" below.

**M4 product work is done (2026-10-01); release gates wait on the owner.** Runs, the k explorer and sweeps take a bundled `example` (`lesson` is the 2,000-order flagship scenario and the UI default). `/learn/fulfillment-pipeline` walks through allocation, k, per-cluster loads and a ranked sweep with real runs. The image smoke now covers explorer, sweep and replay. Verification: Vitest 53, pytest 96, Ruff, lint (the existing `globe.tsx` warning), typecheck and build pass; `smoke_experiments.py` passed against dev and inside the tested image on amd64 and arm64 (`ci.yml` 36811740023, `image.yml` 36811850360, commit `1f1d23e`).

**M5 is complete (2026-10-01).** `/scenarios` imports CSV, GeoJSON points or scenario JSON, shows a data review, resolves addresses through the Census batch geocoder with the ZIP/ZCTA fallback as a background job (saved as a new version), and has a coordinate review with map placement, address lookup and undo. Runs show allocation provenance; sweeps vary allocation strategy and fulfillment policy. Verification: pytest 120 (3 new), Vitest 67 (10 geocoding, 3 import-format), Ruff, lint (the existing `globe.tsx` warning), typecheck and build pass. A browser run against the dev server imported GeoJSON, geocoded live (Census: 1 exact; ZIP fallback: 1; unresolved: 1 without a ZIP), reused the cache on a second job (3 cached, 0 sent), placed the last stop on the map, saved, and ran it (valid, 2 shipments, preflight warned about the ZIP stop). Image evidence: `image.yml` run 36828389128 built the ZCTA stage and passed `smoke_geocode.py` against the live Census geocoder on amd64 and arm64.

**M6 started (2026-10-01).** Python travel providers validate raw directed distance/duration snapshots and assemble bounded Valhalla truck matrices with declared deployment metadata. Fixtures prove unit/order preservation, coordinate invalidation, missing-edge rejection, provider limits, HTTP failures, retries, cancellation, and open-terminal mileage using real PyVRP. Road travel stays `planned` in capabilities and unavailable to browser/worker jobs until durable snapshots, submission preflight, comparison/cache identities and replay are integrated. See `docs/m6-road-matrices.md`. Earlier validator gap fixed: reported truck mileage must match physical legs. Replay export tracing now explicitly includes optimizer assets rather than tracing the whole project. Verification after M5 integration: 170 pytest and 67 Vitest tests pass, including worker/replay e2e; Ruff lint/format, contract drift, lint, typecheck and production build pass under Node 24.21.0. The existing vendored `globe.tsx` lint warning remains. Integrated on top of the verified M5 commits after the owner's go-ahead; browser/worker road selection remains pending.

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
- Geocoding jobs run inside the web process, one at a time. A restart marks queued or running jobs failed (start again; Census answers already received are cached). Census errors fail the whole job rather than silently falling back to ZIP centroids.
- The ZIP fallback reads only a trailing 5-digit ZIP (or ZIP+4) of the one-line address. Census one-line lookups do not report exact vs non-exact, so those matches carry no match type.
- Imports before M5 defaulted missing line and location IDs to `csv-line-<row>` / `csv-location-<order>`; new imports use `line-<n>` / `location-<order>` for every format. Saved versions keep their IDs.
- Adding the location provenance fields changed scenario content hashes, so stage reuse does not carry over from runs made before M5.
- `/learn/fulfillment-pipeline` remembers its parameters and started jobs per browser (localStorage). The starter scenario's data itself is not editable there (only k, inventory % and sweep axes); editing rows needs `/scenarios` and the operator key.
- The M1 example stays the default for `POST /api/v1/runs` without `example`, so existing clients and the image smoke keep their results; the UI defaults to the lesson.
- The home page (`/`) is a minimal hero: title, one-line description, GitHub and "See my progress" (`/dev`) buttons beside the cobe globe (`components/animated/hero-globe.tsx`). It has no header and does not link the component gallery; the `/dev` header logo links back to `/`.
- SQLite lives in `/app/data` (not the spec's `/data`, kept for the existing review deployment) and is ephemeral unless a volume is mounted there.
- Cluster solves run sequentially inside one leased job (default solve concurrency is one); each cluster is a durable checkpoint that resumes after lease expiry. Matrix subpart reuse across changed partitions (spec §9 "may") is not implemented; travel takes about 0.06 s at 2,000 orders, so it waits for M4 sweeps.
- Imported runs are visible only with the operator key; the `fillrate_operator` cookie (set when a run is started from `/scenarios`) is what lets `/runs/<id>` open them, so opening an imported run link in a fresh browser shows 404 until a run is started there.
- The pipeline still selects and stores integer-meter matrices from haversine × circuity only; no service-radius policy is enabled (per spec). M6 has typed estimated/imported/Valhalla provider groundwork, but road matrices are not yet selected by browser or worker jobs.
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
- No sample order/inventory rows from the primary user yet (unanswered in both review rounds).
- Chart recipes shared by charts and blocks live in `src/app/dev/components/recipes.tsx` until contracts exist.
- The gallery fixture's truck loads come from a sweep heuristic, not PyVRP; numbers are illustrative of shape, not solver quality.
- The project is now targeted for public access. Public scenario writes, real customer data, and solver submissions need identity/data isolation, limits, and abuse controls before launch (spec v1.7 §14).
- Vitest persistence/contract tests and optimizer pytest exist. Playwright end-to-end pipeline coverage remains for the next slice.
- The OpenPencil Components page still mirrors shadcn components; it needs redoing against coss ui (M2 item 16; needs the OpenPencil app open).
- `components/ui/chart.tsx` and `resizable.tsx` are still shadcn (coss has no equivalent).

## Waiting on the primary user (come back to this)
Round two is answered (2026-10-01). Still open from him:
- Example order and inventory rows (fake values) and "what should we fix first" (unanswered in both rounds).
- Cost per truck and per mile, only if he ever wants the "Lowest cost" objective (he answered N/A).

Owner: open `fillrate.fig` in the OpenPencil app so the Components page can be rebuilt on coss parts and the missing Foundations tokens added (M2 item 16, the last M2 item).

## Next step
M6 is the focus; M2 and M4 wait only on owner items:
1. M6: persist and select directed travel snapshots through worker jobs, preflight, stage reuse, comparisons and replay; then verify a pinned Valhalla deployment. See `docs/m6-road-matrices.md`.
2. Owner (M4 release gate): run the benchmark and a recovery check (kill the container mid-run, restart, the run resumes or fails cleanly) on the VPS and the Pi.
3. M2: rebuild `fillrate.fig` Components on coss parts (needs the OpenPencil app open).
4. M8: Playwright browser smoke.
