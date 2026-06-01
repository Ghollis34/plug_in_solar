# WattPatch / Plug-in Solar

WattPatch is a Vite-powered single-page wizard for modelling small UK plug-in solar kits. It guides a homeowner through location lookup, property/site setup, panel placement, shade analysis, kit selection, and a quote-style results page.

## What the app does

- Finds a UK property/location with Nominatim/OpenStreetMap-backed search.
- Uses MapLibre GL for map-heavy setup steps and satellite/outline context.
- Lets the user mark usable panel spaces and nearby obstacles.
- Scores direct-sun/shading signals for candidate spaces.
- Compares catalogue plug-in solar kits filtered by mounting type.
- Estimates annual kWh, self-use, spill/export, smart-tariff battery value, ROI, payback, and long-term return.
- Stores wizard state locally in `localStorage` so refresh/back-navigation does not lose progress.

## Tech stack

- Vanilla JavaScript modules
- Vite
- MapLibre GL
- Chart.js
- SunCalc
- Vitest

## Getting started

```bash
npm install
npm run dev
```

Then open the Vite URL printed by the dev server, normally `http://localhost:5173/`.

## Validation

```bash
npm test
npm run build
npm audit --omit=dev
```

The production build can warn about the MapLibre chunk being larger than 500 kB; that is expected unless map code is code-split later.

## Project structure

```text
src/
  data/                 Static quote configuration and kit catalogue
  steps/                Wizard step render/init modules
  utils/                Pure helpers, state, pricing, maps, quote model, tests
scripts/
  refresh-live-pricing.mjs
  referral-server.mjs     Optional Node referral redirect/click tracking API
public/data/
  live-pricing.json     Generated static price feed consumed by the SPA
docs/
  referrals-and-deployment.md
```

## Quote assumptions

The results page exposes three quote modes:

- **Conservative** — cautious self-use estimate; solar-only spill remains visible.
- **Balanced** — default initial quote; assumes high daytime use but does not hide solar-only spill.
- **Optimistic** — assumes modelled solar value is fully captured with no unpaid spill.

The default is configured in `src/data/config.json` with `quoteAssumptionMode`. The legacy `assumeNoSolarSpill` flag is kept as a compatibility fallback only.

## Solar data / PVGIS

`src/utils/pvgis.js` requests EU PVGIS `PVcalc` data for location-specific annual and monthly generation. Browser deployments can hit CORS/network restrictions, so the app now:

- returns display-safe source metadata for successful PVGIS results;
- clearly marks UK-average fallback data when PVGIS cannot be reached;
- supports a configurable `pvgisProxyUrl` in `src/data/config.json`.

When `pvgisProxyUrl` is set, requests are sent to:

```text
<pvgisProxyUrl>?target=<encoded PVGIS URL>
```

A serverless endpoint can implement that proxy by validating the `target` host is `re.jrc.ec.europa.eu`, fetching it server-side, and returning the JSON with browser-safe CORS headers.

## Referral links and tracking

Retailer CTAs are resolved through `src/data/referrals.json` and `src/utils/referrals.js`. The app safely falls back to direct retailer links until approved affiliate templates/tags are configured. Results-page CTAs show a partner-link disclosure and can send outbound click analytics when `referralTrackingEndpoint` is configured.

For tracked redirects and basic click counts, run the optional Node server:

```bash
npm run referral-server
```

See `docs/referrals-and-deployment.md` for Caddy routing, summary reporting, and partner account setup.

For a full first-time production rollout, including buying `wattpatch.co.uk` and deploying to Hetzner Cloud, see `docs/hetzner-deployment.md`. Production releases use `.github/workflows/ci-deploy.yml` plus `scripts/deploy-production.sh`: PRs run tests/build, and pushes to `main` deploy to Hetzner once the production GitHub Actions secrets and `WATTPATCH_DEPLOY_ENABLED=true` variable are configured.

## Pricing feed

The SPA tries to load `/data/live-pricing.json` at runtime. If the file is missing or invalid, catalogue prices from `src/data/kits.json` are used and labelled as fallback guide prices.

Generate or refresh the static feed with:

```bash
npm run refresh-prices
```

By default this writes a catalogue snapshot to `public/data/live-pricing.json`. To apply manually maintained retailer overrides, provide a JSON file:

```bash
PRICE_OVERRIDES_FILE=pricing-overrides.json npm run refresh-prices
```

Example override shape:

```json
{
  "status": "live",
  "source": "Manual retailer check",
  "kits": {
    "ecoflow-powerstream-400": {
      "price": 455,
      "detail": "Retailer price checked today."
    }
  }
}
```

## External services and data sources

- OpenStreetMap/Nominatim for location search/geocoding.
- MapLibre-compatible map tiles and optional satellite tiles.
- EU PVGIS for solar generation data where browser/network policy allows it.
- Static in-repo kit catalogue and optional generated live-pricing feed.
- Ofgem-style electricity and usage assumptions stored in `src/data/config.json`.

## Data/trust boundaries

This is an estimate tool, not a final engineering or financial quote. User-facing result copy should always make clear:

- whether PVGIS or fallback solar data was used;
- which quote assumption mode is active;
- which electricity unit rate and household annual usage are being used;
- whether kit prices are live, catalogue snapshots, or fallback guide prices;
- whether export/spill and smart-tariff assumptions are included.

Add regression tests for any new user-facing quote assumption text or separately displayed kWh/£ fields.
