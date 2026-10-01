# Fillrate: agent instructions

Canonical instructions for Codex and Claude Code (`CLAUDE.md` just imports this file).

## Project management source of truth
Linear is the canonical hub for Fillrate's product specification, roadmap, milestones, issues, project decisions, and progress updates. Use the Linear project **Fillrate** in the **TimBlazing** team. Its project documents hold the specification and project records; its milestones and issues track planned and active work. Do not create a parallel task list in repository Markdown.

The repository copies are retained as backups and for the `/dev` progress page. `docs/fillrate-technical-spec.md` is the in-repo spec snapshot; the root `fillrate-technical-spec.md` is retained as the original backup. `docs/progress.md`, `docs/decisions.md`, `docs/status.json`, the other `docs/` files, and this file also remain in Git. When project scope or progress changes, update Linear first and refresh the relevant repository snapshot so `/dev` and Git history remain useful. If a snapshot conflicts with Linear, Linear wins.

## Start of every session
1. Read this file and check `git status`.
2. Use the local Composio CLI for Linear. Read the Fillrate project's current documents and relevant milestones/issues; use the canonical project specification and linked source material for the task. Do not rely on the repo snapshots as current if they differ from Linear.
3. The owner currently wants one branch (`main`) and no pull requests. Work directly on `main` when practical; if isolation needs a temporary branch, fast-forward it into `main` and remove it after verification. Commit messages reference the milestone (e.g. `M1: …`).
4. Before ending, update the relevant Linear issues/documents with status and evidence. Refresh corresponding repository snapshots when they changed. Leave lint/typecheck/build passing or record exactly what fails.
5. If milestone progress moved, update `docs/status.json` too (see "Progress page" below).

## Execution labels and hosted/local modes
- Use TimBlazing issue labels: `cloud-ready` for repository work runnable in cloud; `local-required` for OpenPencil, target hardware or deployment access; `action-needed` when the owner must supply input/configuration. Use one execution label; `action-needed` may overlap. Label remaining work, not historical Done evidence. Split mixed umbrella issues before delegating a bounded cloud increment.
- Labels do not start agents. Assign ownership to Clay as appropriate; delegate to Codex or mention it only when explicitly starting a ready task. Cloud work returns changes/evidence for local integration into `main`; it must not create PRs or auto-push. Supply relevant Linear context when cloud lacks the local Composio session.
- Spec v1.10 plans a free hosted service with Better Auth, owner-scoped server SQLite data and application compute quotas. Authentication alone does not establish data isolation or abuse protection. Until these gates pass, retain operator protections and bounded synthetic demonstrations.
- Planned local distribution is account-free/single-user via Bun, npm and Docker, with loopback defaults and no auth credentials. Hosted/local mode must be explicit and hosted misconfiguration must never disable auth. npm compatibility and Better Auth are planned work, not existing support. Python remains a private worker and never opens SQLite.
- GitHub CI automatically runs only for relevant source/configuration changes. Documentation and `.fig` changes skip automatic checks. Image build/smoke/publish runs only for `v*` release tags or explicit dispatch, with reusable CI as prerequisite. Dispatch an image release when deployable runtime changes need publication; a Git push alone does not update the deployed image.

## Progress page (`/dev`)
`/dev` is the repo-backed build-progress dashboard and displays snapshots, not live Linear data. It is prerendered from the repo at build time, then refreshed in the browser from `raw.githubusercontent.com/timblazing/fillrate/main/` (about 5 minutes after a push, GitHub's CDN cache). Linear remains authoritative for current status. Doc and estimate changes need no image rebuild. Parser or layout changes still do, and if any fetched file fails to load or parse, the page keeps the build snapshot:
- **Parsed automatically:** milestone names, deliverables and exit evidence from spec §15's table; milestone checklists, "Waiting on the primary user", "Next step" and "Known gaps" from `docs/progress.md`; every `## YYYY-MM-DD: Title (Author)` entry in `docs/decisions.md`. Keep those headings and formats, or update the parser in `apps/web/src/lib/project-docs.ts` (shared by the server and the browser).
- **Hand-kept in `docs/status.json`** (types in `apps/web/src/app/dev/status.ts`): each milestone's weight (share of the spec; weights sum to 100), done %, state (`done | active | waiting | planned`) and one-line notes; the focus milestone; `productBehavior` (% of the spec that is working product behavior); the ordered `nextUp` list; and the `updated` date. Update these at the end of any session that moves a milestone. A milestone without an entry is hidden. Fixtures and gallery mocks don't count as done (spec §15).
- The Docker build needs `docs/` in its context (it is no longer in `.dockerignore`).

## Repository layout (spec §2)
```
apps/web              Next.js App Router + coss ui (Base UI) + mapcn
services/optimizer    Python FastAPI + PyVRP + OR-Tools + scikit-learn (uv, Python 3.13)
packages/db           Drizzle schema/migrations, SQLite durable jobs/artifacts
packages/contracts    Pydantic-generated envelopes, JSON Schema and TypeScript types
examples              Bundled synthetic scenarios (`m1-synthetic.json`, generated by `fillrate_optimizer.synthetic`)
docs                  Linear backup snapshots, progress dashboard inputs, and technical references
deploy                `entrypoint.sh`, `smoke.sh` (+ `smoke_*.py`), `compose.yaml`, `.env.example`; root `Dockerfile` builds the web + optimizer image
fillrate.fig          OpenPencil design file: Foundations / Components / Blocks
```

The canonical specification is the **Technical Specification** document in Linear. The repository copy is [`docs/fillrate-technical-spec.md`](docs/fillrate-technical-spec.md); the root `fillrate-technical-spec.md` is a retained backup.

## Commands (run from the repo root; Bun is the package manager and script runner, Node 24 is the runtime)
- `bun install`: install workspace deps (commit `bun.lock`)
- `bun run dev`: Next.js dev server (http://localhost:3000); it also serves the loopback worker transport on 127.0.0.1:3100
- `bun run worker`: Python worker supervisor that claims and runs pipeline jobs (run it next to `bun run dev`, then use `/runs`)
- `bun run lint` / `bun run typecheck` / `bun run build`; `bun run test:browser` runs the production browser smoke (see `docs/browser-smoke.md`)
- `bun run test`: Node Vitest persistence/contract/transport tests plus end-to-end tests that spawn the real Python worker (needs `uv`; `FILLRATE_SKIP_PYTHON=1` skips them); `bun run contracts:generate`: regenerate shared contracts from Python
- `bun run db:generate`: generate migrations after schema changes; migrations apply automatically at web startup
- `bun run zcta:build`: download the pinned Census Gazetteer ZCTA file and write the ZIP fallback lookup to `data/zcta-gazetteer-2024.tsv` (the image builds its own). Geocoding env: `FILLRATE_GEOCODER=off`, `CENSUS_GEOCODER_URL`, `GEOCODE_BATCH_SIZE`, `ZCTA_LOOKUP_PATH`
- Optimizer (from `services/optimizer`): `uv sync`, `uv run pytest`, `uv run ruff check .`, `uv run fillrate-optimizer` (FastAPI on 127.0.0.1:8000; `FILLRATE_WORKER=1` also starts the supervisor). After changing `synthetic.py`, run `uv run python -m fillrate_optimizer.synthetic`; after changing `model.py`/`contracts.py`, run `bun run contracts:generate`.
- Images are built and smoke-tested only in GitHub Actions (`image.yml`, amd64 + arm64); don't build Docker images locally. If uv trips over a stray Python 2.7 on PATH, set `UV_PYTHON=python3.13`.

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
