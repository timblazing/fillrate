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
