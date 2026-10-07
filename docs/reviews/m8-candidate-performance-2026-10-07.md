# M8 candidate performance — 2026-10-07

Scoped warm local measurements, not whole-dashboard or statistically reliable p95 acceptance. Results source: `f01687b`; near-limit matrix source: `d16a8c7` (the later change only replaces the results page counter's unsupported accessible-name attribute with screen-reader text and expands FAQ audit coverage; the matrix path is identical).

Environment: Apple M1 Pro / MacBookPro18,3, 32 GiB, macOS 27.0, Node 24.18.1, agent-browser 0.37.1 headless Chromium, local production web/worker and isolated synthetic data. Desktop 1440×900; iPhone 16 profile 393×852. These are warm local browser measurements, not cold-cache, physical-phone or VPS timings. Solver work is excluded from interaction latency.

| Interaction | Desktop trials | Phone trials | Scope |
| --- | --- | --- | --- |
| 2,000-order results → Shipments | 47.1, 98.1, 92.8 ms | 113.2, 141.5, 136.8 ms | 443 persisted shipments; 50 mounted table rows, 1,339 DOM nodes. Includes observed event input delay and two animation frames after click. All six samples below 200 ms. |
| 1,001-node matrix preview → valid summary | 210.7, 209.2, 190.1 ms | 197.7, 197.8, 193.7 ms | 1,001,000 directed edges; 7,844,814 input bytes; preview response 43,983 encoded bytes. |
| Matrix preview → paint | 237.4, 237.2, 205.9 ms | 230.2, 226.0, 220.3 ms | Valid-summary timing plus two animation frames. API validation is part of this action; it is distinct from a row/filter selection. |

Observed results-interaction tasks were at most 96 ms, matrix-preview tasks at most 67 ms. The results flow also checked steady scrolling with no long tasks, keyboard table scrolling, global pages 1–50 / 51–100, selection surviving pagination with its cluster filter/details, and no extra full-result download. The table remains a labeled scroll region. The matrix sample stays bounded at 12×12; the flow then saved and selected the snapshot, verified directed worker legs, exported it and refused a snapshot after coordinates changed.

Raw trials: [candidate performance report](assets/m8-candidate-performance-2026-10-07.json). Repeat results via `UV_PYTHON=/path/to/python3.13 bun run test:browser --flow=lesson` (also included in `--flow=accessibility`); repeat matrix via `MATRIX_PERF_PROFILE=1 MATRIX_PROFILE_OUT=/tmp/matrix.json UV_PYTHON=/path/to/python3.13 bun run test:browser --flow=matrix` after building.

Remaining: repeat the 601-node representative UI workload, broader map/filter/selection interactions, cold-load/bundle/network/render profiling, enough samples for meaningful tail latency, and native target timing. These observations improve candidate evidence but do not close frontend-spec performance acceptance.
