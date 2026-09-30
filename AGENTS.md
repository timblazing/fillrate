# Fillrate: agent instructions

Canonical instructions for Codex and Claude Code (`CLAUDE.md` just imports this file).

## Start of every session
1. Read this file, `docs/progress.md`, `docs/decisions.md`, and the relevant sections of `fillrate-technical-spec.md`.
2. The owner currently wants one branch (`main`) and no pull requests. Work directly on `main` when practical; if isolation needs a temporary branch, fast-forward it into `main` and remove it after verification. Commit messages reference the milestone (e.g. `M1: …`).
3. Before ending: update `docs/progress.md` and append to `docs/decisions.md`; leave lint/typecheck/build passing or record exactly what fails.
4. If milestone progress moved, update `apps/web/src/app/dev/status.ts` too (see "Progress page" below).

## Progress page (`/dev`)
`/dev` is the owner's build-progress dashboard. It is static and built from the repo at build time:
- **Parsed automatically:** milestone names, deliverables and exit evidence from spec §15's table; milestone checklists, "Waiting on the primary user", "Next step" and "Known gaps" from `docs/progress.md`; every `## YYYY-MM-DD: Title (Author)` entry in `docs/decisions.md`. Keep those headings and formats, or update the parser in `apps/web/src/lib/server/project-docs.ts`.
- **Hand-kept in `apps/web/src/app/dev/status.ts`:** each milestone's weight (share of the spec; weights sum to 100), done %, state (`done | active | waiting | planned`) and one-line notes; the focus milestone; `productBehavior` (% of the spec that is working product behavior); the ordered `nextUp` list; and the `updated` date. Update these at the end of any session that moves a milestone. Fixtures and gallery mocks don't count as done (spec §15).
- The Docker build needs `docs/` in its context (it is no longer in `.dockerignore`).

## Repository layout (spec §2)
```
apps/web              Next.js App Router + coss ui (Base UI) + mapcn
services/optimizer    Python FastAPI + PyVRP + OR-Tools + scikit-learn (uv, Python 3.13)
packages/db           Drizzle schema/migrations, SQLite durable jobs/artifacts
packages/contracts    Pydantic-generated envelopes, JSON Schema and TypeScript types
examples              Bundled lesson scenarios (not started)
docs                  decisions.md, progress.md, and other docs
deploy                Compose, Valhalla prep (not started); root `Dockerfile` builds the web image
fillrate.fig          OpenPencil design file: Foundations / Components / Blocks
```

## Commands (run from the repo root; Bun is the package manager and script runner, Node 24 is the runtime)
- `bun install`: install workspace deps (commit `bun.lock`)
- `bun run dev`: Next.js dev server (http://localhost:3000)
- `bun run lint` / `bun run typecheck` / `bun run build`
- `bun run test`: Node Vitest persistence/contract tests; `bun run contracts:generate`: regenerate shared contracts from Python
- `bun run db:generate`: generate migrations after schema changes; migrations apply automatically at web startup
- Optimizer (from `services/optimizer`): `uv sync`, `uv run pytest`, `uv run ruff check .`, `uv run fillrate-optimizer` (FastAPI on 127.0.0.1:8000). If uv trips over a stray Python 2.7 on PATH, set `UV_PYTHON=python3.13`.

## Frontend conventions
- `apps/web/src/components/ui/*` is vendored registry code: [coss ui](https://coss.com/ui/docs) primitives built on Base UI, plus mapcn `map.tsx` and the two shadcn leftovers coss has no equivalent for (`chart.tsx` for Recharts, `resizable.tsx`). Add or update it with the shadcn CLI from `apps/web`:
  `bunx --bun shadcn@latest add @coss/<name>` / `bunx --bun shadcn@latest add @mapcn/map`. Avoid hand-editing it. Customize by composition or through tokens. Component docs for agents: `https://coss.com/ui/llms.txt`.
- Base UI, not Radix: compose with the `render` prop (`<DialogTrigger render={<Button variant="outline" />}>Open</DialogTrigger>`), never `asChild`. Use coss part names (`*Popup`, `*Panel`, `TabsTab`, `Menu*`, `PreviewCard`, `Group`) rather than the shadcn aliases coss re-exports. Multi-value controls (`ToggleGroup`, `Accordion`, `CheckboxGroup`) take arrays; `Slider` takes a number or an array.
- Status colors come from coss tokens `--info`, `--success`, `--warning`, `--destructive-foreground` (Badge/Alert `info|success|warning|error` variants, toast types).
- Toasts: `toastManager.add/promise` and `anchoredToastManager.add` from `@/components/ui/toast`; the providers are in `app/layout.tsx`.
- Design tokens live as CSS variables in `apps/web/src/app/globals.css` (`:root` + `.dark`), with shadcn/coss names (coss adds `--info/--success/--warning` and `--destructive-foreground`) plus `--route-1..8`. The OpenPencil Foundations page mirrors these names exactly; token changes flow .fig → globals.css.
- MapLibre paints on a canvas and cannot read `var()`/oklch. Resolve tokens with `useCssColors` from `src/lib/css-color.ts` before passing colors to map layers.
- Theme: `next-themes` (`class` attribute, light/dark/system). Use `ThemeToggle` from `src/components/theme`.
- `/dev` pages share `DevHeader` (`src/components/brand/dev-header.tsx`: app icon plus Progress / Design system / Review nav). Use it on any new `/dev` page.
- `/dev/components` is the component gallery (public in production since the first image deploy). Keep it current when adding components; it is the reference for the design system.
- Do not use Bun-only APIs (`bun:sqlite`, `Bun.*`) in application code (spec §2).
- Before using Next.js APIs, read the relevant bundled guide in `apps/web/node_modules/next/dist/docs/`. Next.js may generate local agent files in `apps/web` during `next dev`; the root `AGENTS.md` and `CLAUDE.md` remain canonical.
