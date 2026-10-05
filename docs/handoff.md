# Fillrate handoff

Everything someone new needs to set up, verify, operate and continue Fillrate from this repository. It links to the canonical records instead of repeating them; where this page and a linked record disagree, the linked record wins.

| Record | Holds |
| --- | --- |
| [`fillrate-technical-spec.md`](fillrate-technical-spec.md) | Intended behavior, milestones (§15), verification requirements (§16) |
| [`progress.md`](progress.md) | Milestone checklists, dated evidence, known gaps, remaining work |
| [`decisions.md`](decisions.md) | Accepted decisions with dates and authors |
| [`status.json`](status.json) | Hand-kept milestone estimates shown on `/dev` |
| [`release-verification.md`](release-verification.md) | Target-hardware timings, recovery checks, hosted release evidence |
| [`hosted-operations.md`](hosted-operations.md) | Modes, ownership, quotas, hosted configuration, backups, restore, retention |
| [`local.md`](local.md) | Account-free single-user use with Bun, npm or Docker Compose |
| [`browser-smoke.md`](browser-smoke.md) | Production browser acceptance flows |
| [`issues-and-work.md`](issues-and-work.md) | GitHub Issues and the project board |

## What Fillrate is

An open-source planning workbench for order fulfillment and truckload planning: allocate limited inventory to open orders, group delivery stops, build 53-foot trailer loads with a real vehicle-routing solver (PyVRP), validate every result independently, and compare plans by truck fill, geographic tightness and planned revenue. It is not a dispatch or navigation system. Travel is estimated (haversine × circuity at constant speed) unless an imported directed matrix is selected.

It runs as a free hosted site with request-only GitHub accounts (`FILLRATE_MODE=hosted`), as an account-free single-user install (`FILLRATE_MODE=local`), or in the original operator mode (mode unset, key-protected in production).

## Current state

Per milestone, as of 2026-10-05. States follow the hand-kept estimates in `status.json` (also shown on `/dev`); the checklists and evidence are in `progress.md`.

| Milestone | State | Summary |
| --- | --- | --- |
| M1 Thin durable fulfillment slice | done | Durable SQLite jobs, leased Python worker, staged pipeline on PyVRP, independent validation, exports, CI and multi-arch image |
| M2 Accepted design | done | Owner-accepted Blocks, `/runs/<id>` and shipment sheet; optional `fillrate.fig` follow-up deferred by the owner |
| M3 Operational core | done | CSV import, versioned scenarios with branches, preflight, cost objective, stage reuse, 2,000-order benchmark |
| M4 Trustworthy experiments / first release | done | k explorer, bounded sweeps, flagship lesson; Better Auth with GitHub, request-only signup, owner isolation, quotas, live owner sign-in on the deployed image |
| M5 Allocation and import depth | done | Five allocation strategies, whole-order mode, CP-SAT, Census geocoding with ZIP/ZCTA fallback |
| M6 Roads and advanced routing | active | Directed travel snapshots, imported matrices, fixture-verified Valhalla job, time windows and service durations; no pinned Valhalla deployment |
| M7 Learning and export depth | active | Fulfillment, allocation, capacity, seed and time-window lessons; schematic timeline; replay bundles |
| M8 Verification and handoff | active | Browser acceptance flows, target-hardware/recovery evidence, native Bun/npm distribution (this page and `local.md`) |

## Architecture

```
browser ──HTTP──▶ apps/web (Next.js 16, App Router)
                   ├─ /api/v1/*  routes; every one resolves the caller with principal() (src/lib/server/access.ts)
                   ├─ packages/db  Drizzle + better-sqlite3 store: scenarios, versions, runs, jobs, artifacts,
                   │               quotas; migrations run at startup (src/instrumentation.ts)
                   └─ worker transport on 127.0.0.1:3100 (token-authenticated, lease-fenced)
                              ▲
                              │ HTTP claim / heartbeat / complete
services/optimizer (Python 3.13, uv): fillrate-optimizer (FastAPI /evaluate + FILLRATE_WORKER=1 supervisor) → child process per job
                   allocation → aggregation → clustering → travel → PyVRP solve → validation → summary
packages/contracts  Pydantic-owned envelopes → JSON Schema / OpenAPI → TypeScript types (AJV validation)
```

Python never opens SQLite; all persistence goes through the web process. The Docker image runs both processes (`deploy/entrypoint.sh`). Repository layout, commands and conventions are in [`AGENTS.md`](../AGENTS.md); the durable job design is in [`durable-foundation.md`](durable-foundation.md); capability claims are in `services/optimizer/src/fillrate_optimizer/capabilities.py`.

## Set up from scratch

Requirements: Node 24, Bun 1.4.2 or npm, uv with Python 3.13, git. Details, platforms and troubleshooting: [`local.md`](local.md).

```sh
git clone https://github.com/timblazing/fillrate.git && cd fillrate
bun install --frozen-lockfile                  # or: npm ci
(cd services/optimizer && UV_PYTHON=python3.13 uv sync --locked)
export FILLRATE_MODE=local
bun run dev                                    # or: npm run dev   (terminal 1)
bun run worker                                 # or: npm run worker (terminal 2)
```

Open http://localhost:3000/learn or `/runs`. `bun.lock` is canonical; `package-lock.json` is kept aligned for direct dependencies by `scripts/npm-lock.mjs` (decision 2026-10-05).

## Verification

Run from the repository root unless noted. Every `bun run` line also works as `npm run` (`npm test`).

| Check | Command | Needs | Where it runs |
| --- | --- | --- | --- |
| Optimizer lint/format | `cd services/optimizer && uv run ruff check . && uv run ruff format --check .` | uv | CI `checks` |
| Optimizer tests | `cd services/optimizer && uv run pytest` | uv | CI `checks` |
| Contracts current | `bun run contracts:generate && git diff --exit-code packages/contracts` | uv | CI `checks` |
| Lint, typecheck | `bun run lint`, `bun run typecheck` | install | CI `checks`; typecheck also CI `npm` |
| Vitest (store, transport, contracts, real-worker e2e) | `bun run test` (`FILLRATE_SKIP_PYTHON=1` skips the worker e2e) | uv | CI `checks` and `npm` |
| Production build | `bun run build` | install | CI `checks` and `npm` |
| npm lockfile alignment | `node scripts/npm-lock.mjs` | both lockfiles | CI `npm` |
| Hosted/local mode and two-account checks | `bun run build && bun run test:hosted` | build | CI `checks` |
| Browser acceptance | `bun run test:browser [--flow=…]` | build, agent-browser runtime | CI `checks`; see `browser-smoke.md` |
| Image smoke | `deploy/smoke.sh <image>` | Docker | `image.yml` only (amd64 and arm64) |
| Target hardware and recovery | `python3 deploy/target_check.py <image@digest> <out-dir> --label <host>` | Docker, Python 3 on the target | Manually on each target; see `release-verification.md` |
| 2,000-order benchmark | `cd services/optimizer && uv run python benchmarks/m3_2000.py [--default-budget]` | uv | `image.yml` (in the image) and by hand |

CI (`.github/workflows/ci.yml`) runs automatically only for source/config changes. Images are built and published only by `image.yml` on `v*` tags or manual dispatch; do not build images locally.

## Measured timings

**Target hardware (image, release `fa9c0b8`)** from [`release-verification.md`](release-verification.md): 2,000 synthetic orders, 640 locations, k=8, inside the image.

| Target | Comparable (500 iterations/cluster), median of 5 | Default budget (10 s/cluster), median of 3 |
| --- | --- | --- |
| VPS, 2 vCPU AMD EPYC 7543P | 5.97 s | 81.43 s |
| Raspberry Pi 5, 4 cores | 7.08 s | 81.55 s |

**Native, cloud dev container, not target hardware** (2026-10-05; Ubuntu 24.04 x86_64, 4 vCPU Intel Xeon 2.10 GHz, 15 GB; Node 22.22.0, npm 10.9.4, Bun 1.4.2, uv 0.8.17, Python 3.13.7). The 4 vCPUs were shared with several other concurrent builds and test suites (load average 6–11), so these are upper bounds from single runs, not benchmarks.

| Step | Wall time |
| --- | --- |
| `npm install` on a fresh clone (resolving and writing the lockfile) | 94 s |
| `npm ci` on a fresh clone, warm npm cache | 42 s |
| `npm run lint` / `npm run typecheck` | 36 s / 37 s |
| `npm test` (142 tests incl. real-worker e2e) | 82 s |
| `npm run build` | 123 s |
| `bun install --frozen-lockfile`, warm Bun cache | under 1 s |
| `bun run lint` / `bun run typecheck` | 49 s / 53 s |
| 2,000-order benchmark, comparable mode, 1 run (`m3_2000.py`) | 11.2 s total (clustering 7.0 s, solve 3.7 s), valid, 205 trucks, 8 clusters |
| `lesson` example (2,000 orders, k=8, API defaults) through `npm start` + `npm run worker`, POST to final status | 9.7 s, valid, complete |
| `m1` example through the same production server | 4.6 s, valid |

Native timings on the VPS and Pi 5 have not been collected.

## Operations

- **Hosted deployment:** [`hosted-operations.md`](hosted-operations.md): modes, required settings, refusal on incomplete configuration (exit 78), ownership, quotas, configuration steps.
- **Backups:** `deploy/backup.sh [container] [dest]` (online SQLite backup through the image, integrity check, SHA-256, 30-day rotation). The reference VPS runs it daily from a systemd user timer. Backups stay on the same server. Native backups: [`local.md`](local.md#backups).
- **Restore/rollback:** `hosted-operations.md` step 5; rehearsed by `deploy/target_check.py` on a disposable volume.
- **Releases:** dispatch `image.yml` (or push a `v*` tag); it runs CI, builds amd64 and arm64, smoke-tests and benchmarks each, then publishes a multi-arch manifest. Deploy by digest after a backup. A push to `main` alone does not update the deployed image.
- **Environment reference:** `deploy/.env.example`.
- **Work queue:** GitHub Issues and the Fillrate project board ([`issues-and-work.md`](issues-and-work.md)); remaining work and dependencies are in `progress.md`.

## Limitations

What is not verified or not built. The full list of known gaps is in `progress.md`.

- **Second live account:** cross-account isolation and quotas are verified by automated production-build tests (`test:hosted`), not with two live GitHub accounts on the deployed site; the owner waived that check.
- **Road travel:** no pinned Valhalla deployment exists. The Valhalla snapshot job is verified against fixtures and a synthetic local service only; `directed_road_travel` stays planned. Route paths are schematic straight lines.
- **Native timings on targets:** the VPS and Pi 5 timings are for the image. Native Bun/npm timings exist only for the shared cloud dev container above.
- **npm on Node 24:** the full native npm workflow (install through a real worker run) was run on Node 22 in the dev container. Node 24 + npm is covered by the CI `npm` job (install, lockfile alignment, typecheck, Vitest with the real worker, build); its first run is on the pull request that adds it.
- **Docker Compose local mode:** checked by the image smoke (keyless local startup and a run on amd64 and arm64). `docker compose up` with `deploy/compose.yaml` in local mode was not run for this handoff.
- **Platforms:** Linux x86_64 native and Linux amd64/arm64 images are verified. macOS native is unverified; native Windows is unsupported.
- **Backups:** on-server only; they do not survive server or disk loss. Off-server backup was deferred by the owner.
- **Browser coverage:** cancellation and scenario edit/branch browser flows, and the optional `/request-access`/`/admin` phone review, are still open (M8).
- **Single worker:** one worker solves one job at a time; a full hosted queue can wait about 14 minutes at default budgets (`release-verification.md`).
- **Remaining roadmap:** M6 routing adapters (fleets, depots, reloads, pickup-delivery), verified road geometry and playback, and the remaining M7 lessons.
