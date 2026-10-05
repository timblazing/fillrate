# Hosted and local operation

How the deployment modes work and how the owner configures, migrates and verifies a hosted release (spec §14, M4). What is implemented, accepted and verified is recorded in `progress.md` and `release-verification.md`; the latter also records known limits.

## Modes

`FILLRATE_MODE` is read at startup and checked before the server accepts requests.

| Mode | Who reaches imported data | Synthetic examples | Notes |
| --- | --- | --- | --- |
| `local` | Everyone who reaches the port: one account-free dataset (owner `operator`) | No key | No auth routes, users or sessions. Compose binds `127.0.0.1` by default; keep it there. |
| unset (operator) | Development: open. Production: `SCENARIO_KEY` | `RUN_KEY`, or anonymous with `PUBLIC_SYNTHETIC_RUNS=1` | The pre-account deployment, unchanged. |
| `hosted` | Approved GitHub accounts see only their own data; `SCENARIO_KEY` reaches only the operator dataset | Approved accounts (with quotas), `RUN_KEY`, or anonymous with `PUBLIC_SYNTHETIC_RUNS=1` | `BETTER_AUTH_SECRET` (32+ characters), `BETTER_AUTH_URL` (HTTPS origin), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and numeric `ADMIN_GITHUB_ID` are required. |

Refusals: hosted mode with any missing or invalid setting exits with status 78 and names every problem. An unknown mode value, or auth settings without `FILLRATE_MODE`, also refuse to start, so a forgotten mode never serves a hosted site without accounts. Local and unset modes never fall back to each other. Worker authentication (`WORKER_TOKEN`), input validation and solver bounds apply in every mode.

`SIGNUP_MODE=request` is the default: GitHub sign-in creates a pending request, and the account can view public lessons and examples while waiting. `/request-access` accepts a plain-text note of at most 500 characters, up to ten updates per rolling day. A denied account can request again after seven days. The admin at `/admin` approves, denies, revokes and restores access; decisions apply to the next request. Revocation cancels unfinished work and keeps stored data. The sole admin is the account linked to `ADMIN_GITHUB_ID` as a numeric GitHub account ID. No database role grants admin access. `SIGNUP_MODE=open` auto-approves new accounts and is intended only for an explicitly open signup policy. Existing accounts are approved by migration 0009.

## Ownership

Owner IDs are `operator`, `user:<Better Auth user id>`, `examples` (the bundled synthetic scenarios, readable by everyone) and, for anonymous synthetic submissions, `public`.

- Scenarios, versions and branches, runs and their artifacts and exports, replay bundles, sweeps, k explorer jobs, geocoding jobs and preflight: every route resolves the caller on the server (`apps/web/src/lib/server/access.ts`) and checks the owner. Another owner's IDs answer 404, the same as missing ones.
- The store enforces job admission. A run or sweep can only be queued on a bundled example or on the submitter's own scenario (`Store.enqueue`/`createExperiment`), whichever route calls it.
- Stage reuse is keyed by the scenario's owner, and geocoder answers are cached per owner. One account's work never shows up as another's cache hit.
- A travel snapshot is stored once by content hash. Each owner that uploaded it holds a link, and reading or selecting it needs a link. A hash is not an access token.
- Idempotency keys replayed by another owner are conflicts and never return the first owner's result.
- Hosted writes from another origin are refused. Session cookies are `SameSite=Lax` and `Secure` behind HTTPS.
- The first signup claims nothing. Existing data stays with `operator`; migration 0008 assigns it there (and the bundled examples to `examples`).

## Limits (hosted accounts)

Each admission is checked and charged in the same SQLite write transaction that queues the work, so concurrent requests, worker retries and restarts cannot overshoot. Idempotent replays are not charged, and cancelling does not refund. Starting values (environment overrides in `deploy/.env.example`):

- One unfinished job per account. A sweep counts once, and so does a geocoding job.
- 20 solve admissions per account per day, one per run. A sweep is charged one admission per child run, and a k explorer job counts as one.
- 60 solve admissions per client address per day, but only when `TRUSTED_CLIENT_IP_HEADER` names a header that the proxy overwrites. Without it, no address is trusted.
- 10 jobs in the global queue and sweeps of at most 10 runs (outside hosted mode: 50 and 25).
- 10 geocoding jobs, 200 address lookups, 100 scenario saves and 20 travel snapshot uploads per account per day.
- 200 manual plan evaluations per account per day (`QUOTA_EVALUATIONS_PER_DAY`). An evaluation is a bounded synchronous call from the web server to the optimizer's loopback `/evaluate`, not a queued job, so it never waits behind solves; it is charged before the call and nothing is stored. Any caller who can read a run may load its manual plan context; evaluating needs an account, the operator/run key, or, on bundled-example runs only with `PUBLIC_SYNTHETIC_RUNS=1`, a global budget of 300 per hour (`PUBLIC_EVALUATIONS_PER_HOUR`).
- 10 MB request bodies for imports and uploads. The order, visit and solver wall limits still apply.

Refusals are HTTP 429 with `Retry-After`, an error code (`active_limit`, `queue_full`, `quota_exceeded`) and the time the window frees up. The account page shows usage. The Better Auth limiter protects only the auth routes. These starting values were checked against target-hardware timings; review them against live queue behavior as approved usage grows.

## Configure a hosted deployment (owner)

The reference VPS runs hosted/request mode on image digest `sha256:7def261e143c118409c827ed78d2daef2befc093eb770168d025bcd37b81c510`, with migration 0009 and the numeric admin setting. Public health, Better Auth's session endpoint and anonymous admin refusal passed. The owner signed in successfully and the configured GitHub ID is linked to an approved account. The owner waived a second live GitHub account check; local automated tests cover two-user isolation (`release-verification.md`). The existing Compose file contains the OAuth settings and is mode 600; moving them into a separate `.env` is optional operational cleanup.

1. **GitHub OAuth app:** set the homepage to the canonical origin and the callback to `<BETTER_AUTH_URL>/api/auth/callback/github`.
2. **Server `.env`** (never in Git): set `FILLRATE_MODE=hosted`, `BETTER_AUTH_SECRET=$(openssl rand -base64 32)`, `BETTER_AUTH_URL=https://<host>`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ADMIN_GITHUB_ID=119372400` and `SIGNUP_MODE=request`. Keep `SCENARIO_KEY` if the operator dataset should stay reachable. Set `TRUSTED_CLIENT_IP_HEADER=x-forwarded-for` only if the app port is reachable solely from Caddy.
3. **Back up before migrating.** Migration 0009 (access requests) runs automatically at startup. `deploy/backup.sh [container] [dest]` takes an online backup through the image's Python `sqlite3` backup API, which is safe while the app serves and WAL is active. It checks the copy's integrity, writes `fillrate-<UTC>.sqlite` and its `.sha256` to the host, and deletes host backups older than 30 days. The host needs no `sqlite3`. Never copy the live file while WAL is active. Run it daily. The reference VPS uses a systemd user timer (`~/.config/systemd/user/fillrate-backup.{service,timer}`, daily at 03:17 UTC with `Persistent=true`). Keep the existing daily user timer and 30-day host rotation. The backups directory is mode 700 and each backup/checksum is mode 600. Take a new backup before migration 0009.
4. **Pull the tested image by digest** and start it. If startup refuses, `docker compose logs` names the settings at fault.
5. **Restore (rollback):** stop the container, then write the backup into the data volume as `fillrate.sqlite` and remove the old `fillrate.sqlite-wal`/`-shm`. With a named volume: `docker run --rm -i --entrypoint sh -v <volume>:/app/data <image> -c 'rm -f /app/data/fillrate.sqlite-*; cat > /app/data/fillrate.sqlite' < backup.sqlite`. Then start the previous image digest. An image older than 0008 cannot open a migrated database, so roll back the data together with the image. `deploy/target_check.py` rehearses this restore on a disposable volume.

## Retention, deletion and backups

- Data stays until its owner deletes it.
- Deleting a scenario (`DELETE /api/v1/scenarios/<id>`, account page) removes every version, every branch made from it, and its runs, sweeps, geocoding jobs and saved requests, then any artifact no longer referenced. It is refused while one of its jobs is unfinished.
- Deleting an account (`DELETE /api/v1/me`) removes all of the above for every scenario, plus the account's synthetic runs and sweeps, travel snapshot links (and snapshots nobody else holds), per-account geocoder cache, quota ledger, sessions, GitHub link and user record.
- `GET /api/v1/me/export` downloads the account's scenarios (latest versions with import sources) and its run and sweep lists. Each run's full result has its own export.
- Backups keep deleted data until they expire. The published policy (`/privacy`) promises at most 30 days, so rotate backups on that schedule and never restore deleted accounts into service.
- Backups currently stay on the same server. They help recover from database or deployment errors but do not survive loss of the server or its disk. The owner deferred off-server storage for this release. Restore drills use a disposable volume/container and the tested image; verify the saved `.sha256`, SQLite `PRAGMA integrity_check`, and application health before recording evidence.
- Geocoding sends addresses to the U.S. Census Bureau geocoder. The ZIP fallback is local. `/privacy` states both.
- Logs carry run/job IDs, attempts, timings and error codes, never addresses or tokens.

## Verify

- `bun run test`: store-level isolation, scoped caches, admission (including a six-process race and a restart), deletion, and migration of pre-account data (`packages/db/tests/isolation.test.ts`, `hosted.test.ts`).
- `bun run build && bun run test:hosted`: production server checks. Hosted mode refuses incomplete settings, and local mode works with no keys. Open-mode two-account isolation plus request-mode pending/approval/revoke/restore checks run against a production build with database-written sessions. The owner’s live GitHub sign-in is confirmed. A second live account check was waived; cross-user behavior remains covered by automated production-build tests.
- `deploy/smoke.sh` (image workflow) also checks hosted refusal and keyless local startup in the built image.
- **Live owner check (complete):** the configured admin GitHub account signs in and is approved automatically. The owner accepted the release without a second live account. `scripts/live-two-account.mjs` remains available as an optional diagnostic; do not request its cookies as a release step.
- `deploy/target_check.py <image> <out>` collects benchmark timings and the persistence, worker-loss, cancellation and backup/restore checks on disposable containers (`release-verification.md`).
