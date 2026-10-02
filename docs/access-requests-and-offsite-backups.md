# Access requests and on-server backups (M4)

Implementation spec for request-only access and the retained on-server backup policy before hosted mode is switched on at `fillrate.blasingame.dev`. Read `AGENTS.md`, `docs/hosted-operations.md` and `apps/web/src/lib/server/access.ts` first. Follow the session workflow in `AGENTS.md`: work on `main`, use `M4: …` commits and update the records at the end.

## Current state (2026-10-02)

- Release `696d2c9` (`sha256:7def261e143c118409c827ed78d2daef2befc093eb770168d025bcd37b81c510`) is deployed in **hosted mode** with migration 0009, request-only signup and the numeric admin ID. The daily on-host backup timer and 30-day rotation remain active.
- The owner has created the GitHub OAuth app. Better Auth and GitHub credentials are in the mode-600 VPS Compose file. A pre-migration backup passed checksum/integrity, and the new image migrated a disposable restored copy with a healthy worker. The live site reports hosted/request mode; real GitHub sign-ins and the two-account check remain.
- The owner is the only admin: GitHub `timblazing`, numeric user ID **119372400**.

## Part A: request-access sign-up with a single admin

### Behaviour

1. Anyone can sign in with GitHub. A new account starts as `pending`.
2. Accounts that are `pending`, `denied` or `revoked` are treated as **anonymous** for everything except their own access request. They can view lessons, `/privacy` and the bundled examples, but cannot import, save, run, sweep, geocode, upload or export. They also have no quota usage.
3. A pending user sees a `/request-access` page that shows:
   - their GitHub identity and the request status;
   - an optional "What will you use Fillrate for?" note (at most 500 characters, plain text);
   - Submit and Update buttons, and a Sign out button.
   A denied user sees that the request was declined. A revoked user sees that access was removed and their data is kept.
4. The admin approves, denies or revokes requests on `/admin`. Approval takes effect on the next request, with no re-login needed.
5. `SIGNUP_MODE=request` is the default. `SIGNUP_MODE=open` approves every new account automatically (the current behaviour), and any other value refuses startup with exit 78.

### Admin identity

- `ADMIN_GITHUB_ID=119372400` goes in the server environment. It is required in hosted mode: if it is missing or not a positive integer, startup refuses with exit 78 and names the setting (add this to `deploymentMode` in `packages/db/src/hosted.ts` and its tests).
- The admin is the user whose `account` row has `provider_id='github'` and `account_id=ADMIN_GITHUB_ID`. Use GitHub's numeric ID, never the login or email, because those can change or be re-registered.
- There is **no admin role in the database**. Nothing an HTTP request can change makes someone admin. Don't use Better Auth's `admin` plugin, since it stores roles in the database.
- The admin account is always `approved`. Its status cannot be changed, including by the admin.

### Data model (migration 0009)

Add to `packages/db/src/schema.ts`, then generate with `bun run db:generate` and check the SQL by hand:

```
access_requests
  userId       text primary key → user.id ON DELETE CASCADE
  status       text not null  CHECK in ('pending','approved','denied','revoked')
  note         text           (≤ 500 chars, user-supplied; render as text, never HTML)
  requestedAt  integer not null
  decidedAt    integer
  decidedBy    text           (admin user id)
  updatedAt    integer not null
  index on (status, requestedAt)
```

- Create the row the first time a signed-in hosted user is resolved, or in a Better Auth `databaseHooks.user.create.after` hook (preferred, because it runs once). In `open` mode create it as `approved`; in `request` mode, as `pending`. The admin gets `approved`.
- **Backfill:** existing `user` rows (none in production today) become `approved`. That way an upgrade never locks out someone who already had access.
- Deleting an account (`DELETE /api/v1/me`) cascades the row. Extend the deletion checks in `isolation.test.ts`/`test-hosted.mjs` to confirm nothing remains.

### Authorization

- `principal()` in `apps/web/src/lib/server/access.ts`:
  - Signed-in users whose status isn't `approved` resolve to `kind: "pending"` with `ownerId: null`, `runKey: false` and `user` set, plus `access: "pending" | "denied" | "revoked"`.
  - Approved users resolve as now, with `admin: boolean` added.
  - Read the status in the same synchronous SQLite read as the session lookup, with no caching across requests, so a revoke applies on the next request.
- `requireOwner`: when `who.kind === "pending"`, throw `403 access_pending` ("Your access request is waiting for approval.") instead of 401, or `access_denied` / `access_revoked` for those states.
- `syntheticAdmission`: pending accounts get the same 401/403 treatment as anonymous callers. They never spend `public:*` budgets with their session unless `PUBLIC_SYNTHETIC_RUNS=1` allows anonymous runs anyway.
- Add `requireAdmin(who)`, which returns 404 (not 403) for non-admins so the admin surface isn't discoverable.
- Every existing route already goes through `principal()`. Don't add per-route status checks.

### API

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/me` | anyone | Add `access` (`approved/pending/denied/revoked`), `admin` and `signup_mode` |
| PUT | `/api/v1/me/access-request` | pending or denied user | Set or update the note (rate-limited: 10 updates/day through `workAdmission`-style buckets). A denied user may re-request once after 7 days, which sets the status back to `pending`. |
| GET | `/api/v1/admin/access-requests?status=` | admin | Lists GitHub login, name, avatar, email, note, status, `requestedAt`, `decidedAt`, and the account's scenario and run counts |
| POST | `/api/v1/admin/access-requests/{userId}` | admin | Body `{ action: "approve" \| "deny" \| "revoke" \| "restore" }`. Valid transitions: pending → approved/denied, approved → revoked, revoked/denied → approved. Anything else returns 409. |

- Hosted writes keep the existing same-origin check. Admin POSTs also require `content-type: application/json`.
- Revoking cancels the user's unfinished jobs, using the existing cancel path with the admin as the actor. Data is kept: it is still deletable by the user, and still covered by `/privacy` retention.
- Log admin actions with user ID and action only (no email or note) to stdout, and add an `admin_events` audit table (`id, adminId, userId, action, createdAt`).

### Pages (coss ui, Base UI `render` prop, `DevHeader` conventions)

- `/request-access`: described above. Signed-in non-approved users are redirected here from `/scenarios`, `/runs` and `/account`. Anonymous visitors on those pages keep the existing "Sign in" prompt, which now says access is by request.
- `/admin`, admin only (`notFound()` for everyone else):
  - Tabs: Pending (default), Approved, Denied/Revoked.
  - Rows show avatar, name, a `@login` link to GitHub, email, note, requested time, and usage counts for approved users.
  - Approve, Deny, Revoke and Restore buttons, with a confirm dialog for Revoke.
  - An optimistic update with a toast, then a refresh.
- In `AccountButton`, the admin sees an "Admin" menu item with a pending-count `Badge`. No other header change.
- `/privacy`: add one sentence saying the owner sees request notes and GitHub profile details to decide access.
- Check `/request-access` and `/admin` at 1440 and 390 px with no page-level overflow. Add both to `/dev/components` only if they introduce new composites.

### Tests

- `packages/db/tests/hosted.test.ts`: `ADMIN_GITHUB_ID` and `SIGNUP_MODE` validation (missing, non-numeric, unknown mode → refusal).
- `packages/db/tests/isolation.test.ts`: status transitions, the backfill of existing users in the 0008 → 0009 migration, and the cascade on account delete.
- `scripts/test-hosted.mjs` (production build). Write `account` rows with `provider_id='github'` so the admin resolves through `ADMIN_GITHUB_ID`, then check:
  - a new user is `pending`, and import, run, export and `/runs` return 403 `access_pending`;
  - lessons still return 200;
  - the pending user can set a note;
  - a non-admin gets 404 on `/admin` and `/api/v1/admin/*`, and so does a pending user who forges the request;
  - the admin approves, and the same session can then import and run;
  - the admin revokes: the next request returns 403 `access_revoked`, the unfinished job is cancelled and the data is still there;
  - restore works;
  - the admin cannot change their own status;
  - a cross-origin admin POST returns 403;
  - `SIGNUP_MODE=open` auto-approves;
  - account deletion removes the request.
- `scripts/live-two-account.mjs`: before its checks, require both accounts to be approved. If not, print "approve both accounts at /admin first" and exit 2.
- `deploy/smoke.sh`: hosted refusal without `ADMIN_GITHUB_ID`.
- Keep `bun run lint`, `typecheck`, `build`, `test`, `test:hosted` and `test:browser` passing.

### Rollout

1. Implement and verify locally, update the records, push, then dispatch `image.yml` and wait for it to pass.
2. On the VPS:
   1. Run `./backup.sh fillrate ./backups`.
   2. Add `ADMIN_GITHUB_ID=119372400` and `SIGNUP_MODE=request` to `compose.yaml` or `.env`. Prefer moving all secrets into `.env` (mode 600) and referencing it with `env_file`.
   3. Pin the new digest and run `docker compose up -d`.
   4. Confirm `/api/v1/me` reports `"mode":"hosted"` and `/api/auth/get-session` returns 200.
3. The owner signs in, which approves them automatically as admin. A second GitHub account requests access, and the owner approves it at `/admin`.
4. Run `scripts/live-two-account.mjs --sign-out-b` with both session cookies and record the result in `release-verification.md`.

## Part B: on-server backups for this release

The owner has chosen to keep backups on the Fillrate server for now. Google Drive, rclone, off-site encryption, and a remote restore drill are outside this release. The existing `deploy/backup.sh` and daily systemd user timer remain the backup mechanism: an online SQLite copy is integrity-checked, written beside a `.sha256` file under `~/containers/fillrate/backups`, and rotated after 30 days. Preserve the timer while deploying hosted mode.

Before migration 0009, take another online backup. Verify its checksum and `PRAGMA integrity_check = ok`, then rehearse a restore into a disposable volume/container using the approach in `deploy/target_check.py`; record the image digest, backup hash, integrity result and health check in `release-verification.md`. Do not restore over the live volume for this drill. The on-server backups protect against database mistakes and do not survive loss of the server or its disk; record that limitation plainly in operations and progress documents. No additional owner credential or cloud account setup is required for backups in this release.

## Records to update when done

- `progress.md`: dated entry with evidence. In Known gaps, retain the on-server-only backup limitation and remove the open-signup caveat once the access gate is live.
- `decisions.md`: env-pinned single admin (no database role); request-only signup by default; retain server-local SQLite backups for this release and record the server-loss limitation.
- `status.json`: M4 notes and `nextUp`, then move M4 to done once the live two-account check passes.
- `hosted-operations.md`: `SIGNUP_MODE`, `ADMIN_GITHUB_ID`, the admin workflow, on-server backups and restore.
- `deploy/.env.example`: `ADMIN_GITHUB_ID=`, `SIGNUP_MODE=request`.
