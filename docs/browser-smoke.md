# Production browser smoke

The Chromium smoke drives the bundled fulfillment lesson through a real Python worker, waits for a persisted valid and complete run, checks the revenue/shipment output, downloads the existing JSON export, and checks the result page at 1440 px and 390 px.

## Local prerequisites

1. Install workspace dependencies with `bun install`.
2. Install and sync the optimizer with `cd services/optimizer && UV_PYTHON=python3.13 uv sync --locked`.
3. Build the production web app with `bun run build`.
4. Install Chromium once with `bunx playwright install chromium`.
5. From the repository root, run `bun run test:browser`.

The launcher starts `next start` on a loopback-only ephemeral port, starts the real worker against a separate loopback transport port, and creates a temporary database directory and run key. It removes the temporary database when the run ends. It does not use Docker or production data. CI installs Chromium with `bunx playwright install --with-deps chromium` before running the same command.

## Remaining coverage

The existing smoke covers the public lesson, core result page and JSON export. Add two separate flows using this production launcher: a minimal protected CSV import through preview/commit to a validated result, and a bounded deterministic experiment through combination preview to a ranked comparison. Both need meaningful persisted-outcome assertions and desktop/390 px overflow checks. Preserve operator protections for imports. Detailed acceptance and dependencies are in `progress.md`; target hardware and release evidence are in `release-verification.md`.
