# Production browser smoke

All browser automation uses the local headless `agent-browser` CLI, pinned to 0.37.1 in the workspace. `bun run test:browser` starts a production standalone web server and real Python worker against an isolated temporary database. Browser sessions have unique names; test-only run and operator keys are generated for each invocation. Ambient hosted credentials, data paths and worker URLs are excluded. No production data or live OAuth is used.

## Local prerequisites

1. Install workspace dependencies with `bun install --frozen-lockfile`.
2. Sync the optimizer with `cd services/optimizer && UV_PYTHON=python3.13 uv sync --locked`.
3. Build the production web app with `bun run build`.
4. Install the browser runtime with `bunx --no-install agent-browser install`.
5. Run `bun run test:browser` from the repository root.

CI installs the same pinned CLI and its browser runtime with `bunx --no-install agent-browser install --with-deps`, then runs the same acceptance command. GitHub-hosted Ubuntu CI sets `AGENT_BROWSER_ARGS=--no-sandbox` because its unprivileged user namespaces are unavailable to Chromium; the flag is limited to that ephemeral synthetic-data CI job. The launcher binds the web server and worker transport to separate loopback ports and removes temporary data/downloads and closes its browser session when it ends. Images are built only in GitHub Actions.

## Independent flows

| Command | Acceptance scope |
| --- | --- |
| `bun run test:browser` | All four flows in sequence. |
| `bun run test:browser --flow=lesson` | Public fulfillment lesson → persisted valid, complete result with positive revenue/shipments → downloaded and parsed JSON export. |
| `bun run test:browser --flow=import` | Protected synthetic CSV preview → save → preflight → real worker result → browser reload and JSON export matching the saved scenario. Keyless listing, run and export reads are refused. |
| `bun run test:browser --flow=matrix` | Protected tiny import → asymmetric imported directed matrix preview/save/select (provider, units, coverage shown) → real worker run whose persisted legs equal the directed matrix values and name the imported provider and snapshot hash → coordinate edit saved as a new version shows the stale warning and the run is refused (`travel_snapshot_stale`, no run enqueued). |
| `bun run test:browser --flow=experiment` | Small allocation-example sweep → preview of two combinations → both completed valid plans → ranked Best option with meaningful comparison metrics. |

Browser actions go through agent-browser; direct HTTP reads are used only for persisted-outcome polling and access assertions. Layout checks cover desktop 1440×900 and the iPhone 16 profile at 393×852, including the scenario workbench, experiment builder and their result screens. A scrollable table is allowed; page-level horizontal overflow fails acceptance.

## Verification boundaries

These local flows do not replace `bun run test:hosted` for two-account isolation, pending/admin access and quota regression checks. They do not test live GitHub OAuth, deployed-site cross-account behavior, native npm support or target hardware. Browser cancellation, scenario editing/branching and the optional request-access/admin responsive checks remain separate follow-up coverage. Target hardware/release evidence is in `release-verification.md`; current results and remaining work are in `progress.md`.
