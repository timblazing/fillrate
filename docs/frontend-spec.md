# Frontend and dashboard completion specification

This extends technical spec §§4, 10, 11 and 16. It is required M8 completion work, after the accepted M2 design direction. The authenticated planning dashboard/workbench is the priority. `/dev` is a project-progress page; `/dev/components` is the design-system reference.

## Current evidence and scope

The v1 demo prioritizes persisted workflow defects (#88), automatic hosted roads (#98), then representative performance (#89). Manual accessibility/VoiceOver and physical-device acceptance are outside owner scope; preserve accessible primitives and existing automated checks. Hosted-road requirements in technical spec Current v1 demo scope supersede the old manual matrix/geometry interaction once #98 lands.

Source inspection on `e95f3cb` shows six gallery Blocks in `apps/web/src/app/dev/components/sections/blocks.tsx`. Production screens are separate compositions: `scenario-workbench.tsx`, `run-view.tsx`, explorer and experiment views. Both gallery and product use shared `components/lab` pieces, but imports alone do not prove visual or interaction parity. Gallery Block text still describes pre-M3 design candidates; it must become a current reference during implementation. This documentation pass did not visually audit those screens or measure browser performance.

Use the accepted hierarchy and interactions, adapted to real persisted data and current capabilities. Do not force every gallery component onto every screen. Reuse shared production composites where behavior is the same; keep fixture adapters in the gallery. Production modules must not depend on gallery fixtures or simulated solver outputs. Maintain coss/Base UI composition, CSS tokens, mapcn and existing accessible parts. CSS and the running gallery are authoritative; no `.fig` export or OpenPencil work is required.

## Required coverage audit

Before changes, capture each production target and its matching Block at desktop 1440×900 and phone 393×852, with synthetic persisted data. Record an implementation path, observed differences, required fixes, intentionally accepted differences and before/after evidence for every row. No row is complete solely because a component exists.

| Reference Block | Product target | Required outcome |
| --- | --- | --- |
| Orders & inventory | `/scenarios`, selected scenario data review | Stock versus demand, shortages and order lines; coordinate provenance/problems; edit, save, conflict and import errors are actionable |
| Run pipeline | Scenario configuration/submission and active `/runs/<id>` | Resolved settings with source/units, blocking preflight, one pipeline action, actual stages, cancel and retry/recovery states |
| Workbench | Scenario editing and run map/inspector | Map, cluster, truck and line selection share stable IDs; table alternative, useful panel sizing, narrow-screen tabs/drawers |
| Results | `/runs/<id>` and `/runs/<id>/sheet` | Revenue-first metrics, map-first inspection, cluster → shipments → lines, fill bands, unshipped reasons, validation/travel basis, printable persisted shipment sheet |
| k explorer | `/explore/<id>` and its scenario entry point | Real diagnostics, chart/table selection, stability/confidence, explicit k selection and replay export |
| Iteration comparison | `/experiments`, `/experiments/<id>` | Bounded preview, changed settings, comparable cohorts, Best option / 2nd best / 3rd, metric deltas, actionable failures and cancellation where supported |

Also inspect the application shell, scenario/run lists, Learn navigation and Labs for consistent spacing, typography, loading/error states and navigation. Keep advanced routing controls within supported capability boundaries; this pass does not require a new generic visual Solver Lab editor.

## Functional and visual acceptance

- A fresh approved account can import synthetic orders/inventory, resolve data problems, save a scenario, run it, inspect each shipment/unshipped reason, branch an assumption, compare and export without a dead end. Anonymous and pending navigation follows the accepted access policy.
- Loading, empty, invalid, queued, running, failed, cancelled and succeeded states have distinct useful feedback. Controls perform persisted actions or clearly explain unavailable capabilities; no toast-only substitutes.
- Selection survives relevant tab/filter changes or is explicitly cleared. Labels, travel basis, money/feet/time units, fill thresholds and warnings use shared definitions. New runs do not mutate prior results.
- Desktop supports the primary editing workflow; phone supports navigation and inspection without page-wide overflow. Wide tables may scroll within a labeled region. Menus/dialogs remain reachable, and keyboard focus is visible and restored.
- Maps have table equivalents; charts have readable values; status/route colors are not the only signal. Check light/dark themes and reduced motion. Shipment sheets print without navigation/chrome clipping.
- Reviewed differences from the accepted Block intent are recorded in the coverage audit. Owner approval of intentional product changes is separate from routine spacing/composition fixes.

## Performance acceptance

Measure before optimizing. Use the synthetic 2,000-order workload and both a typical and near-limit matrix. Record commit/build, browser/viewport, hardware, dataset sizes, warm/cold state and at least three runs. Solver time and frontend responsiveness are separate measurements.

Proposed engineering budgets for this completion pass: on the recorded desktop test machine, p95 response to a filter, row or map selection is at most 200 ms; selection does not trigger a full result/matrix download; no repeated main-thread task over 200 ms occurs during steady scrolling. Report phone results separately. If the workload cannot meet a budget, document the measured cause and a reviewable revised budget before closing the gate. These targets are not claimed current results.

Profile render count, mounted rows/cells, initial JS, network transfer and interaction traces. Page/virtualize large tables and heatmaps when measurements justify it; do not render a 1,000×1,000 matrix as a million interactive DOM cells. Use GeoJSON layers for bulk map objects. Load maps/heavy charts only where needed; avoid duplicate fetches, unnecessary polling after terminal jobs, recomputing unchanged artifacts, and hidden tab work. Split large components along stable data/interaction boundaries when it improves measured behavior. No framework or state-library rewrite is assumed.

## Exit evidence

Commit the coverage audit and before/after captures, measured performance results and remaining intentional limits. Run lint, typecheck and production build; relevant persistence/contract/worker tests for behavior changes; production browser flows for the affected paths; hosted access regression checks if authorization or navigation changes. UI evidence uses isolated synthetic data. Record verification commands and results in progress; retain the exact artifacts. The current gallery and real dashboard must both reflect the final composition. Frontend completion requires all required rows and measured budgets, not a screenshot-only signoff.
