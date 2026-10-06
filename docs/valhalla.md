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

The arm64 image was pulled and run on Apple silicon (Colima), which covers the Raspberry Pi 5's
architecture; it has not run on the Pi itself. Keep the tag and digest in `compose.yaml` and
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

## Service limits

| Setting | Value | Why |
| --- | --- | --- |
| `service_limits.truck.max_matrix_distance` | 1,000,000 m | Must cover the requested point extent, which can exceed the leg limit. |
| `service_limits.truck.max_matrix_location_pairs` | 2,500 | Fillrate's `VALHALLA_MAX_MATRIX_PAIRS` matches; blocks are 50 × 50. |
| `service_limits.truck.max_locations` | 20 | Route requests (geometry) chunk to this. |
| `thor.costmatrix.hierarchy_limits.max_up_transitions` | 4,000 / 1,000 | See below. |
| `thor.costmatrix.max_iterations` | 20,000 | |
| `thor.costmatrix.allow_second_pass` | true | |

**CostMatrix search limits.** With Valhalla's default CostMatrix limits the truck matrix returned no path
(`null`) for Nashville ↔ Jackson, MS on the TN/MS/AR tiles, although the Route API found 669 km. Fillrate
treats `null` as an unreachable edge, so a search that gives up would wrongly exclude stops. Raising the
hierarchy transitions (and iterations) returned the path; `tests/test_valhalla_live.py` asserts every pair
inside coverage has one.

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
- Valhalla warns that tiles built from several extracts can mishandle ways crossing the extract borders
  ([valhalla#3925](https://github.com/valhalla/valhalla/issues/3925)); merging extracts first (for example
  with osmium) avoids it. No cross-border failure was observed in these checks.

The owner's deployment must choose its own coverage and record its build time, disk, memory and extract
dates in `docs/decisions.md` (spec §7).
