# Progress

## 2026-10-08: Uniform page layout and standard sidebar (Claude)
- Added `components/app/page.tsx` (`Page`, `PageHeader`, `PageTitle`, `PageSection`) and moved every `app/(app)` page onto it. Widths were 3xl/5xl/6xl/7xl with different padding; they now share one `max-w-7xl` frame, gutters and rhythm, and section headings share one size. AGENTS.md documents the convention for new pages.
- Sidebar: standard (non-inset) sidebar-07 arrangement, no rail, so only the trigger or ⌘/Ctrl+B toggles it. Learn and Labs sit in the bottom nav group. Settings and admin Access requests (pending count badge, plus a dot on the avatar) are in the account menu above Sign out. Local/operator mode shows a workspace menu with Settings.
- Verified: typecheck, lint (existing globe hook warning only), headless desktop 1440×900 and phone 393×852 screenshots of the scenarios, runs, experiments, learn, lesson, labs and settings pages in local mode, collapsed sidebar, and the account menu (local workspace and the gallery's hosted user). Not live until a new image is published and deployed.
- Docs reconciled: `f855f65` is the deployed baseline in the completion plan, owner actions and progress; stale #90/#91/#92/Pi references removed from current-state sections; open issues commented with current state.

## 2026-10-08: Hostinger updated to f855f65 (Codex)

Owner authorized Fillrate-only VPS cleanup and deployment. Existing `~/containers/fillrate/compose.yaml` now pins `ghcr.io/timblazing/fillrate@sha256:ad857042103b2959326be3eccdc08f4f16f3bc5f0a4a529b2be0ce2b859db59e` (tested source `f855f65`, image workflow [37710953655](https://github.com/timblazing/fillrate/actions/runs/37710953655)). Both platform manifests were rechecked before deployment. Only the Fillrate app container was recreated; Valhalla and unrelated VPS services were untouched.

- Private pre-upgrade Compose and online SQLite backup: `/home/clay/containers/fillrate/backups/upgrade-f855f65-20261008T163934Z`. Backup `fillrate-20261008T163934Z.sqlite` SHA-256: `29b5c019b4a14dc3ae1bc3124eacd61ec9102e339a2147005327b70c2347f9d2`; checksum and backup integrity passed.
- App/container health, connected worker, live SQLite integrity and 12 migrations passed. Public HTTPS health and anonymous hosted/request policy passed; anonymous admin endpoint returned 404. Backup timer remains active. Valhalla stays healthy with graph/config identity `sha256:208e3e70ea06dfa730910332081b2cff0b6cc2aa3758441ce335c09f4bbe338d`.
- Removed only generated `valhalla/__pycache__/region_check.cpython-313.pyc` and its empty directory. No unused Fillrate containers/volumes or expired backups were found. Retained database volume `fillrate_fillrate-data`, 3.6 GiB active tiles, protected backups and immediate rollback image `698fbd8`. No global Docker prune was run. Host disk was 11% used before upgrade.
- Rollback: in `~/containers/fillrate`, copy the private upgrade directory's `compose.before.yaml` to `compose.yaml`, then `docker compose config --quiet` and `docker compose up -d --no-deps fillrate`; repeat health/worker/access checks. No schema migrations changed between these images, so application rollback retains the current database.
- This verifies deployment and operational health, not a new signed-in workflow acceptance. #98, remaining #88 and #89 remain open; #93 timings stay optional.

## 2026-10-08: Integrated main image published (Codex)

- Source: `f855f6564f15c1836046d9861d27043c547aa00b` (#100 squash merge; #95 deployment records were merged first).
- [Image workflow 37710953655](https://github.com/timblazing/fillrate/actions/runs/37710953655) succeeded. CI/npm, native amd64/arm64 builds, architecture smoke tests, both benchmark modes and manifest publication all passed. Run started 2026-10-08 01:03:11 UTC and completed 01:22:57 UTC.
- Published `ghcr.io/timblazing/fillrate:sha-f855f65` and `:latest` resolve to index `sha256:ad857042103b2959326be3eccdc08f4f16f3bc5f0a4a529b2be0ce2b859db59e`.
- amd64 platform digest: `sha256:870012690774776a0a6231342c672ed800ecdce0ef68da1f8c8b963d95623ac1`; arm64: `sha256:44e7980cda4812b794beb268890519be9459896ccb11480ee4b6bf1be662852d`.
- Verified with `docker manifest inspect ghcr.io/timblazing/fillrate:sha-f855f65`, workflow publication logs, and authenticated registry manifest GETs for the immutable source tag and `latest`. Local Docker lacks buildx; no local build was performed.
- Publication only: no VPS upgrade was performed. The accepted deployed baseline remains `698fbd8` and its pinned digest/rollback record. #98 hosted road automation, targeted #88 dashboard states and #89 representative performance remain open; #93 native VPS timings are optional.


## 2026-10-07: Integrate dashboard fixes and refocus v1 (#100, Codex)
- Resolved #95 deployment-record conflicts while retaining owner scope/live-check evidence; #95 merged at `e89b41b`. Completed #100 against the sidebar workbench: explicit depot input/edit/versioning, distinguishing saved-scenario metadata, actionable import errors/notices, shared timeline selection and comparable experiment deltas. Review corrected the stored snapshot JSON paths and added a persistence regression assertion.
- Passed lint (one existing globe hook warning), typecheck, production build, 176 tests with real Python worker and 144 hosted/local checks. Expanded production `--flow=dashboard-audit` passed all six areas plus shell routes at desktop 1440×900 and iPhone 16 393×852 in both themes; 52 retained captures and row-specific limits are in the [coverage audit](reviews/m8-dashboard-coverage-audit-2026-10-06.md#2026-10-07-integrated-follow-up-100).
- Refocused the canonical spec/completion plan around owner-approved Hostinger v1 scope. Next: [#98 hosted road automation](https://github.com/timblazing/fillrate/issues/98), remaining targeted [#88 dashboard states](https://github.com/timblazing/fillrate/issues/88), then [#89 representative performance](https://github.com/timblazing/fillrate/issues/89). [#93 native VPS timings](https://github.com/timblazing/fillrate/issues/93) are optional handoff evidence. No Pi, manual accessibility/VoiceOver, physical-device or new solver scope is added.
- Publication of the integrated candidate is requested after clean PR integration. Deployment remains the accepted `698fbd8` until a newer digest is deployed and checked; publication does not close M8 or prove a VPS upgrade.


## 2026-10-07: Publish and deploy tested runtime update `698fbd8` (Codex)
- Image workflow [37680183468](https://github.com/timblazing/fillrate/actions/runs/37680183468) passed CI, npm, native amd64/arm64 builds, smoke tests, benchmarks and manifest publication. `ghcr.io/timblazing/fillrate:sha-698fbd8` resolves to multi-architecture index `sha256:c76155c1b57e4a65b544b636a2c18020d74626567a882039efb96b79d6861114`; platform manifest digests and the guarded rollback instructions are in [the release record](releases/upgrade-698fbd8.md).
- Deployed the pinned digest on Hostinger after the online SQLite backup passed checksum and integrity checks (12 migrations). Only Fillrate was recreated; hosted/request settings and the Valhalla service were preserved. The app and worker are healthy, the Valhalla graph identity is unchanged, the backup timer is active, anonymous hosted/request behavior passes and anonymous admin access returns 404.
- Removed four superseded root-level `compose.yaml.pre-*` snapshots after preserving the current Compose file in the private upgrade backup. Tagged the new image `sha-698fbd8`; kept the prior `latest` image as the immediate rollback image. No other old Fillrate image was present. Database backups and active Valhalla tiles remain under their existing retention/use.
- The owner's signed-in import → run → inspect → export and road geometry checks remain open in [#91](https://github.com/timblazing/fillrate/issues/91) and [#92](https://github.com/timblazing/fillrate/issues/92). M8 frontend issues [#88](https://github.com/timblazing/fillrate/issues/88)–[#90](https://github.com/timblazing/fillrate/issues/90) and native target timings [#93](https://github.com/timblazing/fillrate/issues/93) remain open; this release does not close M8.

## 2026-10-07: Issue triage session handoff (Claude)
Owner decisions this session. The decisions log has the full entry.
- **No Raspberry Pi target.** The Hostinger VPS is the only deployment target. Pi references were removed from docs and issues ([#96](https://github.com/timblazing/fillrate/pull/96)). arm64 images stay for local Docker on ARM hosts. [#93](https://github.com/timblazing/fillrate/issues/93) now covers native timings on the VPS only; I have SSH access as `hostinger`.
- **No VoiceOver or physical-device testing, and accessibility is out of scope for the v1 demo.** [#90](https://github.com/timblazing/fillrate/issues/90) was closed as not planned; the automated audit stays as historical evidence.
- **Owner live checks passed** on the deployed `698fbd8` ([#99](https://github.com/timblazing/fillrate/pull/99); #91 and #92 closed). Synthetic test files are in the owner's `~/Downloads/fillrate-demo-{orders,inventory}.csv`.
- **Hosted travel redesign** ([#98](https://github.com/timblazing/fillrate/issues/98), not started):
  - With Valhalla configured, runs always use roads, the matrix is built automatically and the Estimated option is removed.
  - Stops outside coverage block the run and are named.
  - Road geometry is computed for every shipment and drawn by default.
  - The heatmap becomes a one-line summary.
  - Exports are labelled with the run's real travel provider; the Shipment sheets CSV currently says "haversine × 1.2" on Valhalla runs.
  - GeoJSON export uses the road shapes.
- **[#88](https://github.com/timblazing/fillrate/issues/88) is in progress** in draft [#100](https://github.com/timblazing/fillrate/pull/100), stopped mid-session. It holds the required depot, the depot shown and editable on loaded scenarios, distinguishable saved scenarios, shared shipment selection on the Timeline tab, and experiment deltas. It is unverified and conflicts with #97 in `scenario-workbench.tsx`.
- **Order of work:** finish #100, then #98, then [#89](https://github.com/timblazing/fillrate/issues/89) (performance; agreed method: this Mac's headless Chromium against a local production build, 3+ cold and warm trials per viewport, plus one cold-load pass against the live site), then #93.
- **Working agreement:** merge PRs once checks pass without asking the owner. Ask the owner only for decisions or for things that need their account or hardware. Put any instructions for the owner in the final message of a turn.


## 2026-10-07: Owner live checks on deployed `698fbd8` (Claude)
- The approved owner, signed in on fillrate.blasingame.dev, ran the synthetic workflow: CSV import of 23 lines / 15 stops in OK/TX/KS with an Oklahoma City depot and one product short → save → run → shipments and unshipped reasons → Shipment sheets CSV export. Run `2945783c` succeeded, validated and complete: 7 shipments, 89% fill, $3,685 planned and $1,232 unshipped. Closes [#91](https://github.com/timblazing/fillrate/issues/91).
- Hosted roads: **Build road matrix (Valhalla)** produced a 16-node snapshot with 240/240 directed edges, 0 warnings and an exact coordinate match. The run used it (1,646 loaded mi; Travel step "Recorded"). **Show road geometry** for Shipment 1 drew 3/3 legs along roads, 289.5 km road versus 289.5 km matrix, with no notable differences. Closes [#92](https://github.com/timblazing/fillrate/issues/92); M6 road gate met.
- Owner findings, tracked in [#98](https://github.com/timblazing/fillrate/issues/98): hosted runs default to Estimated travel unless a matrix is built by hand; road geometry only appears after a per-shipment button; the matrix heatmap is unclear; the Shipment sheets CSV header says "miles are estimated (haversine × 1.2)" on a Valhalla run, though the values are road miles. The owner decided: roads always on hosted with automatic matrix builds, stops outside coverage block the run, road geometry is drawn by default, and the heatmap becomes a summary.
- Owner workbench findings went to the #88 work: a loaded scenario's depot isn't visible (the Import card resets to a Memphis default), and saved scenarios aren't distinguishable in the list.

## 2026-10-07: Integrate verified Valhalla and frontend PRs (Codex)
- Valhalla tuning/evidence [#85](https://github.com/timblazing/fillrate/pull/85) squash-merged at `67dca58` after [CI 37657236024](https://github.com/timblazing/fillrate/actions/runs/37657236024) passed checks/npm. Live memory and correctness evidence below remains scoped to the approved configuration trial, not a frontend image deployment.
- Frontend [#86](https://github.com/timblazing/fillrate/pull/86) passed [CI 37657289931](https://github.com/timblazing/fillrate/actions/runs/37657289931) on `f670dbb`. Merging updated main preserves both sets of progress/decision entries; application, worker, contracts and browser-runner source are unchanged from that tested frontend head. Fresh integrated-head CI remains the merge gate.

## 2026-10-07: Repeatable post-fix accessibility and candidate timings (Codex)
- Production candidate `f01687b` passed the retained 52-state accessibility rerun: 13 page states × light/dark × desktop/phone, zero automated WCAG A/AA violations/overflow/unreduced infinite motion and zero sampled focus failures (1,092 samples). [Audit and captures](reviews/m8-accessibility-audit-2026-10-07.md) retain axe incomplete contrast cases and gallery limits.
- Fixed newly observed route/cluster swatch label contrast with paired foreground tokens and replaced an unsupported page-counter accessible-name attribute with actual screen-reader text. Landing travel copy now names hosted OK/TX/NM/CO/KS/MO/AR coverage and outside-coverage behavior; gallery descriptions now identify reference fixtures and simulated stages rather than pre-M3 candidates.
- [Candidate performance](reviews/m8-candidate-performance-2026-10-07.md): three warm 2,000-order/443-shipment trials per viewport (47.1–98.1 ms desktop, 113.2–141.5 ms phone). Near-limit 1,001-node preview paint: 205.9–237.4 ms desktop, 220.3–230.2 ms phone. Results pagination/selection/keyboard scrolling/export/print, comparison/explorer and matrix save/run/directed legs/stale refusal passed. These are scoped local observations, not meaningful p95, cold-load or full frontend acceptance.
- Lint/typecheck/build and 144/144 hosted/local checks pass; lint retains the existing HeroGlobe hook dependency warning. `--flow=accessibility` is a separate explicit acceptance command, with synthetic temporary data and no live credentials. Source publication, full candidate CI, final frontend image/deployment, broader six-Block/performance acceptance and owner target/live-road UI evidence remain open.

## 2026-10-07: Apply and benchmark approved Valhalla buffer release (Codex)
- Owner approved the conservative VPS trial. Backed up effective configuration, Compose/app environment privately on-host and the database using online SQLite backup (integrity ok, 12 migrations), confirmed the queue idle, briefly paused the app, changed only `thor.clear_reserved_memory`, restarted the road service and recreated the same app image with its regenerated graph/config identity. Tiles, image pins, search limits, 625-pair app requests, one CPU/thread and 2.5 GiB cap are unchanged.
- All three synthetic region checks passed: 12 covered/3 uncovered points, complete directed 10 × 10 and seeded 25 × 25 matrices (zero nulls), and truck route geometry. Matrix response hashes matched exactly before and after. The 25 × 25 request took 39.012 s before, 44.778 s first after restart and 43.445 s on repeat; sampled cgroup peak fell from 1.937 GiB to about 1.376 GiB. Single shared-host trials are not a latency distribution.
- Memory fell after response completion: at 17 seconds, one minute and five minutes of idle, cgroup memory was 561 MiB (0.548 GiB), including about 553 MiB anonymous memory. Process RSS was about 1.34 GiB including mapped graph pages; the measures differ. Five-minute evidence is retained alongside sanitized readings and the sampling scripts in [valhalla.md](valhalla.md#approved-vps-tuning-results-2026-10-07). No OOM events, swap or automatic restarts; provider/app health and public site responsiveness passed.
- Effective graph/config identity is now `sha256:208e3e70ea06dfa730910332081b2cff0b6cc2aa3758441ce335c09f4bbe338d`. The app environment changed only this hash. Old-context geometry refusal remains intact; existing snapshots stay immutable. Live signed-in road UI acceptance and long-duration/load testing remain open; no synthetic app records or image release were created by this trial. No milestone estimate changed.

## 2026-10-07: Prepare Valhalla warmed-idle memory tuning (Codex)
- Read-only VPS evidence distinguishes the original 31 MiB fresh-start reading from 1.935 GiB retained after road matrices (0.03% CPU, no OOM kills/restarts, 4.34 GiB host available). The effective Thor configuration retained reserved search memory; this supports a buffer-retention explanation, not a measured leak diagnosis. Details and the safe config-only trial/rollback are in [valhalla.md](valhalla.md#warmed-idle-memory-follow-up-2026-10-07).
- `prepare.sh` now enables `thor.clear_reserved_memory` using the pinned 3.9.0 generator. Road functionality, coverage and search limits stay intact; the hosted trial retains 25 × 25 blocks, one CPU/thread and the 2.5 GiB cap. Config changes require a newly generated graph/config hash and matching app environment; geometry for old-identity runs is explicitly refused until a new snapshot/run is built.
- Validation: the actual upstream 3.9.0 generator accepted the option and produced true while preserving 2,000 km, 625-pair trial limits and CostMatrix search settings; `prepare.sh env` matched the config+tiles SHA-256 and changed with the flag (Docker metadata call stubbed). `bash -n`, `git diff --check`, and focused provider/geometry tests passed (65 passed; one live-provider test skipped). The initial Python 2.7 PATH collision was resolved by using Python 3.13 with a filtered PATH.
- This is a local prepared change: no VPS config write/restart, push, image publication or deployment. Applying it and measuring the same complete 25 × 25 block, peak memory, repeated latency and 1/5-minute idle memory require owner approval. Allocator/cache retention can still leave a large footprint; no reduction or milestone completion is claimed, and status estimates stay unchanged.

## 2026-10-07: Clean PR integration and final source CI (Codex)
- Recovery [#81](https://github.com/timblazing/fillrate/pull/81), hosted-road [#82](https://github.com/timblazing/fillrate/pull/82) and accessibility [#83](https://github.com/timblazing/fillrate/pull/83) are squash-merged. Integration commits are `b96694b`, `f7a9198` and `0fc6db7`; source at `0fc6db7` is byte-for-byte identical to the tested PR head `905230f`.
- [Final PR CI run 37651252038](https://github.com/timblazing/fillrate/actions/runs/37651252038) passed both `checks` and `npm`: optimizer lint/tests, generated contracts, lint/typecheck, real-worker Vitest, production build, hosted/local isolation checks, the standard browser suite and the native npm path. The optional live Valhalla road-geometry flow was skipped in CI because no provider was configured; the separate hosted-service/local equivalent-bundle evidence remains in [valhalla.md](valhalla.md).
- [Road-tooling integration CI run 37648163906](https://github.com/timblazing/fillrate/actions/runs/37648163906) also passed both jobs. The earlier keyboard-scroll failure and its bounded-wait fix remain recorded below. Current progress, handoff, completion plan, basemap decision and PR descriptions were reconciled; all original worktrees and uncommitted drafts are preserved.
- This is source integration and CI evidence. Manual accessibility and six-Block acceptance, broader performance evidence, final image publication/deployment, signed-in live road UI and native target timings remain open. M6/M8 planning estimates are 99%/87%; no release or deployment is claimed.

## 2026-10-07: Stabilize keyboard-scroll browser acceptance (Codex)
- After the integrated source passed full CI, the documentation-only merge onto squashed #82 produced the identical Git tree but [a later CI run](https://github.com/timblazing/fillrate/actions/runs/37650106992) failed the shipment table's immediate keyboard-scroll read. The runner had already confirmed the region was focused and scrollable.
- The smoke now waits up to two seconds for native ArrowRight scrolling to produce `scrollLeft > 0`, then retains the same assertion. This accommodates asynchronous scroll frames while still failing if keyboard scrolling does not work; product code is unchanged by this fix.
- `bun run test:browser --flow=lesson` passed locally against the production build with isolated synthetic data: both viewports, keyboard scrolling, pagination/selection, exports and 443 shipment sheets plus unshipped reasons (466 PDF pages). The local Python 2.7 PATH collision was resolved for this command by selecting Python 3.13 with a filtered PATH. `node --check scripts/test-browser.mjs` and `git diff --check` pass. Final head-commit CI remains the merge gate on PR #83.

## 2026-10-07: Integrate local work and reconcile current records (Codex)
- Integrated the recovery, hosted Valhalla and accessibility branches in PR order (#81, #82, #83), preserving the dated road/recovery/print evidence. Resolved the progress-document conflict introduced by the recovery squash merge; source changes merge together without conflict.
- Reconciled the current milestone checklist, status focus, completion plan, basemap reference, handoff and release gaps with the accepted keyless CARTO decision, completed local print/recovery acceptance and recorded VPS road-service evidence. Post-fix accessibility acceptance, final performance/copy work, a new image and deployment, signed-in hosted road UI and native target timings remain explicit gaps.
- Audited the existing local worktrees. Their leftover performance draft is superseded by the merged measured report, and the old uncommitted theme-toggle removal is already represented by the current shared header. Existing worktrees and local changes are retained.
- Local integration verification: `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run build` and `git diff --check` passed. Lint retains the existing `globe.tsx` hook-dependency warning. Fresh PR CI is required before merge; it includes optimizer/contracts, Vitest, production build, hosted/local checks and all browser flows. No image release or live deployment is performed by this integration.

## 2026-10-06: Public README and MIT license (Codex)
- Added MIT licensing and a product-focused README. Owner approved the copy and requested removal of all README screenshots and their copied assets before publication.
- Validation: README local links resolve and `git diff --check` passes. No runtime changes or milestone estimate changes; application checks were not rerun. Documentation-only paths do not trigger CI, and no workflows are dispatched.

Published-image baseline: `e95f3cb`; release evidence integrated on `main` at `4caa595` (#72), reviewed 2026-10-06. This is the current evidence/gap record; [completion-plan.md](completion-plan.md) owns delivery order, [frontend-spec.md](frontend-spec.md) owns dashboard acceptance, and [owner-actions.md](owner-actions.md) owns deployment/input actions. The complete pre-rewrite dated log and detailed checklists are preserved in [history/progress-through-2026-10-06.md](history/progress-through-2026-10-06.md). Historical undated next steps are superseded.

## 2026-10-06: Multi-architecture image release for `e95f3cb` (Codex)
- Dispatched [image workflow run 37482591185](https://github.com/timblazing/fillrate/actions/runs/37482591185) for `main` commit `e95f3cb6556a52b013d318caf2f4800329970051`. CI, npm, amd64 and arm64 builds, both architecture smoke tests and benchmarks, and manifest publication succeeded.
- Published `ghcr.io/timblazing/fillrate:sha-e95f3cb`, registry manifest digest `sha256:0b6eeac32bba5853c3d9190cc1b0bfc62c2e5edecfd29f9b213c11b84052322e`; `docker manifest inspect` confirmed the `linux/amd64` and `linux/arm64` entries. Full digest and platform digests are in `release-verification.md`.
- This records image publication only; it does not claim a deployment or target-hardware verification.

## 2026-10-06: Completion and launch documentation rewrite (Codex)
- Reconciled technical specification and handoff against merged routing features and current status. Removed stale draft/unbuilt claims and the obsolete direct-main brief. Stable spec section numbers and M1–M8 identifiers remain.
- Added a documentation index, completion/launch plan, frontend/dashboard acceptance specification and consolidated owner actions. Preserved prior evidence in history rather than deleting it.
- Owner removed design-file work from completion scope. CSS tokens and the running gallery are the design reference. Dashboard integration/performance is required M8 work; M2 review acceptance remains historical evidence.
- Source review confirms gallery Blocks and product views are separate compositions sharing some lab components. No visual parity or performance completion is claimed by this pass. Frontend measurements and browser evidence are required next.
- PR #72 completed the other session’s `e95f3cb` image publication record. Conflict resolution preserves its dated progress entry and release-verification file unchanged; publication is complete, deployment is not claimed.
- Planning estimates are revised for the expanded M8 scope; no new runtime behavior is claimed. Validation: the actual `parseProjectDocs` function parsed all eight spec/progress milestones and the new dated decision; new/current planning links resolve, status weights sum to 100, and `git diff --check` passes. Runtime lint/typecheck/build and browser suites were not rerun for this docs-only change.

## 2026-10-06: M8 dashboard audit and frontend baseline (Codex)
- Captured all six gallery Blocks and paired synthetic persisted product screens at 1440×900 and 393×852; recorded implementation paths, accepted mobile differences, remaining acceptance gaps and priorities in [m8-dashboard-coverage-audit-2026-10-06.md](reviews/m8-dashboard-coverage-audit-2026-10-06.md).
- Established warm local navigation and interaction baselines in [m8-frontend-performance-baseline-2026-10-06.md](reviews/m8-frontend-performance-baseline-2026-10-06.md). The 2,000-order lesson run completed with 443 shipments. Scenario pagination and shipment selection were under 50 ms; mounting/switching to the 443-row shipment pane measured 307.6–355.8 ms with repeated >200 ms main-thread tasks, so the proposed result-view budget fails on this baseline.
- Three 601-node matrix UI previews took 1,594.7–1,617.4 ms. The 1,001-node/9.8 MB API preview validated in 226 ms, but browser UI completion was not observed and remains an explicit measurement gap.
- Validation: `bun run build` and browser flows `lesson`, `import`, `experiment`, `matrix` passed on the task branch with isolated synthetic data. No runtime optimization or milestone completion is claimed; dashboard integration and final candidate gates remain open.

## 2026-10-06: M8 near-limit matrix preview profile (Codex)
- Profiled the real imported-matrix browser preview with a synthetic 1,001-node, 1,001,000-edge, 7,844,814-byte snapshot at 1440×900 and 393×852, three trials per viewport. Raw trial timings, preview-resource sizes, observed >50 ms main-thread tasks and paired screenshots are linked from [the frontend baseline follow-up](reviews/m8-frontend-performance-baseline-2026-10-06.md).
- Small improvement: preview/save send the bounded-size JSON text directly to the existing JSON endpoints, removing the browser's full `JSON.parse`/`JSON.stringify` pass. With the same task-overlap observer, desktop preview median changed 265.0→203.6 ms and click-to-paint 292.0→229.9 ms; phone preview changed 228.6→254.2 ms and click-to-paint 273.2→285.9 ms, so the phone sample showed no improvement. All directed edges validated and the API returned the same bounded sample. Three-trial local medians are observations, not p95 or physical-device evidence.
- `MATRIX_PERF_PROFILE=1 bun run test:browser --flow=matrix` passed the six profile trials and the existing preview/save/select, worker-leg, export and stale-coordinate-refusal flow against isolated temporary data. After refreshing the branch with #75, build, lint, typecheck and the matrix flow passed again; the new sample's desktop and phone preview medians were 211.8 and 207.2 ms. The separate [baseline record](reviews/m8-frontend-performance-baseline-2026-10-06.md) keeps both samples; three trials are directional, not p95 evidence. Lint retains the existing `globe.tsx` hook-dependency warning.
- This closes the 1,001-node browser-measurement gap only. It does not complete M8. Shipment-sheet print, pipeline recovery states, the rest of the six-Block/a11y/theme audit, basemap terms, final image/deployment evidence and native target timings remain explicit candidate/owner gates.

## 2026-10-06: M8 persisted shipment results responsiveness (Codex)
- Paginated the persisted 443-shipment table at 50 rows per page, retaining stable shipment selection, map-driven cluster filtering and keyboard-accessible table scrolling. The affected browser flow confirms global page 2, selection without a full-result refetch, and selection details retained across the selected cluster's page change.
- Repeated the 2,000-order synthetic result at 1440×900 and 393×852. Desktop Map → Shipments response: 44.6, 116.0, 112.6 ms (median 112.6); phone: 114.9, 139.6, 136.6 ms (median 136.6). Each view mounted 50 rows / 1,336 DOM nodes, down from 443 / 9,775. Three page-scroll actions produced no >200 ms long task; no task over 200 ms began during a measured tab click. Full results and method limits are in [the responsiveness review](reviews/m8-results-responsiveness-2026-10-06.md), with paired screenshots.
- Verification: `bun run test:browser --flow=lesson` passed on an isolated production build and generated synthetic data. `bun run lint` and `bun run typecheck` passed; lint retains one existing exhaustive-deps warning in `apps/web/src/components/ui/globe.tsx`. `bun run build` passed.
- This closes the shipment-table transition slice only. The 601-node matrix preview remains slow, while 1,001-node UI measurement is now recorded separately; shipment-sheet print and unshipped-reason acceptance, recovery states and other dashboard audit gaps remain open. M8 is not complete.

## 2026-10-06: M8 basemap provider and terms record (Codex)
- Inspected the shipped MapLibre defaults: CARTO Positron/Dark Matter style URLs and the enabled attribution control. Recorded CARTO's current key requirement, attribution, stated free-tier limits and commercial-plan pricing in [basemap.md](basemap.md), with links to the provider terms and attribution requirements.
- Changed current product and gallery map compositions to keep attribution expanded after map interaction. T3 preview inspection of both gallery map variants at 1440×900 and 393×852 confirmed visible CARTO/OpenStreetMap credits fit inside map bounds. The style-provided links still target older about pages, so exact link conformance remains open.
- The current URLs have no CARTO-issued API key, and the repository documents no key configuration. Public-use classification, capacity/cost and an owner-controlled hosted key therefore remain launch decisions; this record is not legal approval.
- No CARTO key was configured and no provider terms were accepted. M8 remains open pending the provider decision/configuration and exact attribution-link conformance, alongside shipment print, recovery, broader dashboard acceptance, final candidate release/deployment and native target timings.
- Verification: `bun install --frozen-lockfile`, `bun run lint`, `bun run typecheck`, `bun run build`, and `git diff --check` passed. Lint reports the existing `globe.tsx` exhaustive-deps warning. No production browser smoke suite was rerun for this slice; T3 preview inspected the two gallery map controls locally.

## 2026-10-07: M6 hosted Valhalla roads on the VPS (Claude Code)
- The owner chose hosted roads for v1 over Oklahoma and its bordering states. Tiles were built off-host (peak 13.6 GiB, 955 s; 3.84 GB archive) and copied to the VPS, where they are served by a capped Compose service (1 CPU, 2.5 GiB, no host port) beside the live app. Portable path: `deploy/valhalla/compose.serve.yaml`, `bundle.sh`, `region_check.py`, `prepare.sh env` on the serving host.
- Two defects found and fixed in deploy tooling before any hosted road job ran. At `max_matrix_distance` 1,000 km, CostMatrix returned null for 750–1,050 km truck legs, so the default is now 2,000 km. The 7-region `dataset_revision` exceeded Fillrate's 200-character limit, so every hosted job would have failed `valhalla_config_invalid`; `prepare.sh` now records a compact revision.
- Evidence (details in [valhalla.md](valhalla.md#hosted-deployment-evidence-2026-10-07-owner-vps)): the VPS region check passed (coverage in and out, complete 10 × 10 truck matrix in 8.8 s, route geometry, 25 × 25 block with 0 nulls in 48.7 s, peak 1.82 GiB, host load ≤1.10). `/api/health` reports the road identity, and the hosted worker accepts the configuration. `smoke_valhalla.py ok7` passed through a local Fillrate production stack on the byte-equivalent bundle (same graph hash), as did inspected-route geometry.
- Not claimed: a signed-in snapshot/run/geometry check on the live site (owner action). The image is unchanged (`b296645`, `sha256:607f0b45…`); this deployment changed only Compose services and environment, with a backup and the prior compose kept for rollback.
## 2026-10-06: M8 pipeline recovery states (Claude Code)
- Failed, cancelled and interrupted run pages now offer **Run again**, a new run of the same scenario version and settings; the earlier record is never changed. They also offer **Open scenario**, which loads that version and the run's settings in the workbench through `/scenarios?scenario=&version=&run=`. Failure alerts give the next action per code (`preflight_blocked`, `run_wall_limit`, stale travel matrix, other) plus the code and attempt count. An active run on attempt 2 or later says it is retrying after a worker stopped responding.
- New `recovery` browser flow: queued → cancelled → Run again → succeeded; worker-preflight failure → actionable alert → Run again refused separately → Open scenario. `cancel` and `warm-start` flows (shared rerun button) passed again. Queued/running/cancelled states remain covered by `cancel`, success by every run flow, and the retry banner is not browser-tested (it needs a worker crash mid-run).
- Verification: `bun run lint` (existing `globe.tsx` warning only), `bun run typecheck`, `bun run build`, `bun run test:browser --flow=recovery`, `--flow=cancel`, `--flow=warm-start` passed.
## 2026-10-06: M8 shipment-sheet print acceptance (Claude Code)
- Printing `/runs/<id>/sheet` no longer includes the app navigation rail or header. Printing all shipments appends every persisted unshipped line, grouped by shared reason labels, with its evidence. Each page names its run and shipment. Rows avoid page splits and table headers repeat. Wide sheet tables scroll inside labeled regions on phone.
- The 2,000-order lesson (443 shipments, 327 unshipped lines) printed to 466 PDF pages with no chrome, and a single shipment printed to one page. Evidence, before/after page images and limits: [m8-shipment-sheet-print-2026-10-06.md](reviews/m8-shipment-sheet-print-2026-10-06.md).
- Verification: `bun run lint` (existing `globe.tsx` warning only), `bun run typecheck`, `bun run build`, and `bun run test:browser --flow=lesson` passed with the new sheet assertions. Physical printing was not tested.

## 2026-10-07: M8 accessibility audit and fixes (Claude Code)
- axe WCAG 2.1 A/AA, overflow, reduced-motion and focus checks covered 13 pages × light/dark × desktop/phone ([audit](reviews/m8-accessibility-audit-2026-10-07.md)). Found inactive-tab and muted-text contrast below AA, three unnamed selects on `/runs`, an unnamed Timeline slider thumb and two unfocusable scrollable tables. There was no page overflow, no unreduced motion, and focus was visible on every checked control. The code changes address all recorded findings; the post-fix audit rerun was interrupted and remains open. Original verification: lint and typecheck; integration lint/typecheck/build also pass (see the integration entry and Next step).

## Milestones (spec §15)
- [x] **M1 Thin durable fulfillment slice**
  - [x] SQLite durable jobs, leased Python worker, real PyVRP pipeline, independent validation and persisted exports.
  - [x] CI and combined amd64/arm64 image have historical smoke evidence.
- [x] **M2 Accepted design**
  - [x] Round-two Blocks, run page and shipment sheet accepted 2026-10-01; shared wording, fill thresholds and preflight policy applied.
  - [x] Design-file work removed from completion scope 2026-10-06. Separate dashboard completion is required under M8.
- [x] **M3 Operational core**
  - [x] Imports, versioned/branched scenarios, conflicts, submission preflight, monetary objective, reuse/checkpoints and partial error plans.
  - [x] Synthetic 2,000-order performance has recorded solver evidence; this is not frontend responsiveness evidence.
- [x] **M4 Trustworthy experiments / first release**
  - [x] k explorer, bounded/ranked experiments and comparable cohorts.
  - [x] Accepted hosted/request release: owner sign-in, isolation/quotas, target image recovery and on-server backups; second live account waived.
- [x] **M5 Allocation and import depth**
  - [x] Five allocation strategies, whole-order/CP-SAT, provenance, geocoding/cache/ZIP fallback and coordinate review.
- [ ] **M6 Roads and advanced routing**
  - [x] Directed snapshots, pinned Valhalla local evidence, durable snapshot jobs and inspected road geometry.
  - [x] Time windows/service durations, saved manual baselines/warm starts and heterogeneous fulfillment fleet.
  - [x] Solver Lab dimensions, fleets, depots, reloads, optional visits, alternative groups and pickup-delivery pairs with validation.
  - [x] VPS Valhalla (OK + bordering states) deployed with coverage, resource and timing evidence (2026-10-07); owner's signed-in UI check passed 2026-10-07.
- [x] **M7 Learning and export depth**
  - [x] Fulfillment and advanced-feature lessons, pipeline/explorer replay, planned timeline/playback, GeoJSON and matrix exports.
- [ ] **M8 Verification and handoff**
  - [x] Recorded 21 production browser flows at desktop/phone and 144 hosted/local checks (prior sessions; not rerun by this documentation pass).
  - [x] Request-access/admin phone review, npm-compatible scripts, native documentation and handoff.
  - [x] Historical image target timings/recovery on the VPS; native timings only in a dev container.
  - [ ] Six-Block production coverage and dashboard integration acceptance; print and recovery fixes have local browser evidence, the 52-state post-fix accessibility rerun passes with manual contrast/gallery limits retained.
  - [ ] Measured 2,000-order and matrix frontend responsiveness/performance acceptance; the 443-shipment transition and 1,001-node preview are scoped observations only, with final candidate/cold and broader interaction measurements open.
  - [x] Basemap v1 decision and specified attribution links: owner accepts keyless CARTO risk; source/terms and light/dark rendered credit evidence are recorded in [basemap.md](basemap.md). Key/tier configuration remains a later owner follow-up.
  - [x] Current runtime image publication for `e95f3cb`: run 37482591185, both architecture smokes and manifest recorded in #72.
  - [x] Integrated source `f855f65` published (image workflow 37710953655, both architecture smokes) and deployed on Hostinger by digest on 2026-10-08 with backup, health, worker and anonymous access checks.
  - [x] Owner signed-in primary workflow and hosted road check on a deployed digest (`698fbd8`, #99; #91 and #92 closed).
  - [ ] Hosted road automation: automatic matrices, coverage blocking, default road geometry and truthful export labels ([#98](https://github.com/timblazing/fillrate/issues/98)).
  - [ ] Final dashboard image release and deployed-digest evidence.
  - [ ] Optional: native timings on the VPS for the full distribution handoff ([#93](https://github.com/timblazing/fillrate/issues/93)).

## Current state

The hosted first release is accepted, and the tested integrated source `f855f65` is deployed on Hostinger by digest (2026-10-08). M8 remains open on hosted road automation (#98), the remaining targeted dashboard states (#88) and representative frontend performance (#89). Current technical capabilities are determined by merged source and executable proofs; see dated history and the release record for scope and evidence.

Gallery Blocks use illustrative fixtures; product result screens use persisted runs. Shared components exist, but full composition/interaction parity and optimization require the frontend audit. No `.fig` work is needed.

## Known gaps

- Six-Block production integration and state acceptance remain open under [frontend-spec.md](frontend-spec.md); see [issue #88](https://github.com/timblazing/fillrate/issues/88). The 2,000-order and near-limit matrix evidence is scoped local browser data; representative 601-node, cold-load, broader interaction and tail-latency profiling remain open in [issue #89](https://github.com/timblazing/fillrate/issues/89). The displayed heatmap stays at its bounded 12×12 sample.
- The 443-shipment persisted results transition meets the proposed 200 ms response target in three warm local trials per viewport; the table pages 50 rows and selection does not fetch the full result. This does not close matrix, whole-dashboard, cold-load or target-device performance acceptance.
- Recovery states and shipment-sheet print have local browser acceptance (2026-10-06 entries); the worker-crash retry banner is not browser-tested.
- Accessibility is out of scope for the v1 demo (owner, 2026-10-07; #90 closed as not planned). The 52-state automated rerun stays as historical evidence in [the accessibility record](reviews/m8-accessibility-audit-2026-10-07.md).
- `f855f65` is deployed by digest; runtime changes merged after it (including the 2026-10-08 app shell/layout update) need a new tested image release and deployment before they are live.
- Hosted Valhalla covers OK/TX/NM/CO/KS/MO/AR only; stops outside it are unreachable on road snapshots. The owner's signed-in UI road check passed on 2026-10-07 ([#92](https://github.com/timblazing/fillrate/issues/92)); default road travel and geometry are tracked in [#98](https://github.com/timblazing/fillrate/issues/98). Matrix builds on the 1-CPU cap are slow for wide extents (a random 25 × 25 block across ~1,000 km took ~49 s).
- Keyless CARTO is the owner-accepted v1 configuration. The terms record and specified rendered credit links exist; no CARTO key, tier or use classification is claimed.
- Native timings on the VPS are missing ([issue #93](https://github.com/timblazing/fillrate/issues/93)). Historical image timings/recovery remain valid for their recorded digest only.
- Manual editing cannot move visits between clusters. Warm starts reuse only compatible cluster visit/demand/travel sets; saved manual baselines are now supported.
- Solver Lab supports advanced adapters but still uses JSON editing and estimated geographic travel/schematic display. Pickup-delivery pairs with reloads are refused. Generic Lab support does not imply business-pipeline support.
- Snapshot node identity/coordinate matching is exact; edited coordinates require a new snapshot. Large snapshots and replay bundles have substantial in-memory/transfer cost.
- Geocoding jobs run in the web process; restarts fail unfinished jobs, cached replies remain reusable. Census failures are explicit; ZIP fallback is approximate.
- Checkpoints from abandoned attempts can remain visible alongside final execution checkpoints. Matrix partition reuse is not implemented.
- Pre-2026-10-05 results may have unavailable timeline timing; schematic geometry and estimated durations must stay labeled. Road geometry is available only under the matching recorded Valhalla context.
- On-server daily backups have 30-day retention but no off-host copy. Per-IP quotas require a trusted proxy-only ingress/header configuration.
- Hosted cross-account isolation is automated-test evidence, not a two-live-account deployment check. That live check remains waived.
- Real sample rows are missing; monetary rates were N/A. Synthetic acceptance and trucks-then-miles can proceed.

## Waiting on the primary user (come back to this)

See [owner-actions.md](owner-actions.md). Deploy-by-digest is required for the final dashboard release; `f855f65` is the current deployed baseline. Native VPS timings (#93) are optional handoff evidence. Real samples, rates and off-host backups retain their explicit optional/deferred scope. No design-file action remains.

## Next step

[#98](https://github.com/timblazing/fillrate/issues/98) hosted road automation, then the remaining targeted [#88](https://github.com/timblazing/fillrate/issues/88) dashboard states and [#89](https://github.com/timblazing/fillrate/issues/89) representative performance. Publish and deploy the integrated candidate afterwards. [#93](https://github.com/timblazing/fillrate/issues/93) native timings are optional. See [completion-plan.md](completion-plan.md) for dependencies and exit evidence.
