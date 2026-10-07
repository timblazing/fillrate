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

## Not yet verified

The post-fix audit rerun was interrupted when the session stopped. The original fix session ran lint/typecheck. The integrated source subsequently passed lint/typecheck/build and [full PR CI](https://github.com/timblazing/fillrate/actions/runs/37648531184), including hosted/local checks and all applicable browser flows. Those checks do not run the post-fix axe audit. Rerun the same audit, plus the affected browser flows, on the final candidate before closing the row. Screen-reader (VoiceOver) passes, physical phone checks and the gallery page were not audited.
