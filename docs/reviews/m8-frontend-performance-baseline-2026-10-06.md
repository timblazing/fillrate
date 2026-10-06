# M8 frontend performance baseline — 2026-10-06

This is a pre-optimization local baseline for source `07545d0441353c69a6ed43978c25389f4ec323ea` (production build), not a final acceptance claim. Synthetic data only. The 2,000-order scenario came from `examples/lesson-fulfillment.json`, imported and run in an isolated local database. It contains 2,000 orders, 600 locations, 640 accounts and 2,829 lines; the persisted result contains 443 shipments. The representative matrix was built from those exact 600 locations plus depot (601 nodes). The near-limit payload had 1,001 nodes, the current accepted maximum.

## Environment and method

- Hardware/OS: Apple M1 Pro, 32 GB RAM, macOS 27.0.
- Browser: Chrome for Testing 154.0.8037.92; agent-browser 0.37.1.
- Viewports: desktop 1440×900 and phone 393×852. The local service, browser, and synthetic data were on the same machine.
- State: local production build, warm machine/browser environment, local app and worker; no cold-cache isolation or target phone hardware. Solver execution time is excluded from frontend timings.
- `bun run build` passed. `bun run test:browser --flow=lesson` passed for the persisted 2,000-order run. The matrix preview was measured as an interactive local UI path and API validation was separately timed.
- Vitals: three full warm navigations per viewport. Interaction: click-to-two-animation-frame samples, mounted DOM/node counts and `PerformanceObserver` long tasks. Matrix UI timings include file input, client handling, API request/validation and preview paint. The near-limit API-only timing does not stand in for a UI measurement.

## Initial navigation

| Viewport | Warm FCP/LCP samples | TTFB samples | CLS | INP |
| --- | --- | --- | --- | --- |
| 1440×900 | 104, 96, 100 ms | 32.1, 31.7, 32.5 ms | 0 | Not measured; no qualifying interaction in navigation trials |
| 393×852 | 100, 104, 116 ms | 28.7, 28.4, 29.1 ms | 0 | Not measured; no qualifying interaction in navigation trials |

These are warm local route-navigation observations, not field/Core Web Vitals or cold-start results. Three samples are too few for a stable statistical p95 estimate; the interaction section reports samples/ranges and whether they meet the proposed response budget.

## Interaction and render observations

| Workload / action | Samples | Mounted/render evidence | Result |
| --- | --- | --- | --- |
| 2,000-order scenario table, initial page | — | 25 order rows mounted; 836 DOM nodes; document width equaled viewport at desktop and phone | No page-wide horizontal overflow observed. Pagination to next page: 31, 33.8, 24 ms click-to-two-RAF; within the proposed 200 ms response budget. |
| 443-shipment result, Map → Shipments tab | 307.6, 355.8, 339.5, 338.7 ms (four samples) | 443 rows mounted; 9,775 DOM nodes | Range 307.6–355.8 ms; median 339.1 ms. **Exceeds proposed ≤200 ms budget.** Long tasks observed repeatedly above 200 ms: 265, 213, 345, 261, 346, 270, 338, 260 ms. This is the clearest current bottleneck and a first optimization candidate. |
| 443-shipment result, Map ↔ Shipments | Map transitions: 402.8, 401.5, 393.4 ms; Shipment transitions: included above | Same full shipment list was mounted when Shipments was selected | Map transitions also exceed 200 ms. Switching to the map initiated 21 resource requests in the recorded run (consistent with map/style/tile loading); do not characterize all tab switches as zero-network. |
| Shipment selection within the result | 49.2, 26.5, 21.6, 29, 30 ms | After one selected shipment, view showed 68 associated rows and 1,770 DOM nodes | 21.6–49.2 ms; within budget. A recorded row selection caused no new resource request. |
| 601-node matrix preview | 1,617.4, 1,594.7, 1,596.7 ms end-to-end | 1,030 DOM nodes; 144 heatmap cells (12×12 sample) | Stable ~1.6 s preview. Preview button-to-two-RAF: 60.4, 59.4, 57.5 ms. No >50 ms long task in those three preview trials. UI displays the full 3.54 MB input text; response sample remains bounded. |
| 1,001-node matrix, preview API | 226 ms for a 9,796,600-byte synthetic request; HTTP 200, 1,001,000/1,001,000 directed edges | API returned a 48,191-byte sample response | Server validation/preview is fast in this local trial. **Browser UI timing is not established:** after directly clicking Preview in the browser, automation did not receive a completion observation. The earlier accessible-button lookup stalled before click confirmation. Record as a client/browser-path measurement gap, not as an app latency result. |

## Gate assessment and next work

- Shipment-tab and map-tab transitions miss the proposed 200 ms target and repeatedly create >200 ms main-thread tasks. Profile the `run-view` shipment table/tab path first; consider row virtualization/pagination or deferred mounting, then repeat the same captures and interaction measurements.
- Shipment row selection and scenario pagination are within the proposed response budget in these local samples. They do not cover map marker selection or every filter.
- The 601-node preview meets the no-long-task observation, but takes ~1.6 seconds end-to-end. The 1,001-node UI path still needs a valid browser measurement. Do not claim the matrix gate passes.
- No optimization has been implemented in this slice. These measurements do not establish final performance, real device performance, cold-load bundle/network cost, long-session behavior or a statistically reliable p95.
- Repeat with at least three trials after implementation, including phone interaction measurements and near-limit UI preview. Add production component render counts and bundle/network-transfer profiling to candidate verification; current DOM/long-task readings are targeted observations rather than a complete profile.

## Captures

Product screenshots are in [`assets/m8-dashboard-audit/production/`](assets/m8-dashboard-audit/production/). The audit record explains each paired screen and the corresponding gallery Block.

## 1,001-node browser follow-up — 2026-10-06

Measured the complete imported-matrix preview on the M8 task branch, before and after sending the existing JSON text directly to the preview/save endpoints. The original app source was `281b16e` (`origin/main`); the follow-up adds no new API contract. Hardware, Chrome, warm production build and viewports match the environment above. The synthetic matrix has 1,001 nodes, 1,001,000 directed edges and a 7,844,814-byte JSON payload. Each viewport has three preview trials. Preview time is click to the visible valid-snapshot summary; click-to-paint adds two animation frames. `PerformanceObserver` records browser long tasks (>50 ms), and Resource Timing records the preview response.

| Viewport | Preview median, before → after | Click-to-paint median, before → after | Preview response median, before → after | Main-thread tasks during preview (>50 ms) |
| --- | --- | --- | --- | --- |
| 1440×900 | 265.0 → 203.6 ms (−23.2%) | 292.0 → 229.9 ms (−21.3%) | 216.9 → 177.9 ms | Before: 73, 55 ms. After: 61, 62, 62 ms. |
| 393×852 (iPhone 16 profile) | 228.6 → 254.2 ms (+11.2%, slower in this sample) | 273.2 → 285.9 ms (+4.6%) | 173.6 → 187.9 ms | Before: 62, 108, 63, 59 ms. After: 67, 73, 71 ms. |

The response remained 43,983 encoded bytes with a bounded 12×12 heatmap sample; all 1,001,000 directed edges validated. The desktop samples improved after removing the browser's full-matrix `JSON.parse` and `JSON.stringify`; the phone samples did not show an improvement, so no cross-viewport performance win is claimed. All observed preview tasks were below 200 ms, but these three-sample local results are not stable p95s and the phone variance warrants more candidate trials. The profile measures preview interaction, not steady scrolling, cold-cache behavior, remote transfer or physical-phone performance, and does not close the separate 2,000-order result-table budget.

Raw trials and captures: [before profile](assets/m8-matrix-profile-before-2026-10-06.json), [after profile](assets/m8-matrix-profile-after-2026-10-06.json), [desktop before](assets/m8-matrix-preview/before/matrix-1001-1440.png), [desktop after](assets/m8-matrix-preview/after/matrix-1001-1440.png), [phone before](assets/m8-matrix-preview/before/matrix-1001-393.png), [phone after](assets/m8-matrix-preview/after/matrix-1001-393.png). Reproduce with `MATRIX_PERF_PROFILE=1 MATRIX_PROFILE_OUT=<report.json> MATRIX_PROFILE_SHOTS=<capture-dir> UV_PYTHON=<python-3.13-path> bun run test:browser --flow=matrix` on the task branch. The profile runner uses the same synthetic data and records three trials at both viewports before the existing matrix save/run/export checks continue.

## Refreshed branch verification — 2026-10-06

After merging the persisted-results slice, `MATRIX_PERF_PROFILE=1 bun run test:browser --flow=matrix` passed again on refreshed commit `69c08ed`, along with build, lint and typecheck. The six 1,001-node preview trials measured desktop preview/click-to-paint at 236.9/256.1, 211.8/232.1 and 208.3/223.0 ms; phone at 208.3/234.0, 207.2/238.4 and 189.1/216.2 ms. Medians were 211.8/232.1 ms desktop and 207.2/234.0 ms phone. This sample improved on the previous phone medians, but remains a three-trial local measurement rather than stable tail latency or physical-device evidence. The flow continued through all directed-edge validation, matrix save/select, worker-leg checks, export and stale-coordinate refusal.
