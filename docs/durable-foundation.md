# M1 durable foundation (planned PR 2)

The planned first step (optimizer pins and executable capabilities) was merged in GitHub PR #5. GitHub PRs #1 and #2 were gallery work. This document calls the persistence/contracts step **planned PR 2**, matching the previous progress handoff, rather than a GitHub issue number.

## What is implemented

- `packages/db`: Drizzle schema and checked-in migrations for scenarios, immutable scenario versions, runs, one sequential pipeline job per run, attempt history, events, compressed artifacts, and immutable run/artifact references.
- Every Node connection sets WAL, foreign keys, NORMAL synchronous mode and a 5-second busy timeout. Migrations run before Next.js accepts requests via `src/instrumentation.ts`; `openDatabase` also migrates native/test connections. Failed initialization stops startup.
- `createScenario`, `saveVersion`, and `enqueue` persist snapshots. Stale scenario writes fail with `version_conflict`. Run idempotency keys return the original run only for identical input; different input fails. Foreign keys and immutable-input triggers protect saved versions and run inputs.
- `claim` uses a short Drizzle `BEGIN IMMEDIATE` transaction and `UPDATE RETURNING`. It recovers expired attempts, selects the oldest queued job (ID breaks timestamp ties), records a new attempt, and returns a fresh token. Heartbeats and events require the matching worker, token, attempt and unexpired lease. Three total attempts by default; expiry on the last attempt ends `interrupted`. Explicit permanent failure is terminal.
- Queued cancellation is immediate. Active cancellation stays a request until the worker acknowledges it or its lease expires. Heartbeats return that request; success after cancellation is rejected. **This package does not kill a Python process**; the next worker integration must do that before acknowledging cancellation.
- Progress/completion events use consecutive sequences per attempt. An exact replay returns `duplicate`; a conflicting sequence, stale owner, out-of-order event or post-terminal mutation fails. An exact terminal callback replay is allowed even after expiry, but never after a replacement lease.
- Completion validates and compresses all supplied JSON artifacts before opening a transaction, then stores payloads, references, event and terminal status atomically. Limits: 8 MiB uncompressed per artifact, 16 MiB per completion, 100 artifacts, 64 KiB event payload. Readback checks decompressed size and SHA-256. This bounded M1 path needs no upload staging table; larger/chunked transfers are deferred.
- `packages/contracts`: Pydantic-owned v1 snapshot, stage-manifest, lease and worker-event envelopes, generated JSON Schema and OpenAPI TypeScript types. AJV validates the generated schema without coercing inputs or supplying defaults. Python and TypeScript round-trip the same fixture. Mathematical stage payloads remain opaque versioned documents until the actual pipeline implements them.

No internal HTTP worker routes are exposed yet. The next slice must add authenticated, genuinely loopback-only endpoints and the Python supervisor, then use these operations. Do not trust client-supplied forwarding headers as proof of loopback origin. There is no production pipeline result or artifact-cache reuse policy yet; content-addressed persistence alone does not constitute pipeline execution or a valid solver result.

## Native development and verification

Use Node 24 and Bun for installation/scripts. From the repository root:

```sh
bun install
bun run contracts:generate
bun run db:generate            # only when intentionally changing the schema
bun run test                  # Vitest runs on Node, never Bun's test runtime
bun run lint
bun run typecheck
bun run build
bun run dev
```

From `services/optimizer`:

```sh
UV_PYTHON=python3.13 uv run pytest
uv run ruff check .
uv run ruff format --check .
```

Generated contract files are checked in. `bun run contracts:generate` exports from local Pydantic/FastAPI without a running service, then generates TypeScript. Regeneration must leave `packages/contracts/{schema.json,openapi.json,src/generated.ts}` unchanged unless a source contract intentionally changes. Do not hand-edit generated files.

The app's native scripts run with `apps/web` as the working directory and default to the repository's `data/dev.sqlite`. `DATA_DIR` overrides this with `<DATA_DIR>/fillrate.sqlite`. `DB_MIGRATIONS_DIR` overrides the checked-in migration directory. A future packaged container must copy the migrations and set both paths explicitly. Python never opens SQLite. There is no container delivery in this step.

Tests exclusively use disposable real SQLite files. They cover independent-process claims and concurrent heartbeat/completion, recovery after close/reopen, stale attempts, bounded retry, cancellation, immutable snapshots, duplicate/conflicting/out-of-order events, atomic rollback, artifact limits/corruption, and cross-language envelope validation. Production startup was smoke-tested with a fresh temporary `DATA_DIR`, checking HTTP 200, migrated tables and WAL.

## Backup and restore

Use SQLite's backup API, the CLI `.backup` command, or `VACUUM INTO` to create a new timestamped backup. Do not copy an active database file while WAL is in use. Stop the application before restore, restore the backup into a **fresh data directory**, set `DATA_DIR` to it, and restart so migrations run before traffic. Retain the prior directory for rollback; never mix an old WAL/SHM file with a restored database.

## Next slice (done 2026-09-30)

The worker transport, supervisor, synthetic pipeline, `/runs` screens, export, combined image and CI are implemented; see the M1 entry in `docs/decisions.md` and `docs/progress.md`. The "No internal HTTP worker routes" paragraph above describes the state before that slice.
