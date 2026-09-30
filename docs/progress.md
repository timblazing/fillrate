# Progress

## Milestones (spec §15)
- [ ] **M1 Foundation and capability proof**
  - [x] Monorepo skeleton, root Bun workspace, git
  - [x] `apps/web`: Next.js 16 + Tailwind 4 + coss ui (Base UI) + mapcn, light/dark/system theme (migrated from shadcn radix-nova on 2026-09-29)
  - [x] Dev-only component gallery at `/dev/components`
  - [x] Gallery expanded into the design-system reference: Foundations, Primitives, Lab components (`src/components/lab`), Charts (Recharts + bklit), Map, Blocks
  - [x] `AGENTS.md`, `CLAUDE.md`, `docs/decisions.md`, `docs/progress.md`
  - [ ] Pinned Python 3.13 / uv / PyVRP / OR-Tools / scikit-learn / FastAPI (`services/optimizer`)
  - [ ] Drizzle schema + migrations, SQLite pragmas, migrate-on-start (`packages/db`)
  - [ ] API contracts (`packages/contracts`), worker claim/lease flow
  - [ ] Minimal real PyVRP solve, capability fixtures (incl. open routes and prohibited edges), first export
  - [ ] Dockerfile, `ci.yml`, `image.yml`
- [ ] **M2 Design** (in progress in `pyvrp-lab.fig` via OpenPencil; see below). Blocks now center on the pipeline screens (spec v1.3 §15).
- [ ] M3 Core pipeline (import → allocate → cluster → per-cluster PyVRP → cluster cards and truck loads)
- [ ] M4 Iterations (k explorer, sweeps, comparison, unshipped reasons, Fulfillment pipeline lesson)
- [ ] M5 Allocation depth and imports (CP-SAT, other strategies, whole-order mode, geocoding)
- [ ] M6 Remaining PyVRP features and roads (OSRM)
- [ ] M7 Learning and exports
- [ ] M8 Verification and handoff

## Current state
Only the frontend foundation exists. `bun run lint`, `bun run typecheck`, and `bun run build` pass. The gallery (`src/app/dev/components`, split into `sections/*`) renders every installed coss ui component, the PyVRP Lab product components, nine chart recipes, the mapcn map, and two composed blocks (workbench, results header), in light and dark, with a scroll-spy nav and a ⌘K jump menu.

Lab components (`src/components/lab`): `JobStatusBadge`/`JobStatusDot`, `CoordinateSourceBadge`, `TravelModeBadge`, `SettingSourceBadge`/`SettingRow`, `RouteSwatch`/`RouteLegend`, `StatTile`/`Sparkline`, `RouteTimeline`, `DataTable` (TanStack Table v9), `DiagnosticList`, `MatrixHeatmap`, `ConfigDiff`, `CodeBlock`, `Explainer`, `ImportDropzone`. Chart compositions live in the gallery as recipes until real contracts exist (M3).

## Design workflow (M2 prep)
1. **Foundations** page in `pyvrp-lab.fig`: variables named exactly like the CSS tokens in `apps/web/src/app/globals.css` (light + dark modes), plus type scale, radius, spacing, and `route-1..8`.
2. Export tokens → `globals.css`; check them in `/dev/components`.
3. **Components**: coss ui/mapcn components bound to those variables, compared against the gallery.
4. **Blocks**: app shell, orders and inventory, run pipeline, k explorer, cluster cards, truck loads, unshipped reasons, iteration comparison, and map (spec v1.3 §8a, §10). Route timeline is secondary.
5. Record the accepted direction in `docs/decisions.md`. M2 then builds the Blocks as real React screens.

## Known gaps
- Chart and route palettes are placeholders (neutral shadcn chart colors, provisional route colors). Gallery charts use `--route-*` for series until a real chart palette lands.
- New tokens `--chart-background/-foreground/-foreground-muted/-label/-grid` (aliases for bklit) and the coss status tokens `--info/--success/--warning(-foreground)`, `--destructive-foreground` are not on the OpenPencil Foundations page yet.
- bklit radar logs harmless motion "undefined is not animatable" warnings in dev (vendored code).
- `MatrixHeatmap` renders every cell; 500-stop matrices will need virtualization.
- Spec v1.3: the per-piece value tiebreak and combining orders at one address are still assumptions, and there is no sample data from the primary user yet (see the `docs/decisions.md` follow-up entry).
- Existing lab components and gallery blocks predate v1.3; cluster cards, truck-load, and unshipped-reason components don't exist yet.
- No tests yet (Vitest/Playwright arrive with the rest of M1).
- The OpenPencil Components page still mirrors shadcn components; it needs redoing against coss ui (see the gallery).
- `components/ui/chart.tsx` and `resizable.tsx` are still shadcn (coss has no equivalent).

## Next step
Design the Foundations page in OpenPencil and sync the tokens into `globals.css`, then design the v1.3 pipeline Blocks.
