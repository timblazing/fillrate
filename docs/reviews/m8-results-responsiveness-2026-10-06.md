# M8 persisted shipment results responsiveness — 2026-10-06

Focused before/after evidence for the 443-shipment bottleneck in the [M8 frontend performance baseline](m8-frontend-performance-baseline-2026-10-06.md). This closes only the large shipment-table transition slice; it is not M8 completion or full frontend performance acceptance.

Implementation source: commit `24bfaee` (based on `281b16e`). Production build: `bun run build` passed for this source.

## Workload and method

- Synthetic `examples/lesson-fulfillment.json`: 2,000 orders, 600 locations, 640 accounts and 2,829 lines; persisted run `2162f2c3` contained 443 shipments. The browser flow created the run in an isolated temporary database and checked the persisted JSON export.
- Browser: Chrome for Testing 154.0.8037.92, agent-browser 0.37.1. Viewports: 1440×900 and 393×852. Hardware: Apple M1 Pro, 32 GB RAM, macOS 27.0.
- Warm local production build; solver time excluded. The initial documented baseline used four desktop Map → Shipments trials and recorded 307.6, 355.8, 339.5 and 338.7 ms with 443 rows / 9,775 DOM nodes. A local three-trial retake immediately before the change measured 335.9, 299.9 and 292.5 ms on desktop; phone measured 369.1, 392.3 and 433.5 ms.
- After measurements use three accessible tab-click trials per viewport. Response is click input delay from Event Timing plus event-to-two-animation-frame time. Task offsets are relative to click event start. Page row count is the largest mounted table body; DOM count is `document.getElementsByTagName('*').length`. Long-task observation is collected during the tab transition and separately over three page scroll actions. Three samples describe this local run; they are not a stable p95 estimate or field data.
- The local pre-change retake starts its two-frame timer immediately before a DOM tab click. The post-change trial uses the accessible tab control and adds Event Timing input delay, so the post response includes input dispatch delay and is a conservative comparison against that retake.

## Results

| Viewport | Before Map → Shipments (3-trial retake) | After Map → Shipments | Mounted rows / DOM nodes after | Long tasks after click / steady scroll |
| --- | --- | --- | --- | --- |
| 1440×900 | 335.9, 299.9, 292.5 ms; median 299.9 ms | 44.6, 116.0, 112.6 ms; median 112.6 ms | 50 / 1,336 (before 443 / 9,775) | No task over 200 ms after click; maximum recorded was 71 ms. Scroll: none. |
| 393×852 | 369.1, 392.3, 433.5 ms; median 392.3 ms | 114.9, 139.6, 136.6 ms; median 136.6 ms | 50 / 1,336 (before 443 / 9,775) | No task over 200 ms after click; maximum recorded was 93 ms. Scroll: none. |

The post-change desktop and phone trial ranges are 44.6–116.0 ms and 114.9–139.6 ms. DOM nodes fell by about 86%. The table shows a labeled “Showing … of … shipments” status and Previous / Next controls; page navigation does not change the selected shipment details. The scroll container is keyboard-focusable, labeled and horizontally scrolls with ArrowRight on phone. Selecting Shipment 1 retains the existing 68-shipment cluster filter. The measured full-result API request count remained 0 → 0 on selection.

No recorded long task over 200 ms started during the measured post-change transitions. The dedicated three-scroll check recorded no long tasks. This is local warm evidence only.

## Captures

The prior audit's [desktop](assets/m8-dashboard-audit/production/run-2k-shipments-1440.png) and [phone](assets/m8-dashboard-audit/production/run-2k-shipments-393.png) screenshots show the unpaginated baseline. After captures show page one and the viewport framing:

- Desktop 1440×900: [full page](assets/m8-dashboard-audit/after-responsive/run-2k-shipments-1440x900.png), [viewport](assets/m8-dashboard-audit/after-responsive/run-2k-shipments-viewport-1440x900.png).
- Phone 393×852: [full page](assets/m8-dashboard-audit/after-responsive/run-2k-shipments-393x852.png), [viewport](assets/m8-dashboard-audit/after-responsive/run-2k-shipments-viewport-393x852.png).

## Remaining acceptance gaps

- The 601-node matrix UI still takes about 1.6 seconds; the 1,001-node browser UI timing was not established. No matrix optimization or matrix performance pass is claimed.
- Shipment-sheet print output and the complete unshipped-reason view still need production acceptance, including print layout.
- Queued/running/failed/cancelled/retry recovery states, keyboard/focus behavior outside this table, reduced motion, light/dark coverage and the remaining dashboard integration audit stay open.
- The final candidate release, deployment evidence, basemap terms and native VPS timings remain separate M8 gates.
