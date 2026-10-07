# M8 accessibility audit — 2026-10-07

Method: a local production build of `main` plus the then-open #79–#81, with isolated synthetic data (the 2,000-order lesson run, an allocation sweep, a k-explorer job). Browser: agent-browser 0.37.1 headless. axe-core 4.13.0 (the workspace's installed copy) was injected per page with the WCAG 2.0/2.1 A and AA rule tags. Each of 13 pages (landing, scenarios, runs, run Map/Shipments/Unshipped/Timeline tabs, shipment sheet, experiments list and detail, k explorer, fulfillment lesson, labs) was checked in light and dark themes, at 1440×900 and iPhone 16 393×852, with reduced motion on. Each pass also checked page-level horizontal overflow, running infinite animations under reduced motion, and visible focus on the first 25 focusable controls. The harness was a local evidence script (not committed); its outputs were kept outside the repository.

## Before fixes

| Finding | Where | Cause |
| --- | --- | --- |
| color-contrast (serious): 2.67:1 | All run-page tabs, both themes | coss `TabsList` default variant renders inactive tabs at `muted-foreground/72` on `bg-muted` |
| color-contrast (serious): 4.34:1 | k explorer muted label on `bg-muted` | light `--muted-foreground` (oklch 0.556) on `--muted` |
| button-name (critical) ×3 | `/runs` new-run selects | `SelectTrigger`s beside unassociated visible labels |
| label (critical) | Run Timeline cursor | coss `Slider` put `aria-label` on the root, not the focusable thumb input |
| scrollable-region-focusable (serious) | Unshipped table and lesson product table at 393 px | overflowing table container not keyboard-reachable |

No page had page-level horizontal overflow in any pass. No infinite animation ran under reduced motion. Every checked control showed a visible focus change. Landing, scenarios, sheet, experiments, experiment detail, labs and learn had no axe violations.

## Fixes (PR "M8: fix WCAG AA contrast…")

- Light `--muted-foreground` is now oklch 0.51 (≈5.3:1 on `--muted`, ≈5.7:1 on `--background`). Dark tokens were already above 4.5:1.
- coss `tabs.tsx` default variant uses full-strength `text-muted-foreground`, and coss `slider.tsx` forwards `aria-label` to each thumb. Both are minimal vendored edits, marked in the files.
- The `/runs` selects are named Clusters, Solver seed and Around. The Unshipped and lesson product tables render as labeled, focusable regions through `Table`'s `render` prop.

## Original verification boundary (before the rerun below)

The post-fix audit rerun was interrupted when the session stopped. The original fix session ran lint/typecheck. The integrated source subsequently passed lint/typecheck/build and [full PR CI](https://github.com/timblazing/fillrate/actions/runs/37648531184), including hosted/local checks and all applicable browser flows. Those checks do not run the post-fix axe audit. Rerun the same audit, plus the affected browser flows, on the final candidate before closing the row. The gallery page was not audited.

## Post-fix candidate acceptance — 2026-10-07 (Codex)

The repeatable `--flow=accessibility` pass on production source `f01687b` completed **52/52 checks**: 13 production page states × light/dark × 1440×900 / iPhone 16 393×852. agent-browser 0.37.1 uses its embedded axe-core 4.12.1 here (the earlier injected audit used 4.13.0); WCAG 2.0/2.1 A/AA tags were retained. Data came from the isolated lesson, comparison and explorer flows: 2,000 orders / 443 persisted shipments, two completed comparison runs, and a two-k explorer. The accessibility sheet is one representative persisted shipment; the prerequisite lesson flow separately verifies the complete 466-page print export, all unshipped reasons and a one-page selected shipment.

All 52 states had zero axe violations, zero page overflow, enabled reduced motion with no running infinite animations, and no sampled focus failures. Focus sampling checks up to 25 visible, tabbable controls per state (1,092 samples across repeated states) after enabling keyboard modality and waiting for focus styles; it excludes collapsed/inert content. It checks appearance, not complete keyboard traversal or focus restoration in every dialog. The landing FAQ was expanded so the hosted-road coverage copy was audited and captured.

The rerun found seven cluster label colors at 2.54–4.32:1 against white. Shared route/cluster swatches now use paired foreground tokens: black for palette entries 1–7 and white for 8. Map colors retain their stable identities in both themes. Manual follow-up of axe's incomplete results also found an unsupported accessible-name attribute on the generic page counter; actual screen-reader text now says “Page … of …”. The final rerun no longer reports that ARIA incomplete case.

[Retained raw report](assets/m8-accessibility-2026-10-07/audit.json); reviewed captures: [map light desktop](assets/m8-accessibility-2026-10-07/run-map-light-1440.png), [map dark desktop](assets/m8-accessibility-2026-10-07/run-map-dark-1440.png), [expanded FAQ light phone](assets/m8-accessibility-2026-10-07/landing-light-393.png), [expanded FAQ dark phone](assets/m8-accessibility-2026-10-07/landing-dark-393.png). Swatches remain readable, phone FAQ text wraps without clipping, and the captured focus indicators are visible.

Command: `A11Y_REPORT_OUT=/tmp/audit.json A11Y_SHOTS=/tmp/shots UV_PYTHON=/path/to/python3.13 bun run test:browser --flow=accessibility` after production build. Lint, typecheck and build pass; lint retains the existing HeroGlobe dependency warning. Hosted/local checks passed 144/144. The lesson/comparison/explorer prerequisites and a separate near-limit matrix flow pass. [Candidate performance](m8-candidate-performance-2026-10-07.md) records their scoped timing evidence.

Limits: axe still leaves color contrast incomplete in 22 states where overlapping/canvas content or horizontally clipped table cells prevent determination; the raw report retains those targets for manual review. Gallery accessibility, all loading/error/dialog states and six-Block integration acceptance remain open. No image, deployed frontend, or live road UI acceptance is claimed by this local pass.
