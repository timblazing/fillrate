# Progress

## Milestones (spec §15)
- [ ] **M1 Thin durable fulfillment slice**
  - [x] Monorepo skeleton, root Bun workspace, git
  - [x] `apps/web`: Next.js 16 + Tailwind 4 + coss ui (Base UI) + mapcn, light/dark/system theme (migrated from shadcn radix-nova on 2026-09-29)
  - [x] Dev-only component gallery at `/dev/components`
  - [x] Gallery expanded into the design-system reference: Foundations, Primitives, Lab components (`src/components/lab`), Charts (Recharts + bklit), Map, Blocks
  - [x] Gallery rebuilt for spec v1.3 (2026-09-29): every specimen runs on one synthetic 2,000-order fixture pipeline
  - [x] Blocks open full screen at `/dev/blocks/<id>` for review screenshots
  - [x] `AGENTS.md`, `CLAUDE.md`, `docs/decisions.md`, `docs/progress.md`
  - [x] Pinned Python 3.13 / uv / PyVRP / OR-Tools / scikit-learn / FastAPI (`services/optimizer`), `/health` + `/capabilities`
  - [x] PyVRP capability fixtures: capacity, fixed truck cost, open routes (workaround), prohibited legs (preprocessing + validator)
  - [x] Drizzle schema + migrations, SQLite pragmas, migrate-on-start (`packages/db`)
  - [x] Generated persistence/stage envelope contracts (`packages/contracts`), database claim/lease fencing
  - [ ] Authenticated loopback worker transport and Python supervisor integration
  - [ ] Durable synthetic fulfillment slice: preflight → allocate → aggregate → cluster/repair → real PyVRP → validate → persisted map/table, JSON/CSV export (the per-cluster solve itself exists)
  - [ ] Spec v1.6 integration: truck-count-first objective with derived bound, graph reachability instead of depot-radius filtering, versioned stage manifests and independent metric reconstruction
  - [x] Web `Dockerfile` (Next.js standalone, port 3000) and manual `image.yml` → `ghcr.io/timblazing/fillrate:latest`
  - [ ] `ci.yml`, automatic image builds, optimizer image
- [ ] **M2 Design** (in progress in `fillrate.fig` via OpenPencil; see below). Blocks now center on the pipeline screens (spec v1.3 §15).
- [ ] M3 Operational core (CSV/versioned scenarios → real pipeline screens, per-cluster jobs, stage reuse, 2,000-order benchmark)
- [ ] M4 Experiments / first release (k explorer, bounded sweeps, comparison signatures, partition bounds, H3 layer/baseline, lesson and small Python replay export)
- [ ] M5 Allocation depth and imports (CP-SAT, other strategies, whole-order mode, geocoding)
- [ ] M6 Remaining PyVRP features and roads (Valhalla, `truck` costing)
- [ ] M7 Learning and exports
- [ ] M8 Verification and handoff

## Current state

Spec **v1.7** is the implementation target. The owner clarified that Fillrate is a public GitHub project and the web tool is intended to be publicly accessible. The README now reflects current development status; public writes and real-data use require access, isolation, and abuse controls before launch. The previous private-ingress model is superseded. The reference hostname returned HTTP 502 during this documentation update; no deployment change was attempted.

The M1 foundation status below remains current. The planned **PR 1 optimizer foundation** was already merged as GitHub PR #5; its capability document now explicitly labels diameter enforcement as planned, with no placeholder fixture. Existing PyVRP pins and capability proofs are preserved. The planned **PR 2 persistence/contracts foundation** has been implemented: Drizzle migrations, immutable snapshots, idempotent enqueue, real-file leases/fencing/retry/cancellation, transactional compressed artifacts, Pydantic-generated TypeScript/JSON Schema and Next.js startup migration. See `docs/durable-foundation.md` for scope and commands. These planned steps are not GitHub PR numbers #1/#2, which were gallery PRs and are already merged.

Verification: `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test` (14 passed), optimizer pytest (23 passed), Ruff check/format and contract regeneration pass. Production `next start` was exercised against a fresh temporary data directory: HTTP 200, all eight application tables present, WAL active. Tests race independent Node processes for claims and heartbeat/completion, reject stale attempts, verify rollback and restart persistence, and round-trip shared contracts in Python/TypeScript. That foundation verification did not include container images or deployment. No deployment change was made during the README/Git sync.

**M1 is not complete.** This step provides database operations and envelope contracts, not internal HTTP endpoints, a Python worker, mathematical stage implementations, a product run screen, or end-to-end fulfillment. The existing gallery remains illustrative.
Project agent guidance is now tracked only at the repository root. The redundant `apps/web` agent files were removed; `apps/web/.gitignore` ignores local copies Next.js may regenerate during `next dev`.

Frontend foundation plus the optimizer skeleton. `bun run lint`, `bun run typecheck`, and `bun run build` pass.

`services/optimizer`: uv project pinned to Python 3.13 and the versions in `docs/decisions.md`. `travel.py` builds haversine × circuity matrices in integer meters; `loads.py` builds and solves one cluster's truckloads with PyVRP (open-route workaround, prohibited legs omitted, fixed truck cost, unlimited trucks) and validates the result independently; `capabilities.py` serves the capabilities document. `uv run pytest` (23 passed), `ruff check`, and `ruff format --check` pass; `uv run fillrate-optimizer` serves `/health` and `/capabilities`.

The gallery (`src/app/dev/components`) is rebuilt around the v1.3 fulfillment pipeline. Every specimen reads one deterministic synthetic scenario (`fixtures/`: Memphis DC, 2,000 orders / 2,829 lines, 640 accounts, six SKUs with scarce stock) run through a TypeScript stand-in of the pipeline: piece-level "order date, then value" allocation, stop aggregation and trailer splits, k-means on 3D unit vectors with auto-k and bisecting diameter repair, a sweep heuristic standing in for PyVRP truck loads, metrics, and unshipped reasons. A k-explorer fixture (k 3–12 × seeds 0–9, inertia, ARI stability, co-assignment confidence) and a nine-run sweep with non-dominated marking feed the comparison views. The fixture is gallery-only; the real pipeline is Python (small synthetic slice in M1, operational expansion in M3).

Sections: Foundations (adds status colors and fill bands), Primitives (pipeline copy), Fulfillment components, Charts, Map (pipeline map + confidence map), Blocks (Workbench, Orders & inventory, Run pipeline, Results, k explorer, Iteration comparison), and Later milestones (route timeline, matrix inspector with prohibited legs).

The gallery page loads specimens on demand: each specimen's body mounts when it comes within one viewport of the screen (`Specimen` `load`, default `lazy`). The Charts, Map, and Blocks groups are `windowed`, so they also unmount when scrolled away and free their WebGL contexts. Measured in Chromium at 1440×900: JS heap after load went from 84 MB to 24 MB, DOM nodes from 33k to 2.5k, and live maps from 4 to 0. After scrolling to the bottom, heap went from 102 MB to 62 MB. `toc` moved to `components/toc.ts` so the server route `/dev/blocks/[id]` can import it.

Lab components (`src/components/lab`): new `ClusterCard`/`LimitBar`/`TruckFillStrip`, `TrailerFill`/`FillMeter`/`FillPercent`, `TruckLoad`, `UnshippedLines`, `PipelineStages`, `RunMetricGroups`, `IterationTable`, `StockTable`, `LineStateBadge`, `StopPointsLayer`/`FitBounds` (map), `ClusterSwatch`/`ClusterLegend`/`TruckTag`; `DataTable` gained pagination; `CoordinateSourceBadge` gained `unresolved`; status colors moved to the coss `--info/--success/--warning/--destructive-foreground` tokens. Shared units/formatting in `src/lib/units.ts`, provisional pipeline types in `src/lib/fulfillment.ts` (to be replaced by generated contracts).

## Design workflow (M2 prep)
1. **Foundations** page in `fillrate.fig`: variables named exactly like the CSS tokens in `apps/web/src/app/globals.css` (light + dark modes), plus type scale, radius, spacing, and `route-1..8`.
2. Export tokens → `globals.css`; check them in `/dev/components`.
3. **Components**: coss ui/mapcn components bound to those variables, compared against the gallery.
4. **Blocks**: app shell, orders and inventory, run pipeline, k explorer, cluster cards, truck loads, unshipped reasons, iteration comparison, and map (spec v1.3 §8a, §10). Route timeline is secondary.
5. Record the accepted direction in `docs/decisions.md`. M2 then builds the Blocks as real React screens.

## Known gaps
- The home page (`/`) is a minimal placeholder: a spinning cobe globe (`components/animated/globe-card.tsx`) linking to the GitHub repo. The component gallery (`/dev/components`, `/dev/blocks/<id>`) is now served in production too, but is not linked from `/`.
- The web image contains only the frontend (no optimizer). SQLite lives in `/app/data` and is ephemeral unless a volume is mounted there.
- Spec v1.6 is ahead of the current code: `loads.py` still defaults the truck penalty to zero and creates one matrix node per stop; the gallery still uses its v1.3 stand-in policies. Stage envelope contracts now exist; mathematical stage payloads, graph preflight, objective derivation, shared-location nodes, metric reconstruction and new acceptance fixtures remain to implement.
- `/capabilities` now distinguishes implemented/planned behavior. Diameter enforcement remains explicitly planned until the pipeline and independent validator implement it.
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
Sent 2026-09-30 as a Google Form (screenshots of the six Blocks, one page each). Answers may take a while; M1 work continues meanwhile. When they arrive:
- Record the accepted design direction and any requested changes in `docs/decisions.md`, then tick M2's review step.
- Close the open v1.3 assumptions it also asks about: value tiebreak per piece vs. order total, and whether orders at one address combine into one stop.
- Use his example rows (dummy values) to confirm the order and inventory CSV columns for M3 imports.

## Next step
Build the remaining M1 synthetic fulfillment slice on the completed persistence foundation: authenticated loopback transport + one Python worker, real staged pipeline with v1.6 graph/objective/validation semantics, persisted results and basic exports. Keep the single sequential job; expand orchestration in M3. Then add CI/container delivery and verify amd64/arm64. Design-review answers still gate M2 acceptance, not this correctness work.
