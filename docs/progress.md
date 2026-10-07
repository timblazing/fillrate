# Progress

## 2026-10-07: Repeatable post-fix accessibility and candidate timings (Codex)
- Production candidate `f01687b` passed the retained 52-state accessibility rerun: 13 page states × light/dark × desktop/phone, zero automated WCAG A/AA violations/overflow/unreduced infinite motion and zero sampled focus failures (1,092 samples). [Audit and captures](reviews/m8-accessibility-audit-2026-10-07.md) retain axe incomplete contrast cases and screen-reader/gallery/physical-device limits.
- Fixed newly observed route/cluster swatch label contrast with paired foreground tokens and replaced an unsupported page-counter accessible-name attribute with actual screen-reader text. Landing travel copy now names hosted OK/TX/NM/CO/KS/MO/AR coverage and outside-coverage behavior; gallery descriptions now identify reference fixtures and simulated stages rather than pre-M3 candidates.
- [Candidate performance](reviews/m8-candidate-performance-2026-10-07.md): three warm 2,000-order/443-shipment trials per viewport (47.1–98.1 ms desktop, 113.2–141.5 ms phone). Near-limit 1,001-node preview paint: 205.9–237.4 ms desktop, 220.3–230.2 ms phone. Results pagination/selection/keyboard scrolling/export/print, comparison/explorer and matrix save/run/directed legs/stale refusal passed. These are scoped local observations, not meaningful p95, cold-load or full frontend acceptance.
- Lint/typecheck/build and 144/144 hosted/local checks pass; lint retains the existing HeroGlobe hook dependency warning. `--flow=accessibility` is a separate explicit acceptance command, with synthetic temporary data and no live credentials. Source publication, full candidate CI, final frontend image/deployment, broader six-Block/performance acceptance and owner target/live-road UI evidence remain open.

## 2026-10-07: Clean PR integration and final source CI (Codex)
- Recovery [#81](https://github.com/timblazing/fillrate/pull/81), hosted-road [#82](https://github.com/timblazing/fillrate/pull/82) and accessibility [#83](https://github.com/timblazing/fillrate/pull/83) are squash-merged. Integration commits are `b96694b`, `f7a9198` and `0fc6db7`; source at `0fc6db7` is byte-for-byte identical to the tested PR head `905230f`.
- [Final PR CI run 37651252038](https://github.com/timblazing/fillrate/actions/runs/37651252038) passed both `checks` and `npm`: optimizer lint/tests, generated contracts, lint/typecheck, real-worker Vitest, production build, hosted/local isolation checks, the standard browser suite and the native npm path. The optional live Valhalla road-geometry flow was skipped in CI because no provider was configured; the separate hosted-service/local equivalent-bundle evidence remains in [valhalla.md](valhalla.md).
- [Road-tooling integration CI run 37648163906](https://github.com/timblazing/fillrate/actions/runs/37648163906) also passed both jobs. The earlier keyboard-scroll failure and its bounded-wait fix remain recorded below. Current progress, handoff, completion plan, basemap decision and PR descriptions were reconciled; all original worktrees and uncommitted drafts are preserved.
- This is source integration and CI evidence. Post-fix accessibility audit acceptance, final performance/copy work, final image publication/deployment, signed-in live road UI and native target timings remain open. M6/M8 estimates stay at 99%/86%; no release or deployment is claimed.

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
  - [x] VPS Valhalla (OK + bordering states) deployed with coverage, resource and timing evidence (2026-10-07); owner's signed-in UI check open.
- [x] **M7 Learning and export depth**
  - [x] Fulfillment and advanced-feature lessons, pipeline/explorer replay, planned timeline/playback, GeoJSON and matrix exports.
- [ ] **M8 Verification and handoff**
  - [x] Recorded 21 production browser flows at desktop/phone and 144 hosted/local checks (prior sessions; not rerun by this documentation pass).
  - [x] Request-access/admin phone review, npm-compatible scripts, native documentation and handoff.
  - [x] Historical image target timings/recovery on VPS/Pi; native timings only in a dev container.
  - [ ] Six-Block production coverage and dashboard integration acceptance; print and recovery fixes have local browser evidence, the 52-state post-fix accessibility rerun passes with manual contrast/screen-reader/gallery limits retained.
  - [ ] Measured 2,000-order and matrix frontend responsiveness/performance acceptance; the 443-shipment transition and 1,001-node preview are scoped observations only, with final candidate/cold and broader interaction measurements open.
  - [x] Basemap v1 decision and specified attribution links: owner accepts keyless CARTO risk; source/terms and light/dark rendered credit evidence are recorded in [basemap.md](basemap.md). Key/tier configuration remains a later owner follow-up.
  - [x] Current runtime image publication for `e95f3cb`: run 37482591185, both architecture smokes and manifest recorded in #72.
  - [ ] Final dashboard image release and deployed-digest evidence.
  - [ ] Native target timings on VPS/Pi for full distribution handoff.

## Current state

The hosted first release is accepted, while latest source includes later routing and learning work. Current technical capabilities are determined by merged source and executable proofs, not the older release snapshot. See technical references and the dated history for per-feature tests. PR #72 records publication for `e95f3cb`; deployment remains unverified by these records.

Gallery Blocks use illustrative fixtures; product result screens use persisted runs. Shared components exist, but full composition/interaction parity and optimization require the frontend audit. No `.fig` work is needed.

## Known gaps

- Dashboard coverage, responsive/accessibility review and measured frontend performance remain open under frontend-spec.md. The near-limit matrix path has before/after local browser evidence; desktop improved in three trials, while the phone sample did not, so repeat candidate trials remain useful. The displayed heatmap stays at its bounded 12×12 sample.
- The 443-shipment persisted results transition meets the proposed 200 ms response target in three warm local trials per viewport; the table pages 50 rows and selection does not fetch the full result. This does not close matrix, whole-dashboard, cold-load or target-device performance acceptance.
- Recovery states and shipment-sheet print have local browser acceptance (2026-10-06 entries); the worker-crash retry banner is not browser-tested.
- The 52-state post-fix axe/focus/theme/reduced-motion rerun passes; manual contrast-incomplete cases, VoiceOver, physical-device and gallery checks remain in [the accessibility record](reviews/m8-accessibility-audit-2026-10-07.md). Six-Block integration acceptance remains open.
- The `e95f3cb` image is published (PR #72); deployment is separately owned by the user and is not inferred from a successful image workflow. Dashboard runtime changes still need a later image release.
- Hosted Valhalla covers OK/TX/NM/CO/KS/MO/AR only; stops outside it are unreachable on road snapshots. The live signed-in UI road check is pending. Matrix builds on the 1-CPU cap are slow for wide extents (a random 25 × 25 block across ~1,000 km took ~49 s).
- Keyless CARTO is the owner-accepted v1 configuration. The terms record and specified rendered credit links exist; no CARTO key, tier or use classification is claimed.
- Native timings on VPS/Pi are missing. Historical image timings/recovery remain valid for their recorded digest only.
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

See [owner-actions.md](owner-actions.md). Deploy-by-digest is required for the final dashboard upgrade; VPS Valhalla service/coverage/timing evidence exists, with the owner’s signed-in road UI check still open; native target timings close the broader handoff. Real samples, rates and off-host backups retain their explicit optional/deferred scope. No design-file action remains.

## Next step

Finish remaining six-Block state acceptance and manual accessibility review, then representative 601-node, cold-load and broader interaction performance trials. The post-fix 52-state rerun, scoped 2,000-order/1,001-node timings and hosted-road/gallery reference copy are recorded, with local-measurement limits. Then publish the final tested runtime image and record owner deployment by digest, health/workflow checks and the signed-in hosted road check. Native VPS/Pi timings complete the broader handoff. See [completion-plan.md](completion-plan.md) for dependencies and exit evidence.
