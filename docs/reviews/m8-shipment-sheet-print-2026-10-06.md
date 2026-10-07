# M8 shipment-sheet print acceptance — 2026-10-06

Source: branch `claude/m8-shipment-sheet-print` from `origin/main` `c03fe1f`. Data: the synthetic 2,000-order fulfillment lesson, persisted by a real worker run (443 shipments, 327 unshipped lines) in an isolated temporary database. Browser: agent-browser 0.37.1 (Chrome for Testing) headless on macOS / Apple M1 Pro. PDFs are Chrome's print-to-PDF output (`agent-browser pdf`, default Letter page).

## Findings before the change

- The signed-in app rail (icons) and top bar ("Fillrate", account) printed on every shipment page and narrowed the sheet ([page 1 before](assets/m8-shipment-sheet-print/before-print-page-1.png)). The sheet's own toolbar was already hidden in print.
- The printed output listed only shipped stops. The 327 unshipped lines and their reasons (all "No stock" in this scenario) appeared only in the run page's Unshipped tab, so a printed handoff silently omitted what did not ship.
- Printed pages did not identify the run, so loose pages could not be traced to their source.

## Change

- `AppShell`: the navigation rail and header are `print:hidden`, and the frame becomes a plain block in print.
- Sheet (`/runs/<id>/sheet`): printing all shipments appends an **Unshipped lines** section on a new page. It has a per-reason summary using the shared `lib/copy` groups and hints, then every unshipped line with location, product, pieces, value, reason, pipeline step and the persisted evidence sentence. A single-shipment sheet (`?shipment=`) omits it. Each shipment page carries `Run <id> · Shipment n of N`. Stop and unshipped rows avoid page splits, and table headers repeat. The page margin is 12 mm. On screen, wide tables scroll inside labeled, keyboard-focusable regions, so the phone page has no page-wide overflow (393/393), and the header links to the unshipped section.
- The persisted run summary is the only data source; nothing is recomputed for print.

## Result

| Check | Result |
| --- | --- |
| Pages | 443 shipments → 466 printed pages: one per shipment, then 23 unshipped-line pages with repeating headers |
| Chrome | App rail, header and sheet toolbar match the page's own `@media print { display: none }` rules; none appear in the PDF ([page 1 after](assets/m8-shipment-sheet-print/after-print-page-1.png)) |
| Unshipped | 327 of 327 persisted lines, grouped summary "No stock: 327 lines, 1,421 pcs, $437,570" ([first unshipped page](assets/m8-shipment-sheet-print/after-print-unshipped.png)) |
| Single shipment | `?shipment=<id>` prints exactly one page and no unshipped section |
| Phone screen | 393×852 has no page-level horizontal overflow ([capture](assets/m8-shipment-sheet-print/after-sheet-393.png)) |

`bun run test:browser --flow=lesson` now asserts all of the above against the persisted run (including PDF page counts) and passed.

## Limits

- Headless Chrome cannot switch to print media. The automated check evaluates the page's own print rules against the chrome elements and counts PDF pages; the attached page images are Chrome's actual PDF output. Physical printers and other browsers' print engines were not tested.
- Only the "No stock" reason occurs in this workload. Other reason groups use the same shared labels and are covered by the run page's Unshipped tab flows. The sheet has no basemap, so no map credit is printed.
