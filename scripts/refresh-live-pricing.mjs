#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const kitsPath = resolve(rootDir, 'src/data/kits.json');
const outputPath = resolve(rootDir, process.env.LIVE_PRICING_OUTPUT || 'public/data/live-pricing.json');
const overridesPath = process.env.PRICE_OVERRIDES_FILE ? resolve(rootDir, process.env.PRICE_OVERRIDES_FILE) : null;

const kits = JSON.parse(await readFile(kitsPath, 'utf8'));
const overrides = overridesPath ? JSON.parse(await readFile(overridesPath, 'utf8')) : {};
const overrideKits = overrides.kits && typeof overrides.kits === 'object' ? overrides.kits : overrides;

const feed = {
  status: overrides.status || 'catalogue-snapshot',
  updatedAt: new Date().toISOString(),
  source: overrides.source || 'Generated from src/data/kits.json by npm run refresh-prices',
  kits: Object.fromEntries(kits.map((kit) => {
    const override = overrideKits[kit.id] || {};
    const price = Number.isFinite(override.price) ? override.price : kit.price;
    return [kit.id, {
      price,
      detail: override.detail || 'Catalogue snapshot generated for this deployment. Check the retailer before buying.',
      priceMeta: {
        status: overrides.status === 'live' ? 'live' : 'catalogue-snapshot',
        label: overrides.status === 'live' ? 'Live price' : 'Catalogue snapshot',
        detail: override.detail || 'Generated from the app catalogue; replace with retailer feed data when available.',
      },
    }];
  })),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(feed, null, 2)}\n`);
console.log(`Wrote ${Object.keys(feed.kits).length} kit prices to ${outputPath}`);
