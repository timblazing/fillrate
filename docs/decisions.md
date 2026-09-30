# Decision log

Append-only. Each entry: date, decision, reason, session tool.

## 2026-09-29: Split milestone 1; frontend foundation first (Claude Code)
**Decision:** Before the rest of M1 (DB, Python, worker, CI, Docker), set up only the monorepo skeleton and `apps/web` (Next.js, Tailwind, shadcn, mapcn), plus a dev-only `/dev/components` gallery.
**Reason:** The OpenPencil design system (`pyvrp-lab.fig`: Foundations, Components, Blocks) should be designed against the real shadcn/mapcn components. The design work needs no backend. This follows the spec's M1 → M2 (design accepted before M3) ordering. The remaining M1 items are unchanged.

## 2026-09-29: Frontend pins (Claude Code)
- Bun 1.4.2 (package manager/scripts), Node 24.18.1 (runtime)
- next 16.3.7, react / react-dom 19.2.8, typescript 5.9.3, eslint 9.39.5
- tailwindcss 4.3.3, shadcn CLI 4.x, style `radix-nova`, base color neutral, icon library lucide
- radix-ui 1.6.7 (primitives). `@base-ui/react` 1.8.0 comes in only through shadcn's `combobox`.
- mapcn `@mapcn/map` (shadcn registry), maplibre-gl 6.11.2, default CARTO basemap
- recharts 3.8.0 (shadcn chart), react-resizable-panels 4.14.1, next-themes, sonner
Exact resolved versions are in `bun.lock`.

## 2026-09-29: Frontend implementation notes (Claude Code)
- Root Bun workspace (`apps/*`, `packages/*`) with a single root `bun.lock`.
- `typecheck` runs `next typegen && tsc --noEmit`. Next 16 generates `LayoutProps`/`PageProps` globals.
- ESLint disables `react-hooks/refs` and `react-hooks/set-state-in-effect` for `src/components/ui/**` and `src/hooks/**` only. Those files are vendored upstream registry code, and keeping them identical to upstream keeps CLI updates clean. App code keeps the full rule set.
- Added `--route-1..8` tokens (placeholder oklch palette) for stable per-route colors (spec §4), exposed to Tailwind as `route-N`. Final values come from the Foundations design pass.
- Map layer colors are resolved from CSS tokens at runtime (`src/lib/css-color.ts`), because MapLibre cannot read CSS variables or oklch.
- Fixed a circular `--font-sans` definition that shadcn init wrote into `globals.css`; it now maps to Geist.

## 2026-09-29: Gallery expansion, lab components, second chart source (Claude Code)
- **bklit charts alongside shadcn/Recharts.** Added the `@bklit` registry (`https://bklit.com/r/{name}.json`) and installed `radar-chart`, `funnel-chart`, `ring-chart` into `src/components/charts` (vendored, same no-hand-edit rule and ESLint exemption as `ui/`). Recharts stays the default for axis charts (spec §2); bklit is only for radar, funnel, and ring. It brings `motion`, `@number-flow/react`, `d3-shape`, and `@visx/*` pinned at `4.0.1-alpha.0` (bklit's pin). The shadcn CLI also replaced `src/lib/utils.ts` with the standard `clsx` + `tailwind-merge` `cn`.
- **TanStack Table v9** (`@tanstack/react-table` 9.2.4, current stable) for `DataTable`: `useTable` + `tableFeatures`, not the v8 `useReactTable` API.
- **Product components live in `src/components/lab`**, built from primitives. Chart compositions stay as gallery recipes until the API contracts exist.
- **New chart chrome tokens** `--chart-background`, `--chart-foreground`, `--chart-foreground-muted`, `--chart-label`, `--chart-grid` in `:root`, as aliases of core tokens so they follow the theme. They still need to be added to the OpenPencil Foundations page.
- Removed the placeholder "Route summary" chart.

## 2026-09-29: coss ui toast and alert (Claude Code)
- **Toasts moved from sonner to coss ui `toast`** (Base UI `Toast`, `@coss` registry). `ToastProvider` + `AnchoredToastProvider` wrap the app in `layout.tsx`; call `toastManager.add/promise` or `anchoredToastManager.add`. `sonner` and `ui/sonner.tsx` were removed.
- **`ui/alert.tsx` is now the coss ui alert.** Variants are `default | info | success | warning | error` (no `destructive`), with `AlertAction` for inline buttons.
- `bunx shadcn add @coss/toast` pulls `@coss/button` and overwrites `ui/button.tsx` and `ui/spinner.tsx`. Both were restored to the shadcn radix-nova versions (coss toast only needs `buttonVariants({ size: "xs" })`). Re-running the coss add needs the same restore.
- New tokens from coss: `--info`, `--success`, `--warning` (+ `-foreground`) and `--destructive-foreground`, light and dark, plus toast re-notify keyframes. They still need to be added to the OpenPencil Foundations page.
- Removed the gallery hero. `DiagnosticList` no longer draws a severity bar on the left edge; the icon and label carry severity.

## 2026-09-29: Replace shadcn/ui with coss ui (Claude Code)
- **Decision:** the UI primitive layer is now [coss ui](https://coss.com/ui/docs) (Base UI + Tailwind 4, `@coss` shadcn-CLI registry) instead of shadcn/ui `radix-nova` (Radix). The owner preferred coss's components. Installed with `bunx --bun shadcn@latest add @coss/ui --overwrite`, which adds all 54 coss primitives.
- **Replaced:** every shadcn component that has a coss equivalent. Renames: `dropdown-menu` → `menu`, `hover-card` → `preview-card`, `button-group` → `group`, `menubar` → `toolbar` + `menu`, `item` → `frame`. New coss-only parts now in use: `number-field`, `meter`, `fieldset`, `checkbox-group`, `frame`, `toolbar`, `autocomplete` (under `command`); `form` and `otp-field` are installed but unused.
- **Kept from shadcn/mapcn:** `chart.tsx` (Recharts wrapper, spec §2), `resizable.tsx` (react-resizable-panels) and `map.tsx` (mapcn). Their `cn` import now points to `@/lib/utils`.
- **Removed:** `aspect-ratio` and `navigation-menu` (unused), and the packages `radix-ui`, `vaul`, `cmdk`, `react-day-picker` and `cn`. The coss calendar uses `@daypicker/react`.
- **Code conventions:** Base UI's `render` prop replaces `asChild`. Use coss part names (`DialogPopup`, `TooltipPopup`, `TabsTab`, `AccordionPanel`, `MenuPopup`) over the shadcn aliases coss also exports. `ToggleGroup`, `Accordion` and `CheckboxGroup` values are arrays.
- **Lint:** vendored coss `sidebar.tsx` calls `Math.random` in `useMemo` (skeleton widths), so `react-hooks/purity` joins the vendored-code ESLint exemption.
- **Spec:** §2 (UI row), §15 (M2 design step), §18 (implementation brief) and §19 (references) now name coss ui. §2 "shadcn Chart/Recharts" and mapcn are unchanged.
- **Follow-up:** the OpenPencil Components page needs redoing against coss ui. The token names are unchanged apart from the four coss status tokens.

## 2026-09-29: Spec v1.3, fulfillment pipeline becomes the primary product (Claude Code)
- **Decision:** re-center the spec on the primary user's workflow: piece-level allocation of open orders (order date, then net value per piece) → aggregate allocated lines into stops → k-means on lat/lon → per-cluster PyVRP loads on 53 ft trailers → compare iterations. The generic PyVRP feature tour moves to M6/M7 and lessons. Milestones are reordered (§15).
- **Reason:** the friend who is the real user answered a use-case questionnaire. He uses PyVRP after k-means to build truckloads, not to sequence stops; linear feet are the only load limit; one cluster can need several trucks; routes are open (no return to the depot); stops are at most 500 miles apart within a cluster and between consecutive stops; distance is haversine × 1.2 ("mileage cushion"), with no road routing; about 2,000 open orders per run; a result is better with fuller trucks, tighter clusters, and more revenue; his pain is manually interpreting the data. He confirmed piece-level (partial) allocation, and that allocated amount = net value per piece × allocated pieces.
- **Interpretations made in v1.3:**
  - Linear feet are stored as integer hundredths of a foot (53 ft = 5,300).
  - k-means runs on 3D unit vectors from lat/lon. Cluster diameter is enforced by bisecting over-limit clusters, not by PyVRP. Auto-k picks the smallest k whose clusters all pass the diameter check before repair.
  - Open routes: native if the pinned PyVRP supports it, otherwise zero-cost return edges, labeled. Legs over the limit are prohibited in the matrix. Both need M1 capability fixtures.
  - A stop larger than one trailer is split into several visits.
  - A fixed cost per truck steers PyVRP toward fewer, fuller trucks.
  - Metrics are shown side by side with non-dominated highlighting; there is no hidden composite score.
  - `MAX_STOPS` (500) now bounds each cluster solve; new `MAX_ORDERS` (5,000) and `RUN_WALL_LIMIT_SECONDS` (600).
- **Assumptions to confirm with him (non-blocking):**
  1. The 500-mile limits apply to haversine × 1.2, not raw haversine (it is a setting either way).
  2. The truck count is unlimited.
  3. The value tiebreak is per piece, not per order total.
  4. Multiple orders at one address combine into one stop.
  5. How he picks k today (his answer "K is coordinates" described the k-means features, not the cluster count).
  6. A scrubbed sample of orders and inventory, kept as a local fixture only and never committed (spec §14).

## 2026-09-29: v1.3 follow-ups confirmed; k explorer added (Claude Code)
- **Confirmed by the primary user:** (1) the 500-mile limits use haversine × 1.2; (2) the truck count is unlimited; (3) he chooses k by trial and error, rerunning k-means to lower run-to-run variance until stop groupings are trustworthy.
- **Decision:** add a **k explorer** to spec §8a (built in M4): clustering-only runs over a k range × seeds (default 0–9) that show inertia per k (elbow), seed stability (mean pairwise adjusted Rand index), and per-stop assignment confidence (mean co-assignment with the stop's reference-cluster mates). The chosen k feeds pipeline runs and sweeps. Auto-k stays the default when no k has been chosen.
- **Reason:** it turns his manual trial-and-error loop into one view. Label-invariant co-assignment avoids the cluster-label-matching problem across seeds.
- **Still open:** the value tiebreak is per piece (assumed), orders at one address combine into one stop (assumed), and sample data. He has none right now and may send some later; keep it out of the repo.

## 2026-09-29: Gallery rebuilt for spec v1.3 on a synthetic fixture pipeline (Claude Code)
- **Decision:** the `/dev/components` gallery now shows production-shaped examples of the fulfillment pipeline. Every specimen and block reads one deterministic synthetic scenario and a TypeScript stand-in pipeline under `src/app/dev/components/fixtures/` (allocation, aggregation and splits, k-means with auto-k and diameter repair, k explorer, sweep), so numbers agree across views.
- **Reason:** the owner asked for examples of how components will look live; the previous gallery was built around the generic PyVRP tour (time windows, routes, objective breakdowns).
- **Interpretations:** truck loads in the fixture use a sweep + nearest-neighbour heuristic labeled as a PyVRP stand-in; the real solver arrives in M3. Stops beyond the 500 mi depot leg are reported as "allocated, not loaded". Fill bands: under 60% low, 85%+ full (`lib/units.fillBand`). Tightness for non-dominated ranking uses mean distance to centroid. The `--route-N` tokens are now described as the series palette (clusters and runs); names are unchanged to keep the .fig mapping.
- **Dependencies:** added `@turf/convex`, `@turf/circle`, `@turf/helpers` (spec §2 Turf) for cluster hulls and the depot leg-limit ring.
- **Map:** bulk stops render as one GeoJSON circle layer (`lab/map-layers.tsx`), not DOM markers (spec §4).
- **Hydration:** compact money and CSS percentages are formatted by hand (`formatMoney`, `cssPercent`) because Intl compact output differs between Node and browsers.
- Route timeline and matrix inspector moved to a "Later milestones" section (M6–M7).

## 2026-09-29: Project renamed to Fillrate (Claude Code)
- **Decision:** PyVRP Lab is now **Fillrate** (spec v1.4). Repository `timblazing/fillrate`, image `ghcr.io/timblazing/fillrate`, database file `fillrate.sqlite`, spec `fillrate-technical-spec.md`, design file `fillrate.fig`, root package `fillrate`.
- **Reason:** the owner wants a standalone product name that uses PyVRP under the hood rather than being named after it. "Fill rate" covers both inventory fill rate and truck fill.
- **Domain:** the reference deployment is served at `fillrate.blasingame.dev`, a subdomain of the owner's existing domain, through the Caddy VPS (spec §14).
- Earlier entries in this log keep the old file names as written; they refer to the same files.

## 2026-09-29: Full-screen block route; M1 deployment answers (Claude Code)
- **Full-screen blocks:** each gallery block opens alone at `/dev/blocks/<id>` (dev-only, 404 in production), linked from an "Open full screen" button on its specimen. For review screenshots. `AppShell` now takes `height` in px; under `FullscreenContext` it grows to `max(100dvh, height)`. Block ids and titles live in the gallery toc (`specimen.tsx`).
- **Image platforms:** keep `linux/amd64` and `linux/arm64` (spec §14). Deployment targets are an Ubuntu VPS and a Raspberry Pi, so arm64 is required, not optional: if pinned PyVRP/OR-Tools/scikit-learn lack arm64 wheels, record it and resolve it rather than dropping arm64. A Pi needs a 64-bit OS.
- **Public GHCR image:** confirmed by the owner.
- **Branch protection:** none for now; CI runs on PRs and `main` but does not gate merges.
- **Other M1 choices** (optimizer layout, schema scope, contract generation) are delegated to the implementing agent and are recorded as they are made.

## 2026-09-30: Design review sent; M1 continues in parallel (Claude Code)
- **Status:** the six Blocks went to the primary user as a Google Form (a screenshot and questions per screen, plus the open v1.3 assumptions and a request for example order/inventory rows with dummy values). The form and its screenshots live outside the repo.
- **Decision:** don't block on the answers. Continue the remaining M1 foundation work; record the accepted design direction here when the answers arrive (tracked under "Waiting on the primary user" in `docs/progress.md`).

## 2026-09-30: Spec v1.5: Valhalla replaces OSRM; H3 layer and clustering baseline (Claude Code)
- **Source:** the primary user suggested Valhalla, H3, CP-SAT, and OR-Tools.
- **Decision:** Valhalla replaces OSRM as the single optional self-hosted road provider (spec §2, §7, §14, M6). Compose profile `valhalla`, pinned `ghcr.io/valhalla/valhalla-scripted`, env `VALHALLA_URL` / `VALHALLA_COSTING_LABEL`, default `truck` costing.
- **Reason:** `truck` costing models the tractor-trailer (length, height, weight) without re-preparing data, and tiled graphs make multi-state coverage practical, which a single-state OSRM dataset could not give 500-mile loads. The "no second routing engine" rule stands.
- **Gotchas for M6:** Valhalla's default `max_matrix_distance` is 400 km for `truck`/`auto`, shorter than the 500-mile leg limit; the deployment raises it (1,000 km). `max_matrix_location_pairs` defaults to 2,500, which matches the 50 × 50 block size. Verify the pinned image has arm64 for the Raspberry Pi, and record coverage with measured build time, disk, and memory.
- **Decision:** H3 moves out of deferred extensions into M4: a hex aggregation map layer (h3-js, MapLibre fill layer, default resolution 5) and an optional H3 clustering baseline (`method: h3`, default resolution 2, explorer resolutions 1–3) with the same diameter repair. k-means stays the default.
- **CP-SAT / OR-Tools:** already the optimized allocation strategy (§8, M5); no behavior change, references added (CP-SAT guide, CP-SAT Primer).
- **Gallery:** the `osrm` travel mode is renamed `valhalla` in `TravelModeBadge` and the travel-mode select specimen.

## 2026-09-30: Optimizer pins and PyVRP 0.14.0 capability findings (Claude Code)
- **Pins** (`services/optimizer/pyproject.toml`, locked in `uv.lock`): Python 3.13, pyvrp 0.14.0, ortools 9.15.6755, scikit-learn 1.9.1, numpy 2.5.3, h3 4.5.0, fastapi 0.142.2, pydantic 2.13.5, uvicorn 0.54.0; dev: pytest 9.1.1, httpx2 2.13.1, ruff 0.16.9. Latest stable on PyPI as of today. `httpx2` (pydantic's successor to httpx) replaces `httpx` for FastAPI's `TestClient` because Starlette deprecates `httpx` there; approved by the owner.
- **arm64:** every pin has cp313 `manylinux_2_28` wheels for both `x86_64` and `aarch64` (glibc ≥ 2.28; `node:24-slim` is fine). The Raspberry Pi target needs no source builds.
- **Open routes are a workaround, not native.** PyVRP 0.14.0 vehicle types always have an end depot and no open-route flag. Every stop → depot edge gets zero distance, so the return is free and excluded from reported distance. A fixture fails if a future pin adds an open-route parameter.
- **Prohibited legs are soft in PyVRP.** Missing edges are filled with `pyvrp.constants.MAX_VALUE` (2^44), a large finite cost. PyVRP avoids them whenever an alternative exists (e.g. an extra truck), but when a stop is only reachable by a prohibited leg it still routes it and reports the solution feasible. Fillrate's validator (`validate_loads`) re-checks every leg against the real matrix and marks the result infeasible (`leg_too_long`). The depot → first stop leg is subject to the limit too, so the pipeline should drop unreachable stops ("allocated, not loaded") before solving.
- **Units at the solver boundary:** distance in integer meters (500 mi = 804,672 m), linear feet in hundredths of a foot, fixed truck cost in the same units as distance (meters).
- **Unlimited trucks** are modeled as one available vehicle per stop.
- **API:** 0.14 separates locations from clients/depots (`add_location`, then `add_client(location, …)`); routes iterate `ScheduledActivity` objects; client activity `idx` is the 0-based client index.
- **Layout:** `services/optimizer/src/fillrate_optimizer/` (`travel`, `loads`, `capabilities`, `app`), tests in `services/optimizer/tests/`. FastAPI binds to 127.0.0.1 (`OPTIMIZER_PORT`, default 8000).

## 2026-09-30: Gallery specimens load on demand (Claude Code)
- **Problem:** `/dev/components` mounted every specimen at once: 4+ MapLibre maps (one WebGL context each; browsers cap live contexts at about 16), 8+ Recharts charts, and ~33k DOM nodes. The page felt sluggish and used a lot of memory.
- **Decision:** `Specimen` renders its header and anchor always and its body only when the specimen is within one viewport of the screen (IntersectionObserver). `lazy` (default) keeps it mounted after that; `windowed` (Charts, Map, Blocks groups, set on `Group`) unmounts it again when it's far away. Unmounted bodies keep their last measured height so the page doesn't shift. Nav links, ⌘K, and deep links go through `jump()`, which re-aims after `scrollend` because specimens change height as they mount.
- **Rejected:** one route per group (loses the single scroll and cross-group search); `content-visibility: auto` alone (skips paint only; React still renders everything and every map still creates its WebGL context).
- **Trade-off:** windowed specimens lose local state (selected cluster, toggles) when scrolled far away.


## 2026-09-30: Spec v1.6 research and fulfillment-first delivery (Codex)
- **Scope:** documentation revision on `codex/spec-v1-6`; no runtime implementation or dependency upgrade. Reviewed the current spec, attachment, existing optimizer source/fixtures and all six suggested repositories. Research links and per-repository dispositions are in spec §19.
- **Architecture:** separate business, spatial/travel, normalized routing, and solver-adapter schemas. Add small typed travel/clustering/solver contracts and immutable stage manifests. Reuse deterministic artifacts, but do not count cached solves as independent seed experiments. Keep Next.js/SQLite ownership, Python workers, coss/mapcn, PyVRP 0.14.0, optional Valhalla and M4 H3.
- **Correctness:** preserve the proven open-route workaround and finite prohibited-edge semantics. This supersedes the earlier blanket recommendation to drop every stop more than 500 miles from the depot: a legal sequence through another visit can reach it. Use allowed-edge graph preflight and independent validation, with a separate optional service radius. A failed search or invalid candidate is not an infeasibility proof.
- **Objective:** provisionally choose truck count first, then distance. For the initial bounded open model, derive F = nL + 1 so the objective orders feasible candidates correctly; do not claim heuristic optimality. Keep explicit weighted-distance mode. The owner was asked about this priority and service radius; defaults remain marked provisional pending a reply, not user-confirmed. This changes the target spec, not the current zero-penalty solver default.
- **Clustering/results:** distinguish physical locations from visits, raw/requested/effective cluster counts, spatial diameter from directed travel, and seed agreement from probability. Correct singleton/H3 statistics; bound size repair, auto-k and expanded sweeps. State greedy visit-bundling limitations and expose partition capacity lower bounds without claiming optimal truck counts.
- **Business accounting:** inventory allocation is a snapshot experiment; only independently validated loads contribute planned shipment/revenue. Reconcile excluded, eligible, allocated, planned and unplanned pieces. Fixed allocation and complete service cannot gain revenue merely by changing k. Require compatible mathematical problems for objective ranking and compatible cohorts for automatic Pareto summaries.
- **Delivery:** preserve milestone numbering, but make M1 a small durable synthetic end-to-end pipeline and M4 the useful first release. Keep basic leases/fencing now; defer general scheduling and optional Labs/second engines. Preserve the existing pending design review and questionnaire assumptions.
- **Operations:** reconcile spec with the already-confirmed requirement for both amd64 and arm64. Clarify that Caddy's browser-facing ingress must enforce private access; a Tailscale backend alone does not protect a public unauthenticated proxy. These are deployment requirements, not changes to a live deployment.
- **Verification:** `bun run lint`, `bun run typecheck`, `bun run build`, optimizer pytest (20 passed, `UV_PYTHON=python3.13`), Ruff, and `git diff --check` passed. Only the spec, progress and decision documents changed. New v1.6 semantics remain unimplemented and are tracked as gaps.

## 2026-09-30: Root-only tracked agent guidance (Codex)
- **Decision:** remove tracked `apps/web/AGENTS.md` and `apps/web/CLAUDE.md`; retain the root files as canonical. Move the Next.js bundled-doc instruction into root `AGENTS.md` and ignore any web copies generated by `next dev`.
- **Reason:** the web files contained only a Next.js generated block and an import of each other. Next.js 16.3.7 writes these files into the app directory when it detects an agent, so Git ignore keeps the tracked tree clean even if local development recreates them.

## 2026-09-30: Complete planned PR 1/PR 2 foundations (Codex)
- **Scope reconciliation:** the optimizer foundation was merged as GitHub PR #5; the previous progress note called the next persistence step “PR 2.” Actual GitHub PRs #1/#2 were already-merged gallery changes. This session completes the planned foundation scope locally on `codex/m1-durable-foundation`, without treating it as completion of all M1 or changing the spec.
- **Capability honesty:** added implemented/planned/unsupported availability and restrictions; cluster-diameter enforcement is planned with no fictitious fixture. Preserved all optimizer pins and the open-route/prohibited-leg proofs.
- **Persistence:** Drizzle 0.45.3, better-sqlite3 13.0.3, Drizzle Kit 0.31.11; Node-only access. Eight minimal tables cover immutable scenario versions, settings/input snapshots, sequential jobs, attempt/event history, and content-addressed compressed artifacts. SQLite triggers protect immutable inputs. `BEGIN IMMEDIATE` claims, token/worker/attempt fences, ordered idempotent callbacks, bounded crash retries and separate cancellation requests implement the durable core. Permanent failures do not retry. Startup migration runs through Next.js instrumentation before requests.
- **Artifacts:** for bounded M1 JSON artifacts, validate/compress before the transaction and atomically commit all payloads/references plus final event/status. This avoids a separate upload staging protocol until larger transfers require it. Caps are 8 MiB per artifact, 16 MiB per completion, 100 artifacts and 64 KiB per event. Readback verifies SHA-256 and length. Hashes cover canonical JSON with sorted object keys and preserved array order; mathematical cross-language cache keys remain next-slice work.
- **Contracts:** Pydantic owns v1 stage manifests, snapshots and worker envelopes; offline export generates JSON Schema and OpenAPI TypeScript types. AJV validates generated schemas and a shared fixture round-trips in Python/TypeScript. No fake mathematical stage endpoints were added to make types appear implemented.
- **Boundary:** worker HTTP authentication/loopback enforcement, Python supervisor/process cancellation, actual pipeline stages, product results/exports, CI and container publication remain next M1 work. Persistence cancellation does not claim to terminate CPU work by itself. Design assumptions and pending M2 review are unchanged. No remote publication or deployment data changes.
- **Evidence:** 14 Node Vitest tests, 23 optimizer pytest tests, lint, typecheck, production build, Ruff check/format and deterministic contract regeneration. Separate processes race claims and heartbeat/completion against temporary WAL databases. Production startup with a fresh temporary DATA_DIR returned HTTP 200 after migration. Native Node 24 only; image architectures are not yet verified. Operational details and backup/restore guidance: `docs/durable-foundation.md`.

## 2026-09-30: Public project and direct-main workflow (Codex)
- **Owner correction:** Fillrate is a public GitHub project and the web tool is intended for public access. The prior private-workbench and tailnet-only deployment assumptions are superseded. The README is a short development overview without setup instructions or a claim that the full workflow is implemented.
- **Spec v1.7:** preserve a public HTTPS target at `fillrate.blasingame.dev` with private internal services. The current lack of user authentication and data isolation means only synthetic read-only surfaces are suitable for public exposure. Before public writes, solver submissions, imports, or real customer data, design and test identity/tenant isolation or an equivalent explicit policy, resource quotas, rate limits, and abuse controls. This is a release gate, not an implementation claim. The hostname returned HTTP 502 when checked during this session; no deployment was modified.
- **Git workflow:** for this phase the owner wants only `main`, no open PRs, and all completed local work published to GitHub `main`. Remove old merged local/remote branches after a verified fast-forward; do not delete unique work. Future work may use temporary local isolation only if cleaned up after verification.

## 2026-09-30: Minimal public home page (Claude Code)
- **Home page:** `/` is only a centered, theme-aware globe (mvpblocks "globe" block, vendored as `components/ui/globe.tsx`) that opens https://github.com/timblazing/fillrate in a new tab. The milestone text and gallery link were removed from `/`.
- **cobe 2.x:** the upstream block relies on `onRender`, which cobe 2.0 removed; the globe drew once before its map texture loaded. `globe.tsx` now drives rendering with `requestAnimationFrame` + `globe.update({ phi })`. cobe reads options at creation, so the wrapper remounts it (via `key`) on theme change; this is why the effect intentionally has an empty dependency list (one lint warning).
- **Colors:** globe accent comes from `--route-1` and dark-mode base from `--muted-foreground`, resolved with `useCssColors` and converted to cobe's 0..1 RGB.

## 2026-09-30: First web image deploy
- **Decision:** ship the frontend as one Docker image: root `Dockerfile` (Bun install/build on `node:24-bookworm-slim`, Next.js `output: "standalone"` traced from the repo root, runs `node apps/web/server.js` as `node` on port 3000, `DATA_DIR=/app/data`). `.github/workflows/image.yml` is `workflow_dispatch`-only and pushes `ghcr.io/timblazing/fillrate:latest` and `:sha-<short>` for `linux/amd64`. The GHCR package starts private.
- **Gallery:** `/dev/components` and `/dev/blocks/<id>` no longer 404 in production; the owner wants the component library publicly viewable.
- **Deferred:** push/tag triggers, `ci.yml`, the optimizer image and multi-service compose.
- better-sqlite3 13 ships prebuilt binaries for linux/darwin/win32 x64/arm64, so it was removed from `trustedDependencies`; its implicit node-gyp install script needed Python and failed in the image build.

## 2026-09-30: Gallery chrome cleanup
- **Decision:** the public gallery drops the "dev only" header badge, the per-specimen `spec §…` labels and source-file badges (`Specimen` no longer takes `source`/`spec`), and visible spec references in group descriptions. Group headers put the `01` index inline with the title at the same size instead of a taller side numeral.
- **No single-edge accent bars.** Selection is shown with a full border in the item's color plus a light tint (cluster cards), or by dimming the unselected items (cluster legend), or a background highlight (selected table row), never a colored top or side stripe.
- Iteration table has one header row; metric groups are shown by column dividers and header tooltips. Setting rows show "Reset" next to the source badge so controls stay flush right. The workbench block's panels are flush (no inner rounded cards) with visible resize grips; the block header dropped "Saved · author" and the travel-mode badge.

## 2026-09-30: Gallery communication pass from premium-planner research (Claude Code)
- **Source:** the owner's research notes on ORTEC, NextBillion, OptimoRoute, Routific, Route4Me, PTV, and Wise. Main takeaway: show business objects first and keep the algorithm underneath. Also: A-vs-B comparisons, switchable views of one selection, and edits made on a working copy.
- **Business objects lead:** new `PlanFlow` (orders → allocated → stops → clusters → trucks → shipped, with amber notes for what left the flow) sits above the metric groups on Results and above the stages on Run pipeline. `PipelineStages` stays as "pipeline detail", and each stage now leads with its output (`output: { value, label }`), e.g. "158 trucks".
- **Section tabs:** the nine spec §4 sections are unchanged. They are grouped visually as Inputs (Data, Inventory, Fleet), Rules (Constraints, Travel), Plan (Allocate, Cluster, Solve), and Results.
- **Comparison:** new `RunCompare` shows A/B headers, a Metric | A | B | B − A table with direction-aware deltas, and the settings diff. `ConfigDiff` shows changed rows first and hides unchanged rows behind a toggle. Comparability comes from the settings diff (`settingsDiff`): a changed inventory, allocation strategy, or circuity puts the pair in a changed-assumption comparison and shows a warning. Otherwise it says "directly comparable" (spec §10 comparisonSignature). The comparison block dropped the duplicate `RunMetricGroups`.
- **Color rules:** inventory coverage has two states, covered (≥100%, success) or short (warning). Short pieces with stock available are labeled "excluded", not given a $0 shortfall. Fill thresholds are exported (`FILL_LOW`, `FILL_FULL`), and `FillBandLegend` sits next to band-colored meters. Cluster-colored strips instead get a dashed 60% line and an "N under 60%" count.
- **Workbench:** the bottom panel is Loads | Order lines | Unshipped. Loads draws every truck as a to-scale trailer. The inspector is exception-first: it lists only trucks under 60% and links to Loads. The View menu applies presets (Planning 65/35, Loading 40/60, Analysis 30/70) through the react-resizable-panels group ref. Selection is kept.
- **Later milestones:** the route timeline adds visit numbers, labels for waits of 30 min or more, per-vehicle wait totals, and an Unassigned pool row. `EditSession` models manual edits as a working copy: Discard / Evaluate → violations and deltas → Save as manual baseline. The source run is never mutated.
- **Small fixes:** `plural()` in `units.ts` ("1 stop"). Trade-off chart labels only non-dominated/selected runs, merges labels for runs at the same point, and has axis titles. Stability shows "n/a" with a reason.

## 2026-09-30: In-app design review at /dev/review (Claude Code)
- **Decision:** replace the earlier Google Form with `/dev/review`: each gallery block beside a short questionnaire (25 questions, mostly multiple choice, about 5–10 minutes). The questions cover the revised blocks' wording and presentation, the pending §1 assumptions (value tiebreak, combining orders at one address, trucks-first vs miles, what the 500-mile rule covers), and sample CSV rows. Questions live in `apps/web/src/app/dev/review/questions.ts`; ids are stored with answers and must not be reused.
- **Storage:** answers autosave (debounced) to a new `design_reviews` SQLite table (migration `0002_design_reviews`), one row per reviewer browser, and to localStorage as a fallback. The owner reads them at `/dev/review/responses?key=…` or downloads JSON from `/dev/review/responses/json?key=…`, then records the outcome here.
- **Access (spec §14 public writes):** in production, saving and reading require `REVIEW_KEY` (passed as `?key=` in the review link; constant-time compare). Without the env var the form renders but cannot save. Answers are validated against known question ids and option values, and each response is capped at 64 KB. This is a narrow, single-purpose write, not general public persistence.
- **Deployment:** the container must mount a volume at `/app/data` so answers survive image updates, and set `REVIEW_KEY`.

