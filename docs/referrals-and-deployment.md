# Referral Monetisation and Tracking Plan

SolarSpot is still a static Vite app, so referral monetisation is split into two layers:

1. **Static-safe partner configuration** in `src/data/referrals.json`.
2. **Optional server-side redirect/tracking** in `scripts/referral-server.mjs` once the app is deployed behind Caddy/Nginx.

## Current status

The app now supports referral configuration, disclosure copy, outbound-click payloads, and a small Node referral server, but affiliate accounts are **not yet active**. Partner records marked `affiliate-pending` or `direct-pending` should not be treated as revenue-generating until the relevant partner account/tag/deep-link format is approved and updated.

## Files

| File | Purpose |
| --- | --- |
| `src/data/referrals.json` | Partner allow-list, disclosure copy, kit-to-partner mapping, placeholder affiliate templates. |
| `src/utils/referrals.js` | Safe direct/affiliate link resolution and tracked redirect URL generation. |
| `src/utils/referral-events.js` | Browser click payload creation and `sendBeacon`/`fetch` tracking. |
| `scripts/referral-server.mjs` | Optional Node server for `/r/:kitId`, `/api/referral-clicks`, and `/api/referrals/summary`. |
| `scripts/referral-server.test.js` | Redirect, click normalisation, and summary tests. |

## Required production config

`src/data/config.json` contains the deployment hooks:

```json
{
  "referralRedirectBaseUrl": "",
  "referralTrackingEndpoint": ""
}
```

For production, set them to the deployed domain/API routes, for example:

```json
{
  "referralRedirectBaseUrl": "https://solarspot.co.uk/r",
  "referralTrackingEndpoint": "https://solarspot.co.uk/api/referral-clicks"
}
```

If these values are empty, the frontend still renders safe direct retailer links and the disclosure, but it will not send click analytics or use tracked redirects.

## Running the referral server locally

```bash
npm run referral-server
```

Default routes:

```text
GET  /health
GET  /r/:kitId?campaign=results-primary
POST /api/referral-clicks
GET  /api/referrals/summary
```

Default data/log paths:

```text
src/data/referrals.json
src/data/kits.json
data/referral-clicks.jsonl
```

Override paths with environment variables:

```bash
PORT=8787 \
SOLARSPOT_ROOT=/var/www/solarspot/current \
REFERRAL_LOG_FILE=/var/lib/solarspot/referral-clicks.jsonl \
npm run referral-server
```

## Caddy routing shape

When deployed, Caddy can serve the static app and proxy referral/API routes to the Node server:

```caddyfile
solarspot.co.uk {
  root * /var/www/solarspot/current/dist
  encode gzip zstd

  reverse_proxy /r/* 127.0.0.1:8787
  reverse_proxy /api/referral-clicks 127.0.0.1:8787
  reverse_proxy /api/referrals/summary 127.0.0.1:8787
  reverse_proxy /health 127.0.0.1:8787

  try_files {path} /index.html
  file_server
}
```

## Referral summary

Once the referral server is writing events, this endpoint gives a simple count summary:

```bash
curl -s https://solarspot.co.uk/api/referrals/summary
```

Example response:

```json
{
  "totalClicks": 42,
  "byKit": {
    "ecoflow-powerstream-400": 11
  },
  "byPartner": {
    "ecoflow": 18
  },
  "byCampaign": {
    "results-primary": 28,
    "sticky-cta": 14
  }
}
```

The event payload intentionally avoids customer PII. It keeps kit, partner, campaign, source, destination host, and quote metrics such as annual value/payback where available.

## Partner account setup checklist

Use George's email (`ghollis34@gmail.com`) for applications where requested, but account creation still needs owner action for email verification, tax/payment details, terms acceptance, and password/MFA setup.

Do **not** store partner dashboard passwords in this repository or on the public web server. Store account passwords in a password manager. Server secrets, if any, should be environment variables or Docker secrets, not committed JSON.

### EcoFlow

- Apply to the EcoFlow UK/EU affiliate or partner programme.
- Confirm deep-link format and whether custom `utm_*` parameters are allowed.
- Replace `src/data/referrals.json` EcoFlow `urlTemplate` with the approved affiliate template.
- Change partner `status` from `affiliate-pending` to `affiliate`.

### Zendure

- Apply to Zendure's affiliate programme or direct referral scheme.
- Confirm product deep links for SolarFlow/Hyper/Battery products.
- Update `urlTemplate`, kit slugs, and `status`.

### Anker SOLIX

- Confirm whether Anker direct, Awin/Impact/CJ, or Amazon Associates is the best route.
- `anker.com` is already allow-listed for safe direct links.
- Add affiliate template/tag once approved.

### Thunder Energy

- Confirm whether Thunder Energy has an affiliate programme.
- If no programme exists, negotiate a direct referral agreement or keep direct retailer links.

### Amazon UK Associates

- Apply for Amazon UK Associates if Amazon links are needed.
- Replace `YOUR_AMAZON_ASSOCIATES_TAG` in `src/data/referrals.json`.
- Add ASINs to kit mappings if Amazon becomes the preferred destination.
- Keep Amazon disclosure/compliance requirements up to date.

## Deployment readiness checklist

Before launch:

- [ ] Partner accounts approved.
- [ ] Real affiliate tags/templates configured.
- [ ] `status` changed from pending to `affiliate` only for approved partners.
- [ ] `referralRedirectBaseUrl` and `referralTrackingEndpoint` set to production URLs.
- [ ] Referral server supervised by systemd or Docker.
- [ ] Referral log path backed up.
- [ ] `/api/referrals/summary` protected or moved behind an internal/admin route before public launch if the counts are commercially sensitive.
- [ ] Affiliate disclosure reviewed on the results page.
- [ ] `npm test`, `npm run build`, and `npm audit --omit=dev` pass.
