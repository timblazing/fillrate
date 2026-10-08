# Fillrate: agent instructions

Canonical instructions for Codex and Claude Code (`CLAUDE.md` imports this file). Read [`docs/product.md`](docs/product.md) for what Fillrate does and the current direction.

**Keep it simple.** Fillrate is a small tool for a few users. Prefer deleting code over adding it. Add no new services, deployment targets, process documents or evidence records. Don't write progress logs; the PR and its issue are the record.

## Workflow
1. Each session works in its own Git worktree and branch from the latest `origin/main`. Check `git status` and `git worktree list` first, and never reuse or reset another session's work.
   ```sh
   git fetch origin main
   git worktree add -b <short-name> ../fillrate-<short-name> origin/main
   ```
2. Pick or create a GitHub issue for the work, and set its status on the [Fillrate work project](https://github.com/users/timblazing/projects/2) (Triage, Ready, In progress, Blocked, Done).
3. Commit in small, clear commits. Push and open one PR to `main` that links the issue, summarizes the change and lists what you verified.
4. Squash-merge once checks pass. Then clean up: delete the remote branch, fast-forward local `main`, and remove the worktree and local branch. Never delete a branch or worktree with unmerged or uncommitted work.
5. If the work can't be finished, push the branch and leave a short comment on the issue: what's done, what's blocking, the next step.
6. Update `README.md` or `docs/product.md` only when user-facing behavior or a product decision changes.

## Layout
```
apps/web            Next.js App Router UI and API, coss ui (Base UI) + mapcn
services/optimizer  Python FastAPI worker: allocation, k-means, PyVRP, validation (uv, Python 3.13)
packages/db         Drizzle schema/migrations and SQLite access (Node only)
packages/contracts  Types generated from the Python models
examples            Bundled synthetic example scenario
deploy              Dockerfile entrypoint and a sample compose file
```

## Commands (repo root; Bun is the package manager, Node 24 the runtime)
- `bun install`, `bun run dev` (http://localhost:3000), `bun run worker` (Python worker, run next to `dev`)
- `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test`
- `bun run db:generate` after schema changes; migrations apply at web startup
- `bun run contracts:generate` after changing `model.py`/`contracts.py`
- Optimizer (in `services/optimizer`): `uv sync`, `uv run pytest`, `uv run ruff check .`
- Don't build Docker images locally; CI builds them.

## Conventions
- Python is a private worker and never opens SQLite. Don't use Bun-only APIs (`bun:sqlite`, `Bun.*`) in application code.
- `apps/web/src/components/ui/*` is vendored registry code. Add or update it with `bunx --bun shadcn@latest add @coss/<name>` from `apps/web`; don't hand-edit it.
- Use Base UI's `render` prop, never `asChild`. Status colors come from the coss tokens `--info`, `--success`, `--warning` and `--destructive-foreground`.
- Design tokens live in `apps/web/src/app/globals.css`. MapLibre can't read CSS variables, so resolve colors with `useCssColors` from `src/lib/css-color.ts`.
- Product pages under `app/(app)` render inside `AppShell` (add new routes to `crumbsFor` in `components/app/app-shell.tsx`) and return one `<Page>` from `@/components/app/page` with a `<PageHeader>` and `<PageSection>`s. Don't set per-page `max-w-*`, `mx-auto` or padding. Sidebar nav is in `components/app/app-sidebar.tsx`.
- Before using a Next.js API, read the bundled guide in `apps/web/node_modules/next/dist/docs/`.
- Browser checks use the local `agent-browser` CLI only (headless; desktop 1440×900 and iPhone 16 393×852), against local servers with synthetic data.
