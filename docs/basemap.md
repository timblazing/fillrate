# Basemap provider and terms

Status checked 2026-10-06 against the current default style URLs in `apps/web/src/components/ui/map.tsx`.

## Shipped provider

The shared MapLibre component loads CARTO's Positron style in light mode and Dark Matter in dark mode from `basemaps.cartocdn.com`. It does not set a custom attribution string. The transparent `blank` map style has no basemap and does not use CARTO tiles.

CARTO says its basemaps are derived from OpenStreetMap. Maps using these CARTO styles must show visible, linked attribution to both OpenStreetMap contributors and CARTO. CARTO specifies links to its attribution page and the OpenStreetMap copyright page; printed or static map images need the same credit in the image or caption. Sources: [CARTO attribution requirements](https://carto.com/attribution/) and [OpenStreetMap copyright](https://www.openstreetmap.org/copyright).

The initial gallery inspection found that the control used MapLibre's compact mode. CARTO's credits were present but could be collapsed to an attribution button after map interaction. Product maps and the gallery map compositions now request an expanded control. A local visual/DOM inspection at 1440×900 and 393×852 confirmed the two credits remain visible and fit within the map bounds.

**Credit links (resolved 2026-10-06).** CARTO's TileJSON (`tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json`) still supplies `© CARTO` → `carto.com/about-carto/` and `© OpenStreetMap` → `http://www.openstreetmap.org/about/`. CARTO's current rules say "The word CARTO links to this page [carto.com/attribution]; OpenStreetMap links to its copyright page" and give the line `© OpenStreetMap contributors, © CARTO`. MapLibre gives explicit source options precedence over TileJSON, so the shared map (`components/ui/map.tsx`, a documented minimal edit to vendored mapcn code) applies a `transformStyle` that sets every `*.cartocdn.com` tile source's `attribution` to `CARTO_ATTRIBUTION`, on first load and on each light/dark style swap. A production-build check of `/dev/components` (both gallery maps) rendered exactly `© OpenStreetMap contributors, © CARTO` with links to `https://www.openstreetmap.org/copyright` and `https://carto.com/attribution/`, expanded and visible, in light (Positron) and dark (Dark Matter) themes. The blank and custom styles are untouched; a custom provider must supply its own attribution.

## Current service terms and launch gap

CARTO's [Basemaps Terms and Conditions](https://carto.com/legal/basemap-terms/) (checked 2026-10-06; page says last updated 2026-09-29) require each customer to use its own CARTO-issued API key. The terms list a free service limit of 5 million tile requests/month for non-commercial use and 1 million/month for commercial use. CARTO defines commercial use to include an application operated by a business in its trade or profession, even if it is not offered for a fee or generating revenue. The commercial plan is listed at 10 million requests/month for $500/month or 50 million/month for $1,500/month; pricing and terms can change. The current default style URLs do not include a CARTO API key, and the repository has no key configuration documented.

**Owner decision (2026-10-06):** keep keyless CARTO for v1. The owner accepts the risk that CARTO may rate-limit, suspend or revoke keyless access, and has not classified use, chosen a tier or obtained a key. Fillrate does not claim CARTO key/tier conformance. A keyed or alternative provider remains a follow-up; maps.black (keyless, no SLA) was reviewed and not selected for v1.

This is a provider and configuration gate, not a legal determination that Fillrate qualifies for any particular tier. Before public launch, the owner must confirm intended use classification and acceptable capacity/cost with CARTO, obtain/accept applicable terms and an owner-controlled key, and decide how to configure the key for hosted use. Do not treat the public style URL or the component's MIT license as permission for production tile use. If the selected terms/capacity are unsuitable, choose a provider or deployment style and record its terms before launch.

For local use, CARTO may rate-limit, suspend or revoke free access; map failure must remain a non-blocking empty-background state as specified in `fillrate-technical-spec.md` §16. The app's custom/blank style support provides a technical fallback, but no alternate hosted provider is currently selected.

## Evidence limits

- Local inspection covered the two gallery map compositions at desktop and phone widths after setting the shared product compositions to expanded attribution, and the rendered link destinations in both themes. Product routes use the same shared component. The printable shipment sheet contains no basemap, and Fillrate has no static map-image export, so no print credit is currently required.
- No CARTO key, account, usage volume, plan, or acceptance of current terms was inspected or configured.
- Recheck CARTO's current terms and usage limits before release; they may change.
