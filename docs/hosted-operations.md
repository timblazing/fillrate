# Hosted and local operation

How the deployment modes work and how the owner configures, migrates and verifies a hosted release (spec §14, M4). What is implemented and verified is recorded in `progress.md`; the remaining owner evidence is in `release-verification.md`.

## Modes

`FILLRATE_MODE` is read at startup and checked before the server accepts requests.

| Mode | Who reaches imported data | Synthetic examples | Notes |
| --- | --- | --- | --- |
| `local` | Everyone who reaches the port: one account-free dataset (owner `operator`) | No key | No auth routes, users or sessions. Compose binds `127.0.0.1` by default; keep it there. |
| unset (operator) | Development: open. Production: `SCENARIO_KEY` | `RUN_KEY`, or anonymous with `PUBLIC_SYNTHETIC_RUNS=1` | The pre-account deployment, unchanged. |
| `hosted` | Each signed-in GitHub account sees only its own data; `SCENARIO_KEY` reaches only the operator dataset | Signed-in accounts (with quotas), `RUN_KEY`, or anonymous with `PUBLIC_SYNTHETIC_RUNS=1` | `BETTER_AUTH_SECRET` (32+ characters), `BETTER_AUTH_URL` (HTTPS origin), `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are required. |

Refusals: hosted mode with any missing or invalid setting exits with status 78 and names every problem. An unknown mode value, or auth settings without `FILLRATE_MODE`, also refuse to start, so a forgotten mode never serves a hosted site without accounts. Local and unset modes never fall back to each other. Worker authentication (`WORKER_TOKEN`), input validation and solver bounds apply in every mode.

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
- 10 MB request bodies for imports and uploads. The order, visit and solver wall limits still apply.

Refusals are HTTP 429 with `Retry-After`, an error code (`active_limit`, `queue_full`, `quota_exceeded`) and the time the window frees up. The account page shows usage. The Better Auth limiter protects only the auth routes. Tune these values against the target-hardware timings before opening signup.

## Configure a hosted deployment (owner)

1. **GitHub OAuth app:** set the homepage to the canonical origin and the callback to `<BETTER_AUTH_URL>/api/auth/callback/github`.
2. **Server `.env`** (never in Git): set `FILLRATE_MODE=hosted`, `BETTER_AUTH_SECRET=$(openssl rand -base64 32)`, `BETTER_AUTH_URL=https://<host>`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Keep `SCENARIO_KEY` if the operator dataset should stay reachable. Set `TRUSTED_CLIENT_IP_HEADER=x-forwarded-for` only if the app port is reachable solely from Caddy.
3. **Back up before migrating.** Migration 0008 (owners, auth tables) runs automatically at startup. `deploy/backup.sh [container] [dest]` takes an online backup through the image's Python `sqlite3` backup API, which is safe while the app serves and WAL is active. It checks the copy's integrity, writes `fillrate-<UTC>.sqlite` and its `.sha256` to the host, and deletes host backups older than 30 days. The host needs no `sqlite3`. Never copy the live file while WAL is active. Run it daily. The reference VPS has no cron, so it uses a systemd user timer (`~/.config/systemd/user/fillrate-backup.{service,timer}`, daily at 03:17 UTC with `Persistent=true`, after `loginctl enable-linger`). Backups on the same disk do not survive losing the server, so copy them off the host too.
4. **Pull the tested image by digest** and start it. If startup refuses, `docker compose logs` names the settings at fault.
5. **Restore (rollback):** stop the container, then write the backup into the data volume as `fillrate.sqlite` and remove the old `fillrate.sqlite-wal`/`-shm`. With a named volume: `docker run --rm -i --entrypoint sh -v <volume>:/app/data <image> -c 'rm -f /app/data/fillrate.sqlite-*; cat > /app/data/fillrate.sqlite' < backup.sqlite`. Then start the previous image digest. An image older than 0008 cannot open a migrated database, so roll back the data together with the image. `deploy/target_check.py` rehearses this restore on a disposable volume.

## Retention, deletion and backups

- Data stays until its owner deletes it.
- Deleting a scenario (`DELETE /api/v1/scenarios/<id>`, account page) removes every version, every branch made from it, and its runs, sweeps, geocoding jobs and saved requests, then any artifact no longer referenced. It is refused while one of its jobs is unfinished.
- Deleting an account (`DELETE /api/v1/me`) removes all of the above for every scenario, plus the account's synthetic runs and sweeps, travel snapshot links (and snapshots nobody else holds), per-account geocoder cache, quota ledger, sessions, GitHub link and user record.
- `GET /api/v1/me/export` downloads the account's scenarios (latest versions with import sources) and its run and sweep lists. Each run's full result has its own export.
- Backups keep deleted data until they expire. The published policy (`/privacy`) promises at most 30 days, so rotate backups on that schedule and never restore deleted accounts into service.
- Geocoding sends addresses to the U.S. Census Bureau geocoder. The ZIP fallback is local. `/privacy` states both.
- Logs carry run/job IDs, attempts, timings and error codes, never addresses or tokens.

## Verify

- `bun run test`: store-level isolation, scoped caches, admission (including a six-process race and a restart), deletion, and migration of pre-account data (`packages/db/tests/isolation.test.ts`, `hosted.test.ts`).
- `bun run build && bun run test:hosted`: production server checks. Hosted mode refuses incomplete settings, and local mode works with no keys. Two hosted accounts are refused every cross-account read, write, run, export, cancel and delete (51 checks), alongside quota 429s, cross-origin refusal, sign-out, session expiry and account deletion. Sessions are written to the database and signed the way Better Auth signs them. Real GitHub sign-in needs the owner's OAuth app.
- `deploy/smoke.sh` (image workflow) also checks hosted refusal and keyless local startup in the built image.
- **Live, after OAuth is configured:** sign in with two different GitHub accounts, copy each browser's `__Secure-better-auth.session_token` cookie value, then run `FILLRATE_URL=https://<host> COOKIE_A=… COOKIE_B=… node scripts/live-two-account.mjs --sign-out-b`. It imports, solves, exports and deletes a small synthetic scenario as A and checks that B and anonymous callers are refused throughout (38 checks; spends one of A's daily solves). Cookie values are secrets; the script never prints them.
- `deploy/target_check.py <image> <out>` collects benchmark timings and the persistence, worker-loss, cancellation and backup/restore checks on disposable containers (`release-verification.md`).
