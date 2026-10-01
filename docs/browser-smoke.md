# Production browser smoke

The Chromium smoke drives the bundled fulfillment lesson through a real Python worker, waits for a persisted valid and complete run, checks the revenue/shipment output, downloads the existing JSON export, and checks the result page at 1440 px and 390 px.

## Local prerequisites

1. Install workspace dependencies with `bun install`.
2. Install and sync the optimizer with `cd services/optimizer && UV_PYTHON=python3.13 uv sync --locked`.
3. Build the production web app with `bun run build`.
4. Install Chromium once with `bunx playwright install chromium`.
5. From the repository root, run `bun run test:browser`.

The launcher starts `next start` on a loopback-only ephemeral port, starts the real worker against a separate loopback transport port, and creates a temporary database directory and run key. It removes the temporary database when the run ends. It does not use Docker or production data. CI installs Chromium with `bunx playwright install --with-deps chromium` before running the same command.
