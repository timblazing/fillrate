# Release verification and hardware evidence

This reference records the remaining M4/M8 release evidence. The canonical scope is in `fillrate-technical-spec.md` §§14–16 and the remaining work/dependencies are in `progress.md`. CI and runner benchmarks establish an implementation baseline; they do not replace evidence from the intended Ubuntu VPS and 64-bit Raspberry Pi or the actual hosted release.

## Current evidence and missing handoff

The public fulfillment lesson smoke is implemented on `main` at `ea66a3f` and documented in `browser-smoke.md`. Protected-import and experiment browser flows remain unimplemented. A cancelled attempt at the broader browser scope produced no recoverable changes, final failing command or detailed usage breakdown. Finish those flows individually using the existing launcher, isolated data and meaningful outcomes at desktop and 390 px.

The target-hardware harness is `deploy/target_check.py` (2026-10-01). It replaces the unrecoverable `3772136` claim. It runs against one tested image and only touches disposable containers and volumes. Its results for release `fa9c0b8` are below; raw outputs are kept on each host, outside Git.

### Results: image `sha256:740aee91…6d08c` (commit `fa9c0b8`, image 36956880394)

Probe: 2,000 synthetic orders, 640 locations, k=8, run inside the image. Every run was valid, with no failed attempts.

| Target | Hardware | Comparable, 5 runs: total s (median / min / max) | Default budget, 3 runs: total s (median / min / max) | Trucks (comparable / default) |
| --- | --- | --- | --- | --- |
| VPS `hostinger` | x86_64, 2 vCPU AMD EPYC 7543P, 7.9 GB, Debian 13, Docker 29.5.2 | 5.97 / 5.84 / 7.78 | 81.43 / 81.34 / 81.50 | 205 / 203 |
| Raspberry Pi 5 `anton` | aarch64, 4 cores, 8 GB, Raspberry Pi OS (6.18 kernel), Docker 29.8.2 | 7.08 / 7.06 / 7.18 | 81.55 / 81.54 / 81.56 | 205 / 203 |

The default-budget time is dominated by the 10 s per cluster solver budget (8 clusters, solved one after another), so both targets take about 81 s. The VPS run shared its two vCPUs with the live site.

Recovery checks ran on a container with `--restart unless-stopped`, `LEASE_MS=15000` and 3 s heartbeats. They passed on both targets.

| Check | VPS | Pi 5 |
| --- | --- | --- |
| Persistence: imported scenario + validated run and synthetic run, container restart, identical summary/JSON/CSV hashes and scenario | ok, worker back in 2.7 s | ok, 2.5 s |
| Worker loss: SIGKILL the supervisor mid-solve; the container restarts, attempt 1 ends `lease_expired`, attempt 2 reuses 8 checkpointed stages and succeeds valid with one solve/validation/summary | ok, 60.6 s kill → result | ok, 59.1 s |
| Cancellation: a running and a queued run, then a new run on the same worker | ok, running cancelled in 2.1 s, follow-up succeeded | ok, 2.1 s |
| Backup/restore: `deploy/backup.sh` online backup (integrity ok), restore into a new volume, second container; scenario and three runs' summary/export hashes identical | ok (`142f077f…`) | ok (`b699c3d0…`) |

The `summary.json` SHA-256 is `cc5be892…62f1` on the VPS and `b65006f9…caa3` on the Pi, under `~/fillrate-evidence/<host>-fa9c0b8/`. A trial run of the harness against the previous image (`36c023a5…`) showed that a cancel arriving while the solver child was calling the server ended the run **failed**. `fa9c0b8` fixes this and adds an e2e regression test. Late artifact writes after a cancel or a lost lease are refused by lease fencing; the store and transport tests cover this, and the harness does not repeat it.

**Production deployment (2026-10-01):** `fillrate.blasingame.dev` runs the same digest, pinned in `~/containers/fillrate/compose.yaml`, in operator mode (`FILLRATE_MODE` unset). Migration 0008 was backed up first (`fillrate-20261002T030411Z.sqlite`, SHA-256 `364a6d92…1061`; the database had no scenarios or runs) and then applied: 9 migrations. Health reports the worker connected. A live lesson run (`ea942afd…`) succeeded valid and complete, and its CSV export downloads. Hosted accounts are not switched on; the GitHub OAuth app is still needed. A systemd user timer takes daily backups (03:17 UTC) with 30-day rotation; the host has no cron.

**Quota check against these timings:** one worker solves one job at a time. The largest bounded run (2,000 orders at the default budget) takes about 81 s on either target. With the hosted defaults (global queue 10, one unfinished job per account, 20 solves per account per day), a full queue waits about 14 minutes at worst, and one account can use about 27 CPU-minutes a day. The starting values stay unchanged. Lower `MAX_QUEUED_RUNS` or `QUOTA_SOLVES_PER_DAY` if real traffic queues longer than that.

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

`FILLRATE_MODE=local` (account-free, no keys) is implemented. npm startup is still planned; the current Bun commands do not establish it. Do not place deployment credentials or private data in Git.

## Repeatable benchmark evidence

Preferred: from a checkout (or a copy holding `deploy/` and `services/optimizer/benchmarks/`), run `python3 deploy/target_check.py <image@digest> ~/fillrate-evidence/<host>-<commit> --label <host>`. It needs only Docker and Python 3 on the host and covers the benchmark runs below as well as recovery checks 1–4. The native procedure below remains for timing outside the image.

From `services/optimizer`, set a separate target label/directory for each machine (replace `owner-vps` with `owner-raspberry-pi` on the Pi):

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
6. **Hosted acceptance (implemented; needs configuration and the live run):** `bun run test:hosted` covers these checks against a local production build, with database-written sessions. Repeat them on the deployment with two real GitHub accounts using `scripts/live-two-account.mjs` (rehearsed 38/38 against a local hosted production build with a real worker), following `hosted-operations.md`. two users cannot read/mutate each other's scenarios, versions, jobs, snapshots, caches, indirect artifacts or exports by guessed IDs/hashes. Test login/logout/expiry, private import → solve → valid result → export/delete, quota/reset responses, concurrent admissions and retries, missing-config startup refusal, and retained synthetic viewing. Record deployed digest/volume and retention/deletion/geocoding disclosure.
7. **Local distribution (after explicit mode):** root Bun/npm install/dev/build/worker and amd64/arm64 Docker/Compose local startup need no auth credentials. Record native-platform support, dependency/lockfile policy, SQLite location/export/backups, loopback defaults and hosted misconfiguration refusal.

## Completion and handoff

Keep the hardware/recovery gate open until both actual targets supply timings and recovery evidence. Keep hosted real-data release open until identity, ownership, quotas, private deployment configuration and live two-account checks pass. Provide exact reproducible commands, raw artifact locations/hashes, immutable digest/commit, supported platforms, limitations and unresolved failures. Record results in `progress.md` and accepted decisions in `decisions.md`; update `status.json` only when verified milestone progress moves.
