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
  - [x] Flagship lesson page `/learn/fulfillment-pipeline` (header link now "Lessons", the `/learn` index): stock against demand, four steps that start real runs (pipeline with k and inventory %, explorer, per-cluster loads, ranked sweep), measured expected observations, per-browser parameters and a reset
  - [x] Image smoke covers the lesson explorer (23 tasks), a two-run ranked sweep with CSV and a replay-bundle download (`deploy/smoke_experiments.py`); verified locally against dev
  - [x] Explicit deployment mode (`FILLRATE_MODE=hosted|local`, unset = operator deployment): incomplete or ambiguous hosted configuration refuses to start (exit 78); local mode needs no keys and creates no users or sessions (2026-10-01)
  - [x] Hosted Better Auth accounts: GitHub sign-in/out, 7-day sessions, secure cookies, canonical origin, provider-neutral `user:<id>` owners, `/account` and `/privacy` (2026-10-01)
  - [x] Per-user ownership on every list/read/write/download/cancel/admission path, owner-scoped stage reuse and geocoder cache, travel snapshot owner links, idempotency keys bound to their owner; existing data stays operator-owned (migration 0008) (2026-10-01)
  - [x] Persistent compute quotas: one unfinished job per account, daily solve/geocode/lookup/save/upload budgets, trusted-proxy IP budget, global queue; checked and charged in the queuing transaction; 429 with `Retry-After` and reset time (2026-10-01)
  - [x] Export and delete controls: `GET /api/v1/me/export`, scenario and account deletion with defined semantics; retention/backup/geocoding disclosure (2026-10-01)
  - [ ] Release gates needing the owner: target-hardware timings (VPS, Pi) and recovery checks; GitHub OAuth app and hosted `.env`; live two-account, quota and backup/restore acceptance on the deployed image
  - [x] Playwright smoke (spec §16; consolidated in M8): production lesson → persisted valid and complete result → non-zero revenue and shipment metrics → downloaded JSON export; no page-level overflow at 1440 and 390 px
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
  - [x] Python travel-provider groundwork: validated raw directed snapshots, estimated/imported providers, and bounded Valhalla truck matrix assembly (`travel_provider.py`, `valhalla.py`)
  - [x] Directed-matrix, missing-edge, unit/order, provider-limit, retry/cancellation and real PyVRP synthetic-terminal fixtures; independent validators reject missing physical edges
  - [x] Durable immutable snapshots (content-hash identity, SQLite immutability triggers, verified reads), `travel_snapshot_id` in run settings, and binding to stage identities, comparison signatures, `RunSummary.travel` and offline replay (a snapshot ships in the bundle and is identity-checked)
  - [x] Edited coordinates are refused before enqueue (`travel_snapshot_stale`); submission preflight (TypeScript) and the Python worker read the selected directed matrix for reachability; the validator cross-checks every leg against the snapshot
  - [ ] Imported-matrix preview, browser selection of a snapshot and the matrix inspector (`directed_road_travel` stays `planned` until then)
  - [ ] Durable Valhalla snapshot-building job with progress, failure and cancellation; immutable provider/version/extract/config identity
  - [ ] Pinned Valhalla Compose deployment, extract metadata and live coverage/configuration evidence; inspected-route geometry
  - [ ] Capability-gated fleet/window/depot/group/pickup-delivery/reload increments, manual evaluator and verified warm starts
- [ ] M7 Learning and exports (spec §13, §15; independent of M6 road selection)
  - [x] Second lesson `/learn/allocation-policies` (scarce stock; piece-level versus whole-order allocation) on the new 90-order `allocation` example (`examples/lesson-allocation.json`, generated by `fillrate_optimizer.lesson_allocation`); `/learn` index, header link "Lessons"; shared `learn/lesson-kit.tsx` (per-browser state, Step)
  - [x] `POST /api/v1/runs` accepts `allocation_strategy` and `fulfillment_policy` overrides; the `allocation` example works on `/runs`, `/experiments` and the sweep API
  - [x] Replay checks moved into the tested Python module `fillrate_optimizer.replay` (the bundle's `replay.py` is a thin wrapper); fixed: a CP-SAT allocation stage's measured `runtime_s` made a faithful replay report `allocation DIFFERS`
  - [x] `expected.json` now records allocation strategy/policy/kind and `travel: {provider: "estimated"}`; a bundle declaring another provider is refused (M6 boundary)
  - [x] Tests: 21 replay-semantics and 11 lesson-observation pytest cases; a real-worker Vitest e2e replays a CP-SAT whole-order run from its bundle; `smoke_experiments.py` covers the new example and bundle fields; passed in `image.yml` 36887302457 on amd64 and arm64
  - [ ] Remaining verified lessons (spec §13 list), with executable observations and current lesson links
  - [ ] Planned-route timeline/playback from persisted timing and verified geometry; waits for supported M6 adapters
  - [ ] GeoJSON route geometry, explorer replay and road-matrix export; export only implemented adapters and validated provider data
- [ ] M8 Verification and handoff
  - [x] Production Playwright browser smoke for the public synthetic fulfillment lesson, using the real Python worker and an isolated temporary database; validates result, revenue, shipments and JSON export at desktop and 390 px
  - [ ] Protected scenario/import → validated result browser smoke at desktop and 390 px
  - [ ] Bounded experiment → ranked comparison browser smoke at desktop and 390 px
  - [ ] Target-hardware timings, recovery checks, hosted access gates and account-free local distribution; complete the reproducible handoff

## Current state

**Repository project records restored (2026-10-01).** The canonical specification is `docs/fillrate-technical-spec.md`; this file tracks the roadmap, remaining work and evidence, `docs/decisions.md` records accepted decisions, and `docs/status.json` supplies the estimates shown on `/dev`. Work continues in the local checkout. Records have been reconciled with Git history and implementation artifacts.

Spec **v1.10** is the implementation target. Fillrate is a public GitHub project; public writes and real-data use still need access, isolation and abuse controls before launch (spec §14).

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

**M4 hosted accounts, isolation and quotas are implemented (2026-10-01); owner configuration and live checks remain.** `FILLRATE_MODE=hosted` adds Better Auth with GitHub, owner-scoped data and persistent admission limits. `FILLRATE_MODE=local` is the account-free single dataset. Unset keeps the operator deployment unchanged. Design, configuration, migration/rollback and retention are in `docs/hosted-operations.md`. Verification is under "2026-10-01: Hosted accounts, isolation and quotas" below.

**M5 is complete (2026-10-01).** `/scenarios` imports CSV, GeoJSON points or scenario JSON, shows a data review, resolves addresses through the Census batch geocoder with the ZIP/ZCTA fallback as a background job (saved as a new version), and has a coordinate review with map placement, address lookup and undo. Runs show allocation provenance; sweeps vary allocation strategy and fulfillment policy. Verification: pytest 120 (3 new), Vitest 67 (10 geocoding, 3 import-format), Ruff, lint (the existing `globe.tsx` warning), typecheck and build pass. A browser run against the dev server imported GeoJSON, geocoded live (Census: 1 exact; ZIP fallback: 1; unresolved: 1 without a ZIP), reused the cache on a second job (3 cached, 0 sent), placed the last stop on the map, saved, and ran it (valid, 2 shipments, preflight warned about the ZIP stop). Image evidence: `image.yml` run 36828389128 built the ZCTA stage and passed `smoke_geocode.py` against the live Census geocoder on amd64 and arm64.

**M7 increment (2026-10-01, on main as `778f7ba`).** A second lesson, `/learn/allocation-policies`, runs a small synthetic scenario through every allocation strategy and both fulfillment policies; every claim in its "what to look for" lists is asserted in `tests/test_lesson_allocation.py`. The Python replay export now has tested semantics (`tests/test_replay.py`) and no longer reports a false allocation difference for CP-SAT runs. Exports and lessons use only estimated travel; replay bundles say so and refuse any other provider, so this work does not depend on the unfinished M6 road selection. Verification: pytest 202, Vitest 68 (incl. the new replay e2e), Ruff, lint (the existing `globe.tsx` warning), typecheck, contract regeneration (no drift) and build pass under Node 24.18.1; a dev server + worker ran the lesson API, a 10-run sweep (piece-level cohort ranked, whole-order cohort separate) and an offline replay of the exported bundle (`REPLAY OK`). `ci.yml` 36886974428 passed; `image.yml` 36887302457 built and smoke-tested amd64 and arm64 (allocation lesson: 15 shipments, $64,749 planned, replay bundle ok) and published `latest`.

**M6 snapshot slice (2026-10-01, integrated into `main` as `2c00fcf`).** Immutable directed travel snapshots are stored by content hash (`POST /api/v1/travel-snapshots`, operator key) and selected with `RunSettings.travel_snapshot_id`. Submission preflight and the Python worker use that matrix for reachability and legs; the preflight and travel stage hashes, the comparison signature and the replay bundle carry its identity, and `RunSummary.travel` records it. A scenario edited after the snapshot is refused before enqueue. A real worker run over a directed fixture needs two trucks where straight lines need one, and replays offline with the snapshot identity verified. Road travel is still `planned`: the browser cannot select a snapshot, there is no matrix preview or inspector, and no live Valhalla deployment exists. See `docs/m6-road-matrices.md`.

**M6 started (2026-10-01).** Python travel providers validate raw directed distance/duration snapshots and assemble bounded Valhalla truck matrices with declared deployment metadata. Fixtures prove unit/order preservation, coordinate invalidation, missing-edge rejection, provider limits, HTTP failures, retries, cancellation, and open-terminal mileage using real PyVRP. Road travel stays `planned` in capabilities and unavailable to browser/worker jobs until durable snapshots, submission preflight, comparison/cache identities and replay are integrated. See `docs/m6-road-matrices.md`. Earlier validator gap fixed: reported truck mileage must match physical legs. Replay export tracing now explicitly includes optimizer assets rather than tracing the whole project. Verification after M5 integration: 170 pytest and 67 Vitest tests pass, including worker/replay e2e; Ruff lint/format, contract drift, lint, typecheck and production build pass under Node 24.21.0. The existing vendored `globe.tsx` lint warning remains. Integrated on top of the verified M5 commits after the owner's go-ahead; browser/worker road selection remains pending.

**M6 snapshot increment integrated (2026-10-01).** Fast-forwarded `2c00fcf` onto `main` after the M7 commits. The operator API now stores immutable directed travel snapshots and binds them to run preflight, worker execution, stage reuse, comparison and replay. Browser upload/selection, the matrix inspector and live Valhalla deployment remain open. CI installs Node 24.18.1, both Docker Node stages use 24.18.1, and the workflow Actions previously targeting Node 20 use Node 24 releases. Local verification: 219 pytest, 100 Vitest, Ruff lint/format, contract regeneration without drift, lint (the existing vendored `globe.tsx` warning), typecheck and production build pass. The first Vitest run had one intermittent stage-reuse assertion failure while other checks ran concurrently; that test passed alone and the full suite passed on rerun. GitHub CI/image evidence is pending.

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
- Target-hardware automation is not delivered: reported commit `3772136` and `services/optimizer/benchmarks/target_hardware.sh` are absent. Prepare a local harness/procedure; retain raw evidence and summary statistics from both the VPS and Raspberry Pi. The existing `benchmarks/m3_2000.py` remains available (see `docs/release-verification.md`).
- Broader browser acceptance is incomplete: the public lesson/result/export smoke exists, but protected imports and experiments still need separate flows. The cancelled umbrella attempt delivered no recoverable code or detailed failure evidence.
- Travel snapshots are operator-API only: there is no browser upload, preview or selector, and nothing builds a Valhalla snapshot in a job yet. A replay bundle for a run on the largest snapshots (about 1,000 nodes with high-entropy values) is several tens of MB.
- A snapshot's nodes are the depot plus stop IDs (one namespace); a location whose ID equals the depot's cannot use a snapshot. Stops are matched by exact coordinates, so any edit to a stop with demand needs a new snapshot.
- Reading, hashing and storing a snapshot happens in memory in the web process (about 36 MB at 1,001 nodes); the upload route is operator-only.
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
- Estimated travel remains the default. Operator-selected immutable directed snapshots are bound to worker runs, preflight, stage/cache/comparison identities and replay on `main`; browser selection and live Valhalla snapshot jobs are not implemented. No service-radius policy is enabled (per spec).
- A capacity-forced prohibited leg (B reachable only via A, but A + B exceed a trailer) ends as "no valid candidate": PyVRP prefers an overloaded infeasible route over a MAX_VALUE edge. Correctly reported, never counted as planned.
- `ghcr.io/timblazing/fillrate:latest` is now the combined web + optimizer image. Deployments keep `/app/data`; starting runs in production needs `RUN_KEY`.
- The Playwright browser smoke installs Chromium from Playwright's browser CDN on a cold CI runner; source dependencies are locked, and the app build itself no longer fetches fonts.
- The legacy `solve_loads` spike in `loads.py` keeps its zero default truck penalty for its capability fixtures; the pipeline uses `solve_partition` with the derived penalty and shared location nodes. The gallery still uses its v1.3 TypeScript stand-in.
- The prior decision suggesting all stops beyond 500 miles from the depot should be dropped is superseded: with a per-leg constraint, an intermediate visit may make such a stop reachable. Spec §7 defines the distinction.
- The cluster-diameter limit is off by default (M2). With it off, auto-k only enforces `MAX_STOPS`, so auto k is usually 1; runs default to a fixed k. Trucks-then-miles stays the default objective; the cost objective works in the solver but needs his real rates.
- The synthetic `/api/v1/runs` API accepts bounded example overrides, including k/seeds and allocation/fulfillment policies; full imported-scenario settings, preflight policies and exclusions go through `/api/v1/scenarios/runs` (operator key), which enforces preflight at submission.
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
- Hosted accounts, isolation and quotas are implemented but not yet live: GitHub sign-in has only been exercised with sessions written to the database and signed with the server secret (`bun run test:hosted`), not with a real OAuth app. Until the owner configures one and passes the live checks, keep public exposure to synthetic surfaces and operator workflows.
- Per-address quotas apply only when `TRUSTED_CLIENT_IP_HEADER` is set, which is safe only if the app port is reachable solely through the proxy. Without it, Better Auth's own limiter also runs without IP tracking (it would otherwise trust spoofable forwarded headers).
- Deleting a scenario also deletes branches made from it; account and scenario deletion are refused while a job is unfinished (cancel first). A travel snapshot is stored once by content hash and removed only when no owner holds it. Deleted data stays in backups until they expire; the 30-day expiry promised on `/privacy` is an operations task for the owner.
- In hosted mode the operator key (`SCENARIO_KEY`) reaches only the operator dataset; signed-in accounts never see it. A hosted sweep is capped at 10 runs by default because the global queue is 10.
- Better Auth uses its in-memory limiter for auth routes (per process); application quotas are in SQLite.
- Vitest persistence/contract tests and optimizer pytest exist. The Playwright production smoke now covers one public synthetic lesson run and JSON export; deployment, target-hardware, recovery and other flows remain outside its scope.
- The OpenPencil Components page still mirrors shadcn components; it needs redoing against coss ui (M2 item 16; needs the OpenPencil app open).
- `components/ui/chart.tsx` and `resizable.tsx` are still shadcn (coss has no equivalent).

## Waiting on the primary user (come back to this)
Round two is answered (2026-10-01). Still open from him:
- Example order and inventory rows (fake values) and "what should we fix first" (unanswered in both rounds).
- Cost per truck and per mile, only if he ever wants the "Lowest cost" objective (he answered N/A).

Owner: open `fillrate.fig` in the OpenPencil app so the Components page can be rebuilt on coss parts and the missing Foundations tokens added (M2 item 16, the last M2 item).

## Next step
Prioritize the initial hosted release using the remaining work and dependencies below:
1. Owner M4: dispatch an image release, then prepare VPS/Pi benchmark and recovery evidence; create the GitHub OAuth app and hosted `.env` (`docs/hosted-operations.md`), back up, deploy, and run the live two-account, quota and backup/restore checks.
2. M4/M8: tune the starting quotas against the target-hardware timings before opening signup.
3. M8: add protected scenario/import and experiment browser coverage as separate local increments, using the existing public-lesson smoke.
4. M2: finish the OpenPencil design file; continue M6 matrix selection/provider work after the initial release gates.
5. M8: verify account-free Bun/npm/Docker distribution and complete the reproducible handoff.

## 2026-10-01: Hosted/local release scope and execution workflow

Spec v1.10 adds free hosted Better Auth accounts, owner isolation, compute quotas and explicit hosted deployment checks. Existing server SQLite/Python architecture remains. Account-free local Bun/npm/Docker distribution is planned; npm compatibility is not yet verified. No auth feature or milestone percentage is marked complete by this planning update. Release gates now include the new hosted controls. The remaining-work section below owns the implementation breakdown and dependencies. Automatic CI skips doc/design-only changes, and image publication is explicit with CI prerequisites.

## 2026-10-01: Browser smoke and self-hosted Geist fonts (Codex)

The public-lesson acceptance flow is implemented on `main` at `ea66a3f`. An earlier reported commit `47c32ab` was unavailable, so completion is based on the local implementation and verification: a production standalone server and real Python worker use a temporary database and run key; Playwright waits for a persisted valid, complete result, checks non-zero planned revenue and shipment counts, downloads and parses the JSON export, and checks the result page at 1440 px and 390 px. `bun run test:browser` passed. Full Vitest passed (100/100), lint and typecheck passed, and `bun run build` passed.

The restricted build environment's Geist download failure is avoided by bundling the Latin WOFF2 subsets under the SIL Open Font License and using `next/font/local`; no outbound Google Fonts request is needed at build time. A cold CI run still needs the locked packages and Playwright's Chromium download. No network policy was loosened.

## Remaining work and dependencies

These local increments retain the remaining specification scope and acceptance criteria. Completed engine work stays complete; planned features and release checks below do not count as completion evidence.

### M2 — Design file
- Finish `fillrate.fig` Components with current coss part names/compositions and Foundations with light/dark chart, status, destructive and fill-band tokens. Export and compare with the implemented gallery and `globals.css`. Requires local OpenPencil.

### M4 — Hosted release
Items 1–3 are implemented and verified locally (see the dated entry below and `docs/hosted-operations.md`); items 4–5 remain with the owner.
1. **Identity and explicit mode (implemented):** Better Auth with Next.js/Drizzle/SQLite migrations, GitHub OAuth, sign-in/out, session expiry, provider-neutral owner IDs, trusted canonical origin and secure cookies. Proposed `FILLRATE_MODE=hosted|local`: incomplete hosted configuration fails startup; local needs no auth credentials or user/session records and defaults to loopback. Preserve operator protection until owner authorization is ready, private worker auth and account-free public lessons. Record migration backup/restore. No billing or password flow is required.
2. **Per-user ownership (implemented):** enforce every list/read/write/download/cancel/admission path for scenarios, versions, jobs, runs, sweeps, experiments, snapshots, caches, artifacts, replay and exports, including indirect references and stage reuse. Two-account checks must deny guessed IDs, shared hashes and cross-user access. Existing data stays operator-owned until explicit migration with backup; content hashes are not access tokens. Define export, deletion, retention and backup expiry. Local remains one account-free dataset.
3. **Compute quotas (implemented):** transactional persistent account/IP/global admission controls across concurrency/restart; reject before expensive solve/sweep/geocode/matrix/upload work. Starting configurable limits: one active job/account, ten queued globally, twenty solve admissions/account/day, ten MB uploads and existing order/time bounds; charge sweep child jobs. Trust only configured proxy IPs. Test cancellation/retry abuse, queue/concurrency/oversized input and clear 429/reset messages; bound anonymous demos and redact logs. Local keeps worker/input/time safety bounds without account quotas. Tune against hardware; external WAF/CAPTCHA is optional if observed abuse warrants it.
4. **Hosted configuration (owner, after implementation and hardware checks):** privately configure OAuth callback, server secret, canonical HTTPS URL and explicit hosted mode. Record immutable deployed digest and volume, backup before migration and restore/recovery evidence. Test two accounts, private import → solve → validated result → export/delete, logout denial, quotas and public synthetic viewing. Confirm private worker endpoints remain unreachable; publish retention/deletion/geocoding disclosures. No recurring service payment or billing is required by this plan.
5. **Live acceptance (after configuration):** verify the actual released image/data volume, worker behavior, public/private flows, two-account denials, quotas, ingress/transport boundaries, cancellation/recovery and backup/restore. Homepage HTTP 200 and historical CI/image checks are insufficient. Hardware and handoff requirements are in `docs/release-verification.md`.

### M6 — Roads and routing
- **Imported matrix UI:** preview/upload/select immutable directed snapshots for eligible scenarios; inspector shows direction, units, coverage and source metadata. Block stale coordinates before enqueue and verify UI behavior. Provider/worker groundwork is already on `main` (`2c00fcf`).
- **Durable Valhalla snapshot job:** bounded assembly with progress/failure/cancellation, immutable provider/version/extract/config identity and a browser-selectable snapshot. Use deployment-configured endpoints, respect provider limits and reject stale/partial/invalid matrices without a straight-line fallback. Fixtures check direction, units, missing edges and synthetic-terminal mileage; live evidence depends on the pinned deployment.
- **Pinned deployment (owner):** Compose image/version/extract metadata, arm64 availability, health and representative truck-matrix requests, operating-area coverage, configuration evidence and explicit limits.
- **Routing increments:** inspected geometry from the selected provider, then fleet/window/depot/group/pickup-delivery/reload capabilities as individually verified adapters. Manual route evaluator and verified warm starts need their own fixtures and independent validity checks. Optional Labs surfaces must work; unsupported controls remain unavailable with visible restrictions.

### M7 — Lessons, playback and exports
- **Remaining lessons:** working scenarios/flows for spec §13, executable measured observations, current index/links, and smoke/replay evidence for advertised behavior.
- **Timeline/playback (after relevant M6 geometry/adapters):** ordered arrival/service/departure, drive/wait/service states and supported loads before/after service from validated persisted data. A keyboard-accessible cursor synchronizes map/timeline using planned durations and verified geometry. Show unavailable timing/geometry explicitly and cover empty/error states. This is planned-route simulation, not traffic/GPS or fabricated solver-search history.
- **Exports:** GeoJSON geometry matches validated selected-provider route data; explorer replay reproduces recorded inputs/deterministic artifacts; road-matrix export retains identity/metadata once snapshots are selectable. Document implemented adapter semantics and limits.

### M8 — Verification and distribution
- **Protected import browser smoke:** minimal deterministic CSV preview → commit → run → persisted valid result with scenario identity and meaningful revenue/shipments. Check `/scenarios` and the result at desktop and 390 px with no page-level overflow. Use an isolated operator key and preserve imported-data protection; reuse existing public lesson/result/export coverage.
- **Experiment browser smoke:** smallest useful deterministic sweep → previewed combination count → completion → ranked Best option with meaningful comparison metrics. Check builder/comparison at desktop and 390 px; add one experiment export only as a bounded extension. Implement independently of imports; record the first unresolved blocker and avoid unrelated launcher refactors.
- **Target hardware/recovery:** prepare reproducible local automation, then collect repeated comparable/default-budget timings, restart/persistence, worker-loss, cancellation, backup/restore and access-boundary outcomes on both VPS and Raspberry Pi. Retain raw outputs, commit/dirty state, CPU/memory metadata, median/min/max, failures and limits. The reported harness is unavailable and not delivered; see `docs/release-verification.md`.
- **Account-free local distribution (after explicit mode):** prove root Bun/npm install/dev/build/worker under Node 24 + Python 3.13/uv; resolve npm workspaces and lockfile reproducibility under one dependency policy. Remove Bun-only runner assumptions without introducing Bun-only application APIs. Document supported native optimizer/SQLite platforms, data location/export/backups and loopback defaults. Both image architectures and local Compose start without auth secrets; hosted refuses missing configuration. Verify before advertising npm support; image builds/smokes stay in Actions.
- **Reproducible handoff (after evidence):** exact commands/artifacts and supported behavior/limits for container, native development, public ingress, auth, two-user isolation, quotas, mode refusal, backup/restore, performance and recovery. Include real hardware timings and local distribution evidence; hosted real-data release stays open until its gates pass.


## 2026-10-01: Verification record reconciliation (Codex)

Confirmed historical GitHub baseline for `3541a01`: [CI 36898437597](https://github.com/timblazing/fillrate/actions/runs/36898437597) and [image 36898827930](https://github.com/timblazing/fillrate/actions/runs/36898827930) both completed successfully. The earlier project audit reported homepage HTTP 200, but did not verify the live worker or immutable deployed digest; that observation does not close the live-release gate and has not been refreshed in this documentation session.

Repository workflow restoration: `bun run lint`, `bun run typecheck` and `bun run build` pass; lint retains the existing vendored `globe.tsx` hook warning. The shared `/dev` parser reads spec v1.10, all eight specification/progress milestones, the new decision, hardware/browser gaps and valid dashboard weights totaling 100. Product-behavior and milestone completion estimates are unchanged; no product implementation was added by this documentation reconciliation.

## 2026-10-01: Minimal /dev progress page (Claude Code)
- Redesigned `/dev`: hero, stat strip, milestone pipeline rings, commit graph (Kibo UI `contribution-graph`, GitHub API in the browser), borderless Milestones/Known gaps, scroll-loaded Decision log with blue Codex / orange Claude badges. Removed "Next up", "Waiting on the primary user" and "Surfaces" from the page.
- `/dev` now reads the canonical `docs/fillrate-technical-spec.md`.
- Evidence: lint, typecheck, build pass; checked at 1440/390 px on the dev server. Needs an image release to reach the deployment (parser/layout change).
- Gap: the commit graph uses the unauthenticated GitHub API (60 requests/hour per IP, cached per browser session); over the limit it shows a notice instead of data.

## 2026-10-01: Hosted accounts, isolation and quotas (Claude Code)
- **Mode:** `FILLRATE_MODE=hosted|local` (unset = operator deployment), validated at startup by `packages/db/src/hosted.ts` from `instrumentation.ts`. Hosted mode refuses missing or invalid settings and exits 78, naming every problem; an unknown mode or auth settings without a mode also refuse. Local mode has no keys, no auth routes and no user or session rows.
- **Identity:** Better Auth 1.7.7 with the Drizzle SQLite adapter and GitHub only (`/api/auth/[...all]`), telemetry off, IP tracking only through `TRUSTED_CLIENT_IP_HEADER`. Header account button, `/account` (limits, your scenarios with delete, download, delete account), `/privacy`. `/scenarios` asks hosted visitors to sign in and drops the operator-key field in hosted and local modes.
- **Ownership:** migration 0008 adds owners to scenarios, runs, experiments and geocoding jobs, `travel_snapshot_owners`, an owner-scoped stage cache and the auth tables. Existing imported data stays `operator`; the bundled examples become `examples` (public). Every route resolves `principal()` (`lib/server/access.ts`); the store refuses to queue work on another owner's version, scopes stage reuse and geocoder caches by owner, and treats idempotency keys from another owner as conflicts. Another owner's IDs answer 404.
- **Quotas:** `Admission` is checked and charged in the same write transaction that queues work (`Store.enqueue`, `createExperiment`, `admitWork`). Limits: one unfinished job per account (a sweep counts once), 20 solve admissions per day (a sweep charges each run), per-IP daily budget behind a trusted proxy, global queue 10, daily geocode, lookup, save and upload budgets, 10 MB bodies. Errors are 429 with `Retry-After`, a code and the time room frees up.
- **Deletion:** `DELETE /api/v1/scenarios/<id>` (with its branches, runs, sweeps and geocoding jobs), `DELETE /api/v1/me` (everything the account owns, then the user, sessions and GitHub link), `GET /api/v1/me/export`.
- **Evidence:** `bun run test` passed 114/114 with the real Python worker. New suites are `hosted.test.ts` (mode rules) and `isolation.test.ts`: two-owner isolation of scenarios, runs, sweeps, snapshots and geocoding; scoped stage reuse; admission across 6 racing processes; quota persistence across a reopen; deletion; migrating a 0007 database. `bun run test:hosted` (new, production build) passed 51/51: hosted refusal; local mode without keys; anonymous 401s; cross-origin 403; and every cross-account read, write, branch, run, preflight, explorer, sweep, geocode, export, cancel and delete denied by guessed ID. Also covered: the active-job and daily-quota 429s, sign-out and expiry, account deletion, and lessons that stay public. `bun run test:browser` (operator mode) passed. Lint, typecheck and build pass; lint keeps the vendored `globe.tsx` warning. `/account`, `/scenarios` and `/runs` were checked in hosted mode at 1440 and 390 px with no page-level overflow.
- **Image smoke:** `deploy/smoke.sh` now also checks that the image refuses hosted mode without settings and serves local mode without keys. It has not yet run in Actions; dispatch `image.yml` to publish and verify.
- **Not done (owner):** real GitHub OAuth app and hosted `.env`, a backup before migration 0008 on the deployment, live two-account and quota checks against the deployed digest, backup rotation matching the 30-day disclosure, and target-hardware/recovery evidence.
