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
4. Squash-merge once lint, typecheck, test, `build` and `build:static` pass locally; there is no CI. Then clean up: delete the remote branch, fast-forward local `main`, and remove the worktree and local branch. Never delete a branch or worktree with unmerged or uncommitted work.
5. If the work can't be finished, push the branch and leave a short comment on the issue: what's done, what's blocking, the next step.
6. Update `README.md` or `docs/product.md` only when user-facing behavior or a product decision changes.

## Layout
```
apps/web            Next.js App Router UI and API, coss ui (Base UI) + mapcn
services/optimizer  Python FastAPI solver service: allocation, k-means, PyVRP, validation (uv, Python 3.13)
packages/db         Drizzle schema/migrations and SQLite access (Node only)
packages/contracts  Types generated from the Python models
examples            Bundled synthetic example scenario
```

## Commands (repo root; Bun is the package manager, Node 24 the runtime)
- `bun install`, `bun run dev` (http://localhost:3000), `bun run optimizer` (Python solver service on 127.0.0.1:8000, run next to `dev`)
- `bun run lint`, `bun run typecheck`, `bun run build`, `bun run test`
- `bun run db:generate` after schema changes; migrations apply at web startup
- `bun run contracts:generate` after changing `model.py`/`contracts.py`
- Optimizer (in `services/optimizer`): `uv sync`, `uv run pytest`, `uv run ruff check .`

## Conventions
- Runs are direct solves: the web app inserts a run, then calls the Python service (`POST /solve`, one at a time; `FILLRATE_OPTIMIZER_URL`). Python is private and never opens SQLite. Don't use Bun-only APIs (`bun:sqlite`, `Bun.*`) in application code.
- `apps/web/src/components/ui/*` is vendored registry code. Add or update it with `bunx --bun shadcn@latest add @coss/<name>` from `apps/web`; don't hand-edit it.
- Use Base UI's `render` prop, never `asChild`. Status colors come from the coss tokens `--info`, `--success`, `--warning` and `--destructive-foreground`.
- Design tokens live in `apps/web/src/app/globals.css`. MapLibre can't read CSS variables, so resolve colors with `useCssColors` from `src/lib/css-color.ts`.
- Product pages under `app/(app)` render inside `AppShell` (add new routes to `crumbsFor` in `components/app/app-shell.tsx`) and return one `<Page>` from `@/components/app/page` with a `<PageHeader>` and `<PageSection>`s. Don't set per-page `max-w-*`, `mx-auto` or padding. Sidebar nav is in `components/app/app-sidebar.tsx`.
- Before using a Next.js API, read the bundled guide in `apps/web/node_modules/next/dist/docs/`.
- Browser checks use the local `agent-browser` CLI (installed globally, not a repo dependency), headless at desktop 1440×900 and iPhone 16 393×852, against local servers with synthetic data.

## Cloud agents

For Claude (GitHub Actions, `@claude`) and Codex (Codex Cloud, `@codex`) working on this repo in the cloud.

- Skills come from [timblazing/skills](https://github.com/timblazing/skills). The Claude workflow installs them before each run, and so does the Codex Cloud environment's setup script. Use `pr-workflow` to land changes and `leaving-pr-comments` for anything you post on GitHub.
- Never push to `main`. Work on a branch and open a pull request.
- Verify with `bun run build`, `bun run typecheck`, `bun run test` and `bun run lint` before you push (install first with `bun install`).
- Do not update local session logs or work logs (for example `docs/WORKLOG.md`); put remaining work in the PR description.
- End every issue comment you post with a status marker on its own last line, as an HTML comment (GitHub doesn't show it): `<!-- proj-agent: needs-input -->` when you are waiting on an answer from the owner, `<!-- proj-agent: working -->` for an acknowledgement or progress note, `<!-- proj-agent: done -->` once the work is finished. proj reads it to show the issue's status.
- The shared instructions installed with the skills are written for a local Mac. In the cloud, skip the local-only rules: browser work through `agent-browser` (and the `ui-check`, `ui-qa`, `ui-evidence` skills), iOS simulators and Android emulators, the Docker/VM rules and T3 Code tools. Say in the PR what still needs checking by hand.

## Code Review Rules

For `@codex review` and any other code review of this repo.

- Focus on correctness, security and regressions: bugs, unhandled edge cases, data loss, leaked secrets, missing auth or validation, and behavior that changed without the PR saying so.
- Skip style nits, formatting and naming preferences unless they hide a bug.
- Point at the exact line, say what breaks and when, and suggest a fix. Say so when nothing needs changing.

## Docs

Project documentation is markdown in `docs/`, and proj's Docs tab shows it. Keep it in this layout:

```
docs/
  README.md          index: what the project is, and links to everything below
  architecture.md    how it fits together (an architecture/ folder when it gets large)
  decisions/         ADRs, one per decision: NNNN-short-title.md
  guides/            how-tos: setup, deploy, release
  runbooks/          ops: what to do when X breaks
  reference/         APIs, config, data model
```

- When you change behavior, config, an API or the deploy process, update the doc that describes it in the same PR. Don't leave docs describing the old behavior.
- Record a significant decision as a new ADR in `docs/decisions/` (next number, short title, with Context, Decision and Consequences headings).
- Start every doc with a single `# Title` heading, and use relative links between docs. Keep `docs/README.md` linking to everything else.
- If the existing docs are somewhere else or laid out differently, don't reshuffle them as a side effect of other work; move them in a PR of their own.
