# Local single-user use

How to run Fillrate on your own machine with no account, no OAuth and no keys (spec §14, `FILLRATE_MODE=local`). The same web app, Python worker, SQLite store and fulfillment engine serve the hosted site; local mode only removes accounts. For the hosted deployment see `hosted-operations.md`; for what was verified and where, see the end of this page and `handoff.md`.

Local mode is one account-free dataset (owner `operator`): everyone who can reach the port can read and change it, so keep it on loopback. Worker authentication, input validation and solver bounds still apply.

## Requirements

- **Node 24** (the runtime; `.github/workflows/ci.yml` pins 24.18.1). Node 22 also worked for the native npm check recorded below, but 24 is the target.
- **Bun 1.4.2** or **npm** (bundled with Node). Bun with `bun.lock` is canonical; npm uses the committed `package-lock.json` (see "Lockfiles").
- **uv** and **Python 3.13** for the optimizer worker. The root scripts run uv with `UV_PYTHON=python3.13`, so a `python3.13` must be resolvable by uv (`uv python install 3.13` provides one).
- Linux x86_64 is verified natively (CI and the dev container). arm64 Linux is verified through the Docker image only. macOS is expected to work (better-sqlite3, PyVRP and OR-Tools publish wheels/prebuilds for it) but is not verified. Native Windows is not supported: the root scripts use POSIX shell syntax. Use Docker instead.
- Docker with Compose v2 for the container route.

## Native install

From a clone of the repository:

```sh
# Bun (canonical)
bun install --frozen-lockfile
# or npm
npm ci

cd services/optimizer && UV_PYTHON=python3.13 uv sync --locked && cd ../..
```

Every root script below works as `bun run <script>` or `npm run <script>` (`npm test` for `test`). The root scripts that run a workspace script call `scripts/workspace.mjs`, which re-invokes whichever package manager started them.

## Run

Set the mode in every shell that starts the web server:

```sh
export FILLRATE_MODE=local
```

Development (hot reload), two terminals:

```sh
npm run dev       # or: bun run dev   → http://localhost:3000
npm run worker    # or: bun run worker
```

Production build, two terminals:

```sh
npm run build     # or: bun run build
npm start         # or: bun run start → next start on http://localhost:3000
npm run worker
```

`next start` prints `"next start" does not work with "output: standalone"`. The warning is expected: the standalone output exists for the Docker image, and `next start` from `apps/web` still serves the app, its static assets and the worker transport. Pass Next.js flags after `--`, for example `npm start -- --port 3010 --hostname 127.0.0.1`.

Open `/runs` or `/learn` and start a bundled example, or import your own data under `/scenarios`. Without `FILLRATE_MODE=local`, development is still open, but a production start falls back to the operator deployment and refuses runs without `RUN_KEY`.

### Ports

| Port | Bound to | Purpose | Override |
| --- | --- | --- | --- |
| 3000 | `next dev`/`next start` default (all interfaces unless `--hostname 127.0.0.1`) | Web app and API | `--port`, `--hostname` |
| 3100 | 127.0.0.1 only | Private worker transport served by the web process | `INTERNAL_PORT` on the web process and `FILLRATE_INTERNAL_URL=http://127.0.0.1:<port>` on the worker |

`next dev` and `next start` listen on every interface by default; add `-- --hostname 127.0.0.1` to keep a native server on loopback. The worker transport is always loopback and token-authenticated.

### Data location

- Native: `data/dev.sqlite` at the repository root (plus `-wal`/`-shm` files) and `data/worker.token`, which the web process writes and the worker reads. Set `DATA_DIR=/some/dir` on **both** processes to use `/some/dir/fillrate.sqlite` instead. `data/` is git-ignored.
- Docker Compose: `deploy/data/fillrate.sqlite` on the host (`/app/data` in the container).

Migrations apply automatically when the web server starts.

### Exports

Every run has JSON and CSV exports (`/runs/<id>`, or `GET /api/v1/runs/<id>/export?format=json|csv`) and a Python replay bundle. Scenarios export from `/scenarios`. These are the portable format; the SQLite file is the complete store.

### Backups

Never copy a live SQLite file while WAL is active. Native: take an online backup with SQLite's backup API through the optimizer's Python (safe while the app is serving):

```sh
mkdir -p backups
services/optimizer/.venv/bin/python - <<'PY'
import sqlite3, time
src = sqlite3.connect("file:data/dev.sqlite?mode=ro", uri=True, timeout=30)
dst = sqlite3.connect(time.strftime("backups/fillrate-%Y%m%dT%H%M%SZ.sqlite", time.gmtime()))
src.backup(dst)
print(dst.execute("PRAGMA integrity_check").fetchone()[0])
PY
```

Restore: stop the web server and worker, copy the backup over `data/dev.sqlite`, delete `data/dev.sqlite-wal` and `data/dev.sqlite-shm`, then start again. Docker: `deploy/backup.sh <container> [dest]` does the same through the image and writes a SHA-256 next to the copy; the restore steps are in `hosted-operations.md` (step 5).

### Upgrading

Back up first. Then:

```sh
git pull --ff-only
bun install --frozen-lockfile        # or: npm ci
(cd services/optimizer && UV_PYTHON=python3.13 uv sync --locked)
bun run build                        # or: npm run build (production only)
```

Restart the web server, then the worker. New migrations run at startup; an older release cannot open a database migrated by a newer one, so keep the backup until the new version works.

## Docker Compose (local mode)

`deploy/compose.yaml` runs the published multi-architecture image `ghcr.io/timblazing/fillrate` (web, optimizer and worker in one container) and publishes port 3000 on `127.0.0.1` by default.

```sh
cd deploy
cp .env.example .env
echo FILLRATE_MODE=local >> .env
mkdir -p data && sudo chown 1000:1000 data   # the image runs as uid 1000
docker compose up -d
docker compose logs -f                       # wait for the web server and worker
```

Open http://127.0.0.1:3000. Upgrade with `docker compose pull && docker compose up -d` after a backup; pin an image digest instead of `latest` for repeatable installs. Leave `BIND_ADDR` unset (loopback). Setting it to a public address exposes an account-free dataset.

## Geocoding and the ZIP fallback

Address geocoding sends addresses to the U.S. Census Bureau batch geocoder. `FILLRATE_GEOCODER=off` disables it entirely. `CENSUS_GEOCODER_URL` and `GEOCODE_BATCH_SIZE` override the endpoint and batch size. The local ZIP/ZCTA fallback needs a lookup file: the image builds its own; natively, `npm run zcta:build` (or `bun run zcta:build`) downloads the pinned Census Gazetteer file and writes `data/zcta-gazetteer-2024.tsv` (override with `ZCTA_LOOKUP_PATH`). Without it, ZIP-only rows stay unresolved.

## Troubleshooting

- **uv picks the wrong Python** (for example a stray Python 2.7 on `PATH`): the root scripts already set `UV_PYTHON=python3.13`; set it yourself when running `uv` directly from `services/optimizer`.
- **The worker never connects** (`/api/health` shows `"connected": false`): start the web server first; the worker waits up to 60 s for `data/worker.token`. Both processes need the same `DATA_DIR` (or the same `WORKER_TOKEN`), and the worker needs `FILLRATE_INTERNAL_URL` if `INTERNAL_PORT` changed.
- **Port already in use**: change `--port` and `INTERNAL_PORT`/`FILLRATE_INTERNAL_URL` as above.
- **Startup refuses with exit status 78**: auth settings (`BETTER_AUTH_*`, `GITHUB_*`) are set without `FILLRATE_MODE`, or the mode value is neither `local` nor `hosted`. The message names the setting. Set `FILLRATE_MODE=local` (auth settings are then unused) or remove them.
- **npm warns `EBADENGINE` for agent-browser** on Node 22: agent-browser (browser tests only) declares Node 24. Use Node 24.
- **`better-sqlite3` fails to load** after switching Node versions: reinstall (`npm ci` or `bun install`) so the native module matches the runtime.

## Lockfiles

`bun.lock` is canonical: CI's main job, the Docker image and all release evidence install from it with `bun install --frozen-lockfile`. `package-lock.json` is committed so npm installs are reproducible (`npm ci`). `node scripts/npm-lock.mjs` checks that every direct dependency of every workspace resolves to the same version in both files; CI runs it. Transitive dependencies are resolved separately by each tool within the declared ranges and can differ. After changing dependencies, run `bun install`, then `node scripts/npm-lock.mjs --sync` and commit both lockfiles. Workspace packages depend on each other by version (`0.1.0`) rather than `workspace:*`, which npm does not accept.

## What was verified

- **npm, native (2026-10-05, cloud dev container: Ubuntu 24.04 x86_64, Node 22.22.0, npm 10.9.4, uv 0.8.17, Python 3.13.7)** on a fresh clone with `FILLRATE_MODE=local`: `npm ci`, `npm run lint`, `npm run typecheck`, `npm run contracts:generate` (no diff), `npm run db:generate` (no schema changes), `npm test`, `npm run build`, `npm start` with `npm run worker` (keyless `/api/v1/me` reports local mode, auth routes 404, the bundled `m1` and 2,000-order `lesson` examples ran through the worker to validated results, CSV export downloaded) and `npm run dev` with `npm run worker` (an `m1` run succeeded). Node 24 + npm is checked by the `npm` job in `ci.yml`. Evidence and timings: `progress.md` (2026-10-05 entry) and `handoff.md`.
- **Bun, native**: the same scripts in CI (`ci.yml` `checks` job) and in every recorded session.
- **Docker/Compose local mode**: `deploy/smoke.sh` in `image.yml` starts the built image on amd64 and arm64 with `FILLRATE_MODE=local` and no keys, and checks keyless scenario access and a run. Compose itself and native ZCTA download were not exercised in the dev container (images are built only in GitHub Actions; the sandbox blocks the Census download).
