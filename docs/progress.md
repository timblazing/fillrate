# Progress

Runtime baseline: `e95f3cb`; release evidence integrated on `main` at `4caa595` (#72), reviewed 2026-10-06. This is the current evidence/gap record; [completion-plan.md](completion-plan.md) owns delivery order, [frontend-spec.md](frontend-spec.md) owns dashboard acceptance, and [owner-actions.md](owner-actions.md) owns deployment/input actions. The complete pre-rewrite dated log and detailed checklists are preserved in [history/progress-through-2026-10-06.md](history/progress-through-2026-10-06.md). Historical undated next steps are superseded.

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
- `MATRIX_PERF_PROFILE=1 bun run test:browser --flow=matrix` passed the six profile trials and the existing preview/save/select, worker-leg, export and stale-coordinate-refusal flow against isolated temporary data. `bun run build`, `bun run lint`, and `bun run typecheck` passed; lint retains the existing `globe.tsx` hook-dependency warning.
- This closes the 1,001-node browser-measurement gap only. It does not complete M8. The separate 2,000-order shipment-view response budget remains open (PR #75 is still open); shipment-sheet print, pipeline recovery states, the rest of the six-Block/a11y/theme audit, basemap terms, final image/deployment evidence and native target timings remain explicit candidate/owner gates.

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
  - [ ] Owner VPS Valhalla deployment, coverage/resources and timings; conditional for hosted road-enabled launch.
- [x] **M7 Learning and export depth**
  - [x] Fulfillment and advanced-feature lessons, pipeline/explorer replay, planned timeline/playback, GeoJSON and matrix exports.
- [ ] **M8 Verification and handoff**
  - [x] Recorded 21 production browser flows at desktop/phone and 144 hosted/local checks (prior sessions; not rerun by this documentation pass).
  - [x] Request-access/admin phone review, npm-compatible scripts, native documentation and handoff.
  - [x] Historical image target timings/recovery on VPS/Pi; native timings only in a dev container.
  - [ ] Six-Block production coverage audit and dashboard integration acceptance.
  - [ ] Measured 2,000-order and matrix frontend responsiveness/performance acceptance.
  - [ ] Basemap public-use terms/attribution record and final candidate verification.
  - [x] Current runtime image publication for `e95f3cb`: run 37482591185, both architecture smokes and manifest recorded in #72.
  - [ ] Final dashboard image release and deployed-digest evidence.
  - [ ] Native target timings on VPS/Pi for full distribution handoff.

## Current state

The hosted first release is accepted, while latest source includes later routing and learning work. Current technical capabilities are determined by merged source and executable proofs, not the older release snapshot. See technical references and the dated history for per-feature tests. PR #72 records publication for `e95f3cb`; deployment remains unverified by these records.

Gallery Blocks use illustrative fixtures; product result screens use persisted runs. Shared components exist, but full composition/interaction parity and optimization require the frontend audit. No `.fig` work is needed.

## Known gaps

- Dashboard coverage, responsive/accessibility review and measured frontend performance remain open under frontend-spec.md. The near-limit matrix path has before/after local browser evidence; desktop improved in three trials, while the phone sample did not, so repeat candidate trials remain useful. The displayed heatmap stays at its bounded 12×12 sample.
- The 2,000-order result responsiveness gate remains open.
- Shipment-sheet print output and queued/running/failed/cancelled/retry recovery states have not passed the production candidate audit.
- The `e95f3cb` image is published (PR #72); deployment is separately owned by the user and is not inferred from a successful image workflow. Dashboard runtime changes still need a later image release.
- VPS Valhalla coverage/timings are absent. Local pinned/provider/geometry evidence is distinct from hosted evidence.
- Basemap public-use/provider terms record referenced by the spec is missing; create it after inspecting the shipped configuration.
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

See [owner-actions.md](owner-actions.md). Deploy-by-digest is required for live upgrade; VPS Valhalla evidence is conditional on hosted road support; native target timings close the broader handoff. Real samples, rates and off-host backups retain their explicit optional/deferred scope. No design-file action remains.

## Next step

Implement the highest-impact dashboard fixes from the [coverage audit](reviews/m8-dashboard-coverage-audit-2026-10-06.md), starting with the 443-row result-tab responsiveness issue; then complete missing sheet, recovery-state, accessibility and near-limit matrix UI acceptance. The current image publication is complete in #72; owner deployment remains separate. See [completion-plan.md](completion-plan.md) for dependencies and exit evidence.
