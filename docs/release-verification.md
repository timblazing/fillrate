# Release verification and hardware evidence

## 2026-10-07 source integration (image release remains open)

PRs [#81](https://github.com/timblazing/fillrate/pull/81), [#82](https://github.com/timblazing/fillrate/pull/82) and [#83](https://github.com/timblazing/fillrate/pull/83) are integrated through `main` commit `0fc6db7deb24a6d5b628881ecc967c401c4f2e02`. Its Git tree matches PR head `905230f916126208dfa78a9c904c5cf2af5d9589` exactly. [CI run 37651252038](https://github.com/timblazing/fillrate/actions/runs/37651252038) passed `checks` and `npm`, including the production build, hosted/local checks and standard browser acceptance. Live-provider road geometry was not configured in CI and was skipped; hosted Valhalla evidence and the remaining signed-in UI check are recorded in [valhalla.md](valhalla.md).

This source has no image publication or deployment claim from this integration session. The final accessibility/performance/copy gates and subsequent image/deploy-by-digest work remain in [completion-plan.md](completion-plan.md) and [progress.md](progress.md). Earlier digests and hardware evidence below keep their original scope.

## 2026-10-06 image release for `e95f3cb`

GitHub Actions [image workflow run 37482591185](https://github.com/timblazing/fillrate/actions/runs/37482591185) completed successfully for `main` commit `e95f3cb6556a52b013d318caf2f4800329970051`. The CI and npm checks passed; native `build (amd64, ubuntu-24.04)` and `build (arm64, ubuntu-24.04-arm)` both passed their smoke and benchmark steps, and the publish job created the multi-architecture manifest.

Published tag: `ghcr.io/timblazing/fillrate:sha-e95f3cb`. Registry manifest digest: `sha256:0b6eeac32bba5853c3d9190cc1b0bfc62c2e5edecfd29f9b213c11b84052322e`. `docker manifest inspect` confirmed `linux/amd64` (`sha256:065838a48d6957bab52729a1a3c6b03f9eb4866a880556bc4b4da46b5b5362a0`) and `linux/arm64` (`sha256:67b13cf4d5b9a3cae1091c8866b35a67221fdf11c3b97bdeec967d454285d93e`).

This reference records M4 release evidence and the remaining M8 release/handoff work. The canonical scope is in `fillrate-technical-spec.md` §§14–16 and the remaining work/dependencies are in `progress.md`. CI and runner benchmarks establish an implementation baseline; they do not replace evidence from the Ubuntu VPS or the actual hosted release.

## Current evidence and missing handoff

The local headless agent-browser acceptance runner covers the public fulfillment lesson/result/JSON export, protected CSV import/save/preflight/result/reload/scenario-matching export, and a two-run ranked allocation experiment. Each uses a fresh named browser session with isolated synthetic data and checks desktop 1440×900 and iPhone 16 393×852 bounds. The parent independently verified the combined `bun run test:browser` against a fresh production build on 2026-10-02; `bun run test:hosted` also passed 82 checks. See `browser-smoke.md` for prerequisites and independent flow commands. No live OAuth or deployed-site two-account claim follows from these local tests.

Native Bun/npm distribution and the reproducible handoff (`local.md`, `handoff.md`) were added on 2026-10-05. Cancellation/edit/branch and request-access/admin phone checks have subsequent evidence in `progress.md`. Remaining M8 work is post-fix accessibility acceptance, final dashboard/performance and copy reconciliation, a final tested image and deployment, and native target timings. Hosted OK7 Valhalla service evidence is recorded in `valhalla.md`; its signed-in live UI check remains open.

The target-hardware harness is `deploy/target_check.py` (2026-10-01). It replaces the unrecoverable `3772136` claim. It runs against one tested image and only touches disposable containers and volumes. Its results for release `fa9c0b8` are below; raw outputs are kept on each host, outside Git. The owner accepted the hosted release after a real admin sign-in and waived a second live GitHub account check; the resulting evidence and limits are recorded below.

### Local arm64 image and Valhalla Compose check (2026-10-06, not release evidence)

A one-off local build, not a published image: `DOCKER_BUILDKIT=0 docker build -t fillrate:local-arm64 .` from branch `claude/valhalla-local` (commit `bbc55b7`) in Colima on Apple silicon (linux/arm64, 4 vCPU / 12 GiB VM), 6 min 20 s, 1.38 GB. `deploy/smoke.sh fillrate:local-arm64` passed (synthetic pipeline, `smoke_import.py`, `smoke_geocode.py` with live Census, `smoke_experiments.py`, `smoke_travel.py`, keyless local mode). `deploy/compose.yaml --profile valhalla` with that image (local mode) and the pinned Valhalla on TN/MS/AR tiles: `/api/health` reported `road.valhalla` with the recorded version/dataset/graph hash, the Valhalla service published no host port and answered the app on `http://valhalla:8002`, and `deploy/smoke_valhalla.py` passed (same snapshot content hash as the native run). The local image was removed afterwards and never pushed; the published image always comes from `image.yml`.

### Results: image `sha256:740aee91…6d08c` (commit `fa9c0b8`, image 36956880394)

Probe: 2,000 synthetic orders, 640 locations, k=8, run inside the image. Every run was valid, with no failed attempts.

| Target | Hardware | Comparable, 5 runs: total s (median / min / max) | Default budget, 3 runs: total s (median / min / max) | Trucks (comparable / default) |
| --- | --- | --- | --- | --- |
| VPS `hostinger` | x86_64, 2 vCPU AMD EPYC 7543P, 7.9 GB, Debian 13, Docker 29.5.2 | 5.97 / 5.84 / 7.78 | 81.43 / 81.34 / 81.50 | 205 / 203 |

The default-budget time is dominated by the 10 s per cluster solver budget (8 clusters, solved one after another), so the run takes about 81 s. The VPS run shared its two vCPUs with the live site.

Recovery checks ran on a container with `--restart unless-stopped`, `LEASE_MS=15000` and 3 s heartbeats. They passed.

| Check | VPS |
| --- | --- |
| Persistence: imported scenario + validated run and synthetic run, container restart, identical summary/JSON/CSV hashes and scenario | ok, worker back in 2.7 s |
| Worker loss: SIGKILL the supervisor mid-solve; the container restarts, attempt 1 ends `lease_expired`, attempt 2 reuses 8 checkpointed stages and succeeds valid with one solve/validation/summary | ok, 60.6 s kill → result |
| Cancellation: a running and a queued run, then a new run on the same worker | ok, running cancelled in 2.1 s, follow-up succeeded |
| Backup/restore: `deploy/backup.sh` online backup (integrity ok), restore into a new volume, second container; scenario and three runs' summary/export hashes identical | ok (`142f077f…`) |

The `summary.json` SHA-256 is `cc5be892…62f1` on the VPS, under `~/fillrate-evidence/<host>-fa9c0b8/`. A trial run of the harness against the previous image (`36c023a5…`) showed that a cancel arriving while the solver child was calling the server ended the run **failed**. `fa9c0b8` fixes this and adds an e2e regression test. Late artifact writes after a cancel or a lost lease are refused by lease fencing; the store and transport tests cover this, and the harness does not repeat it.

**Production deployment (2026-10-01):** `fillrate.blasingame.dev` runs the same digest, pinned in `~/containers/fillrate/compose.yaml`, in operator mode (`FILLRATE_MODE` unset). Migration 0008 was backed up first (`fillrate-20261002T030411Z.sqlite`, SHA-256 `364a6d92…1061`; the database had no scenarios or runs) and then applied: 9 migrations. Health reports the worker connected. A live lesson run (`ea942afd…`) succeeded valid and complete, and its CSV export downloads. Hosted accounts are not switched on; the GitHub OAuth app is still needed. A systemd user timer takes daily backups (03:17 UTC) with 30-day rotation; the host has no cron.

**2026-10-02 access/backup increment:** Migration 0009, request-only signup, single numeric GitHub-ID admin, note/rate limits, admin decisions and revocation passed local verification. `bun run test:hosted` passed 82 checks against the production build, including pending denial, approval without re-login, revocation cancellation/data retention, restore and admin refusal. `bun run test` passed 116 tests and `bun run test:browser` passed the public lesson smoke. The owner deferred off-server backups for this release, retaining the existing daily on-server online backup and 30-day rotation. On-server copies do not survive server or disk loss.

**2026-10-02 hosted deployment:** `image.yml` run [37036731041](https://github.com/timblazing/fillrate/actions/runs/37036731041) passed CI, smoke and 2,000-order benchmark on amd64 and arm64, then published `sha-696d2c9`. The VPS pulled and pinned multi-architecture digest `sha256:7def261e143c118409c827ed78d2daef2befc093eb770168d025bcd37b81c510`. Before the switch, `deploy/backup.sh` wrote `~/containers/fillrate/backups/fillrate-20261002T170212Z.sqlite`, SHA-256 `cd14571cd916ee33d98201e5ae0c960a20aa23f3e7dbc72500cd025bcd86bfa2`; `sha256sum -c` and SQLite integrity passed with 9 migrations, and the backup/checksum files are mode 600. A disposable restore of the same-content preceding backup under the new image migrated to 10, with SQLite integrity `ok`, the new access/admin tables present and worker health connected. The disposable container and data were removed. The live Compose file is mode 600 and now sets hosted mode, `SIGNUP_MODE=request` and `ADMIN_GITHUB_ID=119372400`. The replacement container is healthy with 10 migrations and integrity `ok`; public HTTPS `/api/v1/me` reports hosted/request, `/api/auth/get-session` returns 200, `/api/v1/admin/access-requests` returns 404 anonymously, and the worker is connected. The live request page's GitHub button reaches the GitHub sign-in URL with the configured Fillrate callback. The daily systemd user backup timer is active. The owner then signed in successfully; the screenshot shows the account page, and the VPS database links the configured numeric GitHub ID to an approved account. Public `/api/v1/me` remains hosted/request and the worker remains connected. Local automated two-user isolation and quota checks passed. The owner explicitly waived a second live GitHub account and the live two-account script; that cross-account production check was not performed. No release action remains for hosted signup. On-server copies do not survive server or disk loss.

**Quota check against these timings:** one worker solves one job at a time. The largest bounded run (2,000 orders at the default budget) takes about 81 s on the VPS. With the hosted defaults (global queue 10, one unfinished job per account, 20 solves per account per day), a full queue waits about 14 minutes at worst, and one account can use about 27 CPU-minutes a day. The starting values stay unchanged. Lower `MAX_QUEUED_RUNS` or `QUOTA_SOLVES_PER_DAY` if real traffic queues longer than that.

## Prepare each target

Required access: shell/SSH to each intended target, repository access, Node 24, Bun, Python 3.13/uv, installed dependencies, and Docker/Compose access for deployment recovery checks. Keep evidence outside the working tree and record available disk/memory, CPU/architecture, runtime versions, commit, dirty state and immutable image digest. Use the same commit/settings on both targets. Build images only in GitHub Actions and pull the tested release by digest.

From the repository root:

```sh
git checkout main
git pull --ff-only
git rev-parse HEAD
git status --short
bun install --frozen-lockfile
cd services/optimizer
UV_PYTHON=python3.13 uv sync --locked
```

`FILLRATE_MODE=local` (account-free, no keys) is implemented. The same steps work with `npm ci` in place of `bun install --frozen-lockfile` (`local.md`); target evidence so far uses Bun and the image. Do not place deployment credentials or private data in Git.

## Repeatable benchmark evidence

Preferred: from a checkout (or a copy holding `deploy/` and `services/optimizer/benchmarks/`), run `python3 deploy/target_check.py <image@digest> ~/fillrate-evidence/<host>-<commit> --label <host>`. It needs only Docker and Python 3 on the host and covers the benchmark runs below as well as recovery checks 1–4. The native procedure below remains for timing outside the image.

From `services/optimizer`, set a target label/directory for the machine:

```sh
FILLRATE_EVIDENCE_DIR="$HOME/fillrate-evidence/owner-vps"
mkdir -p "$FILLRATE_EVIDENCE_DIR"
git rev-parse HEAD > "$FILLRATE_EVIDENCE_DIR/commit.txt"
git status --short > "$FILLRATE_EVIDENCE_DIR/working-tree.txt"
uname -a > "$FILLRATE_EVIDENCE_DIR/system.txt"
lscpu > "$FILLRATE_EVIDENCE_DIR/cpu.txt"
free -b > "$FILLRATE_EVIDENCE_DIR/memory.txt"
node --version > "$FILLRATE_EVIDENCE_DIR/node.txt"
bun --version > "$FILLRATE_EVIDENCE_DIR/bun.txt"
uv --version > "$FILLRATE_EVIDENCE_DIR/uv.txt"
python3.13 --version > "$FILLRATE_EVIDENCE_DIR/python.txt"
for attempt in 1 2 3 4 5; do
  UV_PYTHON=python3.13 uv run python benchmarks/m3_2000.py \
    --out "$FILLRATE_EVIDENCE_DIR/comparable-$attempt.json" \
    > "$FILLRATE_EVIDENCE_DIR/comparable-$attempt.log" 2>&1 || break
  UV_PYTHON=python3.13 uv run python benchmarks/m3_2000.py --default-budget \
    --out "$FILLRATE_EVIDENCE_DIR/default-$attempt.json" \
    > "$FILLRATE_EVIDENCE_DIR/default-$attempt.log" 2>&1 || break
done
```

The probe uses synthetic 2,000-order/640-location/k=8 input. Its comparable mode uses 500 iterations per cluster (5 s cap); default mode uses 10 s per cluster. Preserve every JSON/log, including failed attempts. Verify the probe's validity, truck/cluster counts and the 600 s run wall bound; summarize per-target total/solve median, minimum and maximum, with settings and failure counts. The target harness should automate collection and reject invalid run counts. Use real-worker acceptance runs separately to check completeness and shipment/revenue/export behavior. A native probe does not prove container performance; record image-based timings separately against the same tested digest/settings when available. Tune hosted admission limits against actual target behavior before public signup.

## Recovery, storage and access checks

Perform disruptive recovery checks against synthetic/disposable data or a verified backup; keep a separate recovery record for each target. Document the exact Compose service/container/process commands for the installed release rather than assuming names. Protect the operator dataset throughout.

1. **Persistence/restart:** record the actual mounted SQLite directory/volume (current runtime uses `/app/data`), save a scenario and validated run, restart the container, and confirm scenario/version/job/artifact/export identities and values survive. A filesystem path without a persistent volume is not durable deployment evidence.
2. **Worker loss:** start a bounded job, stop the worker, record lease expiry/reclaim/retry and checkpoint behavior after restart, and confirm the final persisted result passes independent validation without duplicate work or ownership changes. Keep failure/recovery logs.
3. **Cancellation:** cancel queued/running work, verify bounded termination and worker capacity recovery, and confirm late artifact writes are refused by lease fencing.
4. **Backup/restore:** use a consistent SQLite backup method that handles WAL state; record source path, backup time and hash. Restore into a separate dataset, verify migrations and scenario/run/artifact/export integrity, then document the rollback procedure before applying hosted ownership/auth migrations. Retention and backup expiry must have defined semantics.
5. **Ingress/transport:** verify canonical HTTPS configuration and private optimizer/worker boundaries. Production public synthetic access must remain bounded; existing operator data stays protected pending explicit migration.
6. **Hosted acceptance (implemented and owner-accepted):** `bun run test:hosted` covers request-mode pending/approval/revoke/restore and cross-account isolation against a local production build using database-written sessions. The owner signed in on the deployed image; the configured numeric GitHub ID is linked to an approved account. Live image, worker, request-only mode, admin refusal and backup/restore evidence are recorded above. Cross-account access between two live GitHub accounts was waived by the owner and was not tested. Keep automated isolation tests as regression coverage. `scripts/live-two-account.mjs` is optional diagnostics, not a release gate.
7. **Local distribution (after explicit mode):** root Bun/npm install/dev/build/worker and amd64/arm64 Docker/Compose local startup need no auth credentials. Record native-platform support, dependency/lockfile policy, SQLite location/export/backups, loopback defaults and hosted misconfiguration refusal. Recorded in `local.md` (2026-10-05): native npm verified on Node 22 in a dev container, Node 24 + npm in CI's `npm` job, Compose local startup through the image smoke only.

## Completion and handoff

VPS hardware/recovery checks and the agreed hosted release gates are complete. The owner accepted omission of a second live GitHub account check; do not report this as a tested production property. Account-free native Bun/npm distribution and the handoff (`handoff.md`) were added on 2026-10-05. M6 routing implementations and M7 are delivered; remaining current work is the M8 dashboard/candidate gates, final image/deployment, signed-in hosted road UI check and native target timings, as recorded in `progress.md`. Protected-import and experiment browser acceptance passed locally on 2026-10-02. Keep exact commands, raw artifact locations/hashes, immutable digest/commit, supported platforms, limitations and unresolved failures in `progress.md` and this record.
