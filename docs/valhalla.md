# Valhalla road service (optional)

Fillrate can build directed road matrices with a self-hosted [Valhalla](https://valhalla.github.io/valhalla/)
using `truck` costing (spec §7, §14). It is optional: estimated haversine × circuity stays the default,
and the app never calls a public Valhalla server. Matrix semantics, snapshots and the durable job are in
`docs/m6-road-matrices.md`.

## Pinned image

`deploy/compose.yaml` profile `valhalla` runs
`ghcr.io/valhalla/valhalla-scripted:3.9.0@sha256:89daaf61547167893cf58c03defd43c6eba0071dc965988c16a629260f8ac683`.
The digest is the multi-arch index. Checked on 2026-10-05 with `docker manifest inspect`:

| Platform | Manifest |
| --- | --- |
| linux/amd64 | `sha256:3533496a1fce57cdd1856aed0449f90e8e0318ea12906178e35423760541f198` |
| linux/arm64 | `sha256:7da5e294136b0a04de59ccbfc05aa11bf6805eeb07d8b60d23d08989130c2f9e` |

The arm64 image was pulled and run on Apple silicon (Colima). Keep the tag and digest in `compose.yaml` and
`deploy/valhalla/prepare.sh` in step when upgrading, and re-run the live checks below.

## Setup

1. Prepare extracts, metadata and limits (needs `curl` and Docker; JSON work runs inside the pinned image):

   ```sh
   deploy/valhalla/prepare.sh north-america/us/tennessee north-america/us/mississippi north-america/us/arkansas
   ```

   Region paths are [Geofabrik](https://download.geofabrik.de/) paths. Choose coverage that spans at least
   the 500 mi leg limit around the depot. The script writes into `$VALHALLA_DATA`
   (default `deploy/valhalla-data/`, gitignored): the `.osm.pbf` extracts (MD5-checked against Geofabrik),
   `extract-meta.json` (URLs, extract dates, MD5/SHA-256, image, limits, `dataset_revision`), `valhalla.json`
   (service limits) and the pinned OpenStreetMapSpeeds `default_speeds.json`. Re-running with the same
   extracts keeps the built tiles; a changed extract set removes them so the container rebuilds (the image's
   own change detection keys on file names, not content).
2. Start it: `docker compose --profile valhalla up -d`. The first start builds tiles; later starts load them.
   The service publishes no host port; the app reaches it at `http://valhalla:8002`.
3. Once it is healthy, add the output of `deploy/valhalla/prepare.sh env` to `deploy/.env` (it prints
   `VALHALLA_URL`, `VALHALLA_VERSION`, `VALHALLA_DATASET_REVISION`, `VALHALLA_GRAPH_CONFIG_HASH` (SHA-256
   over `valhalla.json` and the tile archive), `VALHALLA_COSTING_OPTIONS` and the limits), then recreate the
   `fillrate` service. `/api/health` reports `road.valhalla` with the version, dataset and graph hash (never
   the endpoint), and `/scenarios` offers "Build road matrix (Valhalla)".

Never commit extracts, tiles or derived matrices for real data (spec §14).

## Prebuilt tiles for a small or shared host

Building tiles needs far more memory than serving them. The OK/TX/NM/CO/KS/MO/AR build peaked at 13.6 GiB, while serving the finished archive started at about 31 MiB before road requests. After matrix requests the hosted process retained about 1.94 GiB at idle (see the follow-up below); startup memory is not its warmed idle footprint. Build on a large machine, then copy and serve only:

1. **Build machine** (any Docker host with memory to spare; the host architecture does not matter, tiles are data):
   `deploy/valhalla/prepare.sh -d <dir> <regions>...`, then run the pinned image on `<dir>` with the default `deploy/compose.yaml` valhalla settings until `/status` answers, then stop it.
2. **Package**: `deploy/valhalla/bundle.sh <dir> <bundle>` copies only `valhalla_tiles.tar`, `valhalla.json`, `extract-meta.json`, `file_hashes.txt` and `default_speeds.json` and writes `SHA256SUMS`. No extracts or loose tiles are shipped.
3. **Serving host**: copy `<bundle>` to `$VALHALLA_DATA` (`scp`; `rsync` may be absent), check it with `sha256sum -c SHA256SUMS` *before the first start*, then
   `docker compose -f compose.yaml -f valhalla/compose.serve.yaml --profile valhalla up -d`.
   `compose.serve.yaml` turns off every build step and caps the service (`VALHALLA_CPUS`, default 1.0; `VALHALLA_MEM_LIMIT`, default 2g; `VALHALLA_SERVER_THREADS`, default 1). On start the image rewrites `valhalla.json` (paths and thread count), so its checksum changes after that; the other files must still match.
4. Run `VALHALLA_MAX_MATRIX_PAIRS=625 deploy/valhalla/prepare.sh env -d <dir>` **on the serving host** and add the output to the app's environment. The graph hash covers that host's effective `valhalla.json`. 625 pairs means 25 × 25 blocks, which keeps one CostMatrix request under the memory cap; see the evidence below.
5. Check the deployment: `python3 -I deploy/valhalla/region_check.py <url> <points.json>` (stdlib only; `deploy/valhalla/points-ok7.json` is the hosted example), then `deploy/smoke_valhalla.py <base-url> <scenario-key> ok7` through Fillrate where an operator key exists.

Moving to another server means copying the same bundle (or rebuilding from `extract-meta.json`), the Compose files and the env lines, then repeating steps 3–5. When the extract list is long, `prepare.sh` records a compact `dataset_revision`: region names, newest extract date and a SHA-256 prefix of the full per-extract revision. It keeps the full list as `dataset_revision_full`, because Fillrate accepts at most 200 characters.

## Service limits

| Setting | Value | Why |
| --- | --- | --- |
| `service_limits.truck.max_matrix_distance` | 2,000,000 m | Must cover the requested point extent, which can exceed the leg limit. It also scales CostMatrix's search cost threshold; see below. |
| `service_limits.truck.max_matrix_location_pairs` | 2,500 | Fillrate's `VALHALLA_MAX_MATRIX_PAIRS` matches; blocks are 50 × 50. |
| `service_limits.truck.max_locations` | 20 | Route requests (geometry) chunk to this. |
| `thor.costmatrix.hierarchy_limits.max_up_transitions` | 4,000 / 1,000 | See below. |
| `thor.costmatrix.max_iterations` | 20,000 | |
| `thor.costmatrix.allow_second_pass` | true | |
| `thor.clear_reserved_memory` | true | Release Thor search buffers between requests; verify warmed idle and latency after applying. |

**CostMatrix search limits.** With Valhalla's default CostMatrix limits the truck matrix returned no path
(`null`) for Nashville ↔ Jackson, MS on the TN/MS/AR tiles, although the Route API found 669 km. Fillrate
treats `null` as an unreachable edge, so a search that gives up would wrongly exclude stops. Raising the
hierarchy transitions (and iterations) returned the path; `tests/test_valhalla_live.py` asserts every pair
inside coverage has one.

**Cost threshold (2026-10-07).** CostMatrix stops searching at a cost threshold derived from `max_matrix_distance`. At 1,000 km on the OK7 tiles, truck legs of 748–1,053 road km (Dallas → Amarillo, Dallas → Springfield MO, Kansas City → Dallas, Amarillo → Little Rock) came back `null`, even as 1 × 1 requests, although `/route` found each one in 150–500 ms. Raising the hierarchy transitions (40,000/10,000) or switching to `timedistancematrix` did not fix it, and memory rose to 4.9–5.9 GiB. At 2,000 km every pair returned, and a 25 × 25 block peaked under 2 GiB. `prepare.sh` now defaults to 2,000 km. Fillrate's leg limit still decides reachability afterwards.

**Block composition.** CostMatrix searches a request's sources and targets together, so a pair's chosen path
can change with the block it is in: Jackson, MS → Tupelo was 347.2 km in a 7 × 7 request and 366.0 km in
3 × 3 blocks. A stored snapshot is immutable and runs and replays reproduce from it exactly; a rebuilt
snapshot with a different block size can differ, so the block size is recorded in the snapshot options.

**Coverage.** Before a matrix, Fillrate asks `/locate` which nodes snap to the graph. A node outside the built
coverage gets unreachable edges in both directions and an `outside_coverage` warning in the snapshot; it is
never approximated and never sent to the matrix endpoint (Valhalla would reject the whole request: HTTP 400,
error 170 or 154). Preflight then blocks it as `far_from_depot` unless that check is downgraded to a warning,
in which case the run reports it `unreachable`. Server rejections (point extent or pairs over the limits) are
provider errors that fail the job, never unreachable edges.

## Verification

- `services/optimizer/tests/test_valhalla_live.py` (skipped unless `VALHALLA_URL` is set): export the
  `prepare.sh env` lines with the endpoint reachable from the host, then `uv run pytest tests/test_valhalla_live.py`.
  It checks a complete directed truck matrix with road-scaled distances and truck speeds, block reassembly,
  progress, out-of-coverage nodes (Birmingham, AL; Denver, CO), server-side rejections versus client-side
  limits, and cancellation.
- `deploy/smoke_valhalla.py <base-url> <scenario-key>`: imports a TN/MS/AR scenario with one stop outside
  coverage, cancels a queued snapshot job, builds a snapshot through the durable job, checks the stored
  document (provider, coverage warning, every covered pair present), checks that preflight blocks the
  uncovered stop, runs the pipeline on the snapshot with that check as a warning, checks every planned leg
  equals the recorded matrix value, and checks the replay bundle ships the snapshot. It is not in
  `deploy/smoke.sh` because the image smoke runs without a road service.

### Local evidence (2026-10-05)

Local Colima on Apple silicon, not owner deployment evidence: Colima 4 vCPU / 12 GiB (aarch64) on an 8-core,
32 GB Mac. Geofabrik `tennessee`, `mississippi` and `arkansas` extracts (Last-Modified 2026-10-05, 385 MB
together; `dataset_revision` `geofabrik:tennessee@2026-10-05T15:47:33Z#bc7ba8accce8,mississippi@2026-10-05T15:46:20Z#fda2095b9daa,arkansas@2026-10-05T15:46:50Z#a70c4896bc2a`).

- `prepare.sh`: 70 s (mostly the download).
- First start to serving: 4 min 22 s (tile build 101 s plus admin/timezone databases and the tile archive);
  sampled peak container memory 3.7 GiB; 2.2 GB on disk (903 MB tile directory, 808 MB archive, 128 MB
  timezones, extracts). Later starts load the tiles in about 13 s.
- The live pytest file passed 7/7; `smoke_valhalla.py` passed against a local production build and worker
  (snapshot job for 8 nodes in about 5 s, the same content hash on every rebuild with the same block size;
  one truck over about 1,000 road mi; offline `REPLAY OK` of that run's bundle without Valhalla).
- Compose: a local arm64 build of the Fillrate image with `--profile valhalla` passed `smoke_valhalla.py`
  through the Compose network (`docs/release-verification.md`).
- Valhalla warns that tiles built from several extracts can mishandle ways crossing the extract borders
  ([valhalla#3925](https://github.com/valhalla/valhalla/issues/3925)); merging extracts first (for example
  with osmium) avoids it. No cross-border failure was observed in these checks.

### Hosted deployment evidence (2026-10-07, owner VPS)

Coverage chosen by the owner: Oklahoma and its bordering states. Geofabrik extracts `oklahoma`, `texas`, `new-mexico`, `colorado`, `kansas`, `missouri`, `arkansas` (Last-Modified 2026-10-05; 1.83 GB of extracts). `dataset_revision` is `geofabrik:oklahoma,texas,new-mexico,colorado,kansas,missouri,arkansas@2026-10-05T15:49:55Z#sha256:19706bf62442fa2f`; the full per-extract list with MD5 prefixes is in `extract-meta.json`.

- **Off-host build** (Colima 6 vCPU / 20 GiB on the owner's Mac, Apple M1 Pro): `prepare.sh` 2 min 36 s (downloads). First start to serving took 955 s, with a sampled peak container memory of 13.6 GiB. Output: `valhalla_tiles.tar` 3,843,676,160 bytes (SHA-256 `dc127c17…5e8`, 3,640 tiles); bundle 3.6 GB. The upload with `scp` took 891 s.
- **Serving host** `hostinger` (x86_64, 2 vCPU, 7.8 GiB RAM, no swap, shared with the live site and other services): the bundle is in `~/containers/fillrate/valhalla-data`. Service `fillrate-valhalla` uses the pinned image with prebuilt-only settings, `cpus: 1.0`, `mem_limit: 2560m`, one server thread and no host port. It was ready 18 s after `up` (including the image pull), at 31 MiB before road requests (fresh-start measurement, not warmed idle). Effective graph hash: `sha256:3946a6965044f3caf6c156f6c35cbd4b567dbf0ea6a8df5ea729271c3e3bc9c9`. Disk use went from 7.5 GB to 12 GB of 99 GB.
- **`region_check.py` from inside the Compose network** (2026-10-07): all 12 inside points locate on truck edges and Nashville TN / Phoenix AZ / Omaha NE do not. The 10 × 10 directed truck matrix has every pair (8.8 s; Oklahoma City → Dallas 332.2 km, return 332.9 km). The OKC → Dallas route returned geometry (0.32 s, 3.68 h). A 25 × 25 random block across the ~1,000 km extent had 0 nulls in 48.7 s. Peak container memory was 1.82 GiB of the 2.5 GiB cap, the host 1-minute load peaked at 1.10, and the public site answered 200 in 0.29 s during the check.
- **App configuration**: the `fillrate` service has the `prepare.sh env` lines (625 pairs, 2,000 km). `/api/health` reports `road.valhalla` configured with the version, compact revision and graph hash, and `ValhallaConfig.from_env()` inside the hosted worker accepts the settings. The image was unchanged (`sha256:607f0b45…df3ff`, source `b296645`). Rollback: `compose.yaml.pre-valhalla` and the pre-change backup `fillrate-20261007T143812Z.sqlite` (SHA-256 `124e01f2…e209`, integrity ok, 12 migrations).
- **Through Fillrate** (local production build and worker against a byte-equivalent serving copy with the same graph hash, 1 CPU / 2.5 GiB): `deploy/smoke_valhalla.py … ok7` passed. The durable snapshot job for 8 nodes built in 6.1 s; Nashville was reported outside coverage and unreachable; the run on the snapshot planned 1 truck and 1,183 road mi with every leg equal to the recorded matrix; the replay bundle shipped the snapshot; and a queued job cancelled. Inspected-truck road geometry was fetched and cached through `/api/v1/runs/<id>/geometry`.
- **Verified live (2026-10-07)**: the owner, signed in, built a 16-node snapshot (240/240 edges), ran on it and drew Shipment 1's road geometry (3/3 legs, 289.5 km road versus matrix) through the hosted UI. The default 50 × 50 block was not used on this host: it reached 3.7 GiB uncapped at the old distance limit.


### Warmed idle memory follow-up (2026-10-07)

A read-only check after the matrix tests found `fillrate-valhalla` at 1.935 GiB and 0.03% CPU,
with no OOM kills or restarts; the shared host still had 4.34 GiB available. Its cgroup reported
about 1.59 GiB anonymous memory and 348 MiB file memory. The effective configuration had
`thor.clear_reserved_memory=false`, a 25-location reservation and 2,000,000 reserved bidirectional
Dijkstra labels. This is consistent with retaining search allocations after the earlier large matrix,
rather than continuing computation at idle. The 30-second `/status` health checks in the logs do not
show a matrix workload. These readings do not prove the absence of a leak over time.

`prepare.sh` now requests `thor.clear_reserved_memory=true`. In the pinned
[Valhalla 3.9.0 CostMatrix implementation](https://github.com/valhalla/valhalla/blob/3.9.0/src/thor/costmatrix.cc#L143-L194),
this replaces the reached maps and shrinks search buffers when clearing a request. The
[configuration generator](https://github.com/valhalla/valhalla/blob/3.9.0/scripts/valhalla_build_config)
exposes this option. It preserves road matrices and geometry, coverage, search distance/hierarchy
limits and the serving caps. It may increase repeated-request allocation cost. The allocator and graph
cache can still retain memory; no specific warmed idle reduction is claimed until measured.

**Apply to an existing prebuilt serving deployment only after approval:** avoid running preparation on
the serving host, because it can download newer extracts and invalidate tiles. Instead, retain the
current graph and patch its configuration in place:

1. Save the existing effective `valhalla.json`, app `VALHALLA_*` environment, Compose files and a database
   backup. Record the current graph hash. Pause road requests during the short restart/config transition.
2. In the serving data directory, write a temporary file using
   `jq '.thor.clear_reserved_memory = true' valhalla.json > valhalla.json.tmp`, check
   `jq -e '.thor.clear_reserved_memory == true' valhalla.json.tmp`, preserve the original file's owner and
   permissions, then replace `valhalla.json`. Keep 625-pair app blocks (25 × 25), 2,000 km distance/search
   limits, one thread, one CPU and the existing 2.5 GiB memory cap.
3. Restart only the prebuilt Valhalla service using its existing Compose files/settings. Wait for health,
   and verify the effective JSON still has the flag and unchanged limits after the image rewrites paths
   and thread count. Do not rebuild tiles or change cache/search limits in this trial.
4. Run `VALHALLA_MAX_MATRIX_PAIRS=625 deploy/valhalla/prepare.sh env -d <serving-data-dir>` **after startup**,
   then replace the app's `VALHALLA_*` values with that output and recreate the app. The config change
   changes `VALHALLA_GRAPH_CONFIG_HASH` even though tiles are unchanged; never keep the previous hash.
   Confirm `/api/health` reports the new identity.
5. Repeat `region_check.py`, the same complete 25 × 25 block and the signed-in road snapshot/run/geometry
   flow. Record covered null pairs, cold/repeat latency, peak memory, CPU/site responsiveness and memory
   immediately after each request and again after 1 and 5 idle minutes. Compare against the earlier
   48.7-second, 0-null block and the observed 1.935 GiB warmed idle. The local config checks do not replace
   this live benchmark.

Existing snapshots and runs remain immutable and usable for solving/replay. New road-geometry requests
for runs with the old graph/config hash are refused as `provider_context_mismatch`; make a new road
snapshot and run under the new identity to fetch geometry. Already stored geometry retains its original
identity. Do not relabel old snapshots to the new hash. To roll back, restore the backed-up JSON, restart
Valhalla, regenerate the identity from its effective config and restore the matching app environment.

The local tuning was subsequently applied with owner approval and measured on the VPS; see the results below.
If warmed idle is still too high, serving the same pinned graph on a separate host or an explicitly
on-demand service can preserve functionality; those options need operational and cold-start acceptance.


### Approved VPS tuning results (2026-10-07)

The owner approved applying and benchmarking the conservative tuning. The existing app queue was idle
(one completed job), and the app was briefly stopped to prevent new road requests during the configuration
transition. Private backups under `~/containers/fillrate/backups/valhalla-memory-20261007` include the original
Compose/effective JSON/app environment and an online SQLite backup (integrity `ok`, 12 migrations).
Only `thor.clear_reserved_memory` changed in the effective routing configuration; existing matrix/search
limits, pinned images, tile archive, one thread, one CPU and the 2.5 GiB memory/swap cap were preserved.
The server still allows 2,500 matrix pairs; the app's bounded requests remain 625 pairs (25 × 25).
No image was pulled or rebuilt and no tiles were rebuilt.

After the restart, the graph/config identity changed from
`sha256:3946a6965044f3caf6c156f6c35cbd4b567dbf0ea6a8df5ea729271c3e3bc9c9` to
`sha256:208e3e70ea06dfa730910332081b2cff0b6cc2aa3758441ce335c09f4bbe338d`.
Only that app environment variable changed; the same app image was recreated. `/api/health` reports the
new identity, healthy database and connected worker. The tile archive SHA-256 remains
`dc127c170540ea81ae4a933b45dbdf95b5487c478ff7acea559b73f654e665e8`; combining it with the backed-up
configuration reproduced the original graph hash, verifying that the graph data stayed unchanged.

The same `region_check.py points-ok7.json --max-block 25` check ran before the change, first after restart,
and again without restarting. It uses `random.Random(0)` to generate the same block and all 25 points
located on the graph. Every trial found all 12 inside points, excluded all three outside points, returned
all directed pairs in both 10 × 10 and 25 × 25 matrices, and returned OKC → Dallas truck road geometry
(332.2 km, 3.68 h, 15,077 shape characters). Canonical matrix-row SHA-256 values were identical in all
three trials: `16396dfc…6f40` for 10 × 10 and `61a0b1c5…695a` for 25 × 25.

| Measurement | Before tuning | First after restart | Repeat after tuning |
| --- | --- | --- | --- |
| 10 × 10 matrix | 7.073 s | 8.511 s | 7.197 s |
| 25 × 25 matrix, zero null pairs | 39.012 s | 44.778 s | 43.445 s |
| Route geometry | 0.212 s | 0.306 s | 0.238 s |
| Sampled peak cgroup memory (0.5 s sampling) | 1.937 GiB | 1.376 GiB | 1.375 GiB |
| At matrix response completion | 1.909 GiB | 1.349 GiB | 1.353 GiB |

The first-after-restart run includes coverage and the 10 × 10 matrix before its 25 × 25 request; it is not
an isolated cold-cache 25 × 25 sample. The repeat was about 11% slower than the single before sample;
these are single trials on a shared VPS, not a latency distribution. Near one CPU was used during matrix
searches, within the existing cap. The public site answered HTTP 200 in 0.237 s during the baseline,
0.141 s during the first tuned trial, and 0.157 s after the repeat.

The response-completion memory reading is too early to call steady idle: by 17 seconds after the repeat,
the cgroup had dropped to 561 MiB (about 0.548 GiB), with about 553 MiB anonymous memory. At both 60 seconds
and 300 seconds it remained 561 MiB. The process RSS was about 1.34 GiB and PSS 1.28 GiB, including mapped graph pages;
the cgroup's charged memory and process resident memory are different measures and must not be conflated.
Host available memory was about 5.40 GiB, compared with 4.34 GiB in the earlier idle observation.
No swap, OOM events or automatic restarts were observed.

At five minutes the cgroup measured 588,742,656 bytes (561.5 MiB), anonymous memory 580,313,088 bytes,
and file charges 2,580,480 bytes; process RSS/PSS were 1,435,017,216/1,369,612,288 bytes. Host available
memory was 5.42 GiB. CPU use over the final four idle minutes averaged about 0.23% of one core; the
30-second health probes remained active. The public site answered HTTP 200 in 0.314 s at final idle.
These readings and final sanitized evidence are under
[the memory-trial assets](reviews/assets/valhalla-memory-2026-10-07/). Buffer clearing preserves the tested
routing behavior while lowering retained private/search memory; it does not make the road service
memory-free. Road queries can still rise toward the measured 1.38 GiB peak. The original-config rollback
procedure above remains available. Signed-in hosted snapshot/run/geometry UI acceptance and long-running
leak/load testing remain separate gates; this trial used synthetic direct-provider queries and health checks.
