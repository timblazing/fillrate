# Basemap provider and terms

Status checked 2026-10-06 against the current default style URLs in `apps/web/src/components/ui/map.tsx`.

## Shipped provider

The shared MapLibre component loads CARTO's Positron style in light mode and Dark Matter in dark mode from `basemaps.cartocdn.com`. It does not set a custom attribution string. The transparent `blank` map style has no basemap and does not use CARTO tiles.

CARTO says its basemaps are derived from OpenStreetMap. Maps using these CARTO styles must show visible, linked attribution to both OpenStreetMap contributors and CARTO. CARTO specifies links to its attribution page and the OpenStreetMap copyright page; printed or static map images need the same credit in the image or caption. Sources: [CARTO attribution requirements](https://carto.com/attribution/) and [OpenStreetMap copyright](https://www.openstreetmap.org/copyright).

The initial gallery inspection found that the control used MapLibre's compact mode. CARTO's credits were present but could be collapsed to an attribution button after map interaction. Product maps and the gallery map compositions now request an expanded control. A local visual/DOM inspection at 1440×900 and 393×852 confirmed the two credits remain visible and fit within the map bounds. The loaded style's links currently point to CARTO's about page and OpenStreetMap's about page, rather than the destinations on CARTO's current attribution instructions; link-target conformance remains open.

## Current service terms and launch gap

CARTO's [Basemaps Terms and Conditions](https://carto.com/legal/basemap-terms/) (checked 2026-10-06; page says last updated 2026-09-29) require each customer to use its own CARTO-issued API key. The terms list a free service limit of 5 million tile requests/month for non-commercial use and 1 million/month for commercial use. CARTO defines commercial use to include an application operated by a business in its trade or profession, even if it is not offered for a fee or generating revenue. The commercial plan is listed at 10 million requests/month for $500/month or 50 million/month for $1,500/month; pricing and terms can change. The current default style URLs do not include a CARTO API key, and the repository has no key configuration documented.

This is a provider and configuration gate, not a legal determination that Fillrate qualifies for any particular tier. Before public launch, the owner must confirm intended use classification and acceptable capacity/cost with CARTO, obtain/accept applicable terms and an owner-controlled key, and decide how to configure the key for hosted use. Do not treat the public style URL or the component's MIT license as permission for production tile use. If the selected terms/capacity are unsuitable, choose a provider or deployment style and record its terms before launch.

For local use, CARTO may rate-limit, suspend or revoke free access; map failure must remain a non-blocking empty-background state as specified in `fillrate-technical-spec.md` §16. The app's custom/blank style support provides a technical fallback, but no alternate hosted provider is currently selected.

## Evidence limits

- Local inspection covered the two gallery map compositions at desktop and phone widths after setting the shared product compositions to expanded attribution. It did not visually inspect every product route or print/static export. The provider-required link destinations still need resolution.
- No CARTO key, account, usage volume, plan, or acceptance of current terms was inspected or configured.
- Recheck CARTO's current terms and usage limits before release; they may change.
