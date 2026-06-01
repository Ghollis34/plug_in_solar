import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveRetailerLink } from '../src/utils/referrals.js';

const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 32 * 1024;

export function resolveReferralDestination({ kitId, campaign = 'redirect', referrals, kits, redirectBaseUrl = '' } = {}) {
  const kit = Array.isArray(kits) ? kits.find((item) => item.id === kitId) : null;
  if (!kit) {
    return { ok: false, statusCode: 404, error: 'Unknown kit' };
  }

  const linkInfo = resolveRetailerLink(kit, {
    referralConfig: referrals,
    campaign,
    redirectBaseUrl,
  });

  if (!linkInfo.destinationUrl && !linkInfo.url) {
    return { ok: false, statusCode: 404, error: 'Referral destination unavailable', kitId };
  }

  return {
    ok: true,
    kitId,
    kitName: kit.name,
    partnerId: linkInfo.partnerId,
    partnerName: linkInfo.partnerName,
    campaign,
    destinationUrl: linkInfo.destinationUrl || linkInfo.url,
    usesAffiliateLink: Boolean(linkInfo.usesAffiliateLink),
  };
}

export function normaliseReferralClick(input = {}) {
  const destinationHost = getHost(input.destinationUrl || input.url) || input.destinationHost;
  return removeEmptyFields({
    eventType: 'referral_click',
    createdAt: new Date().toISOString(),
    kitId: cleanText(input.kitId),
    kitBrand: cleanText(input.kitBrand),
    kitName: cleanText(input.kitName),
    hasBattery: typeof input.hasBattery === 'boolean' ? input.hasBattery : undefined,
    partnerId: cleanText(input.partnerId),
    partnerName: cleanText(input.partnerName),
    campaign: cleanText(input.campaign),
    source: cleanText(input.source),
    destinationHost,
    isTrackedRedirect: Boolean(input.isTrackedRedirect),
    usesAffiliateLink: Boolean(input.usesAffiliateLink),
    quote: normaliseQuote(input.quote),
  });
}

export function buildReferralSummary(events = []) {
  const summary = {
    totalClicks: events.length,
    byKit: {},
    byPartner: {},
    byCampaign: {},
  };

  for (const event of events) {
    increment(summary.byKit, event.kitId || 'unknown');
    increment(summary.byPartner, event.partnerId || 'unknown');
    increment(summary.byCampaign, event.campaign || 'unknown');
  }

  return summary;
}

export function createReferralServer({ referrals, kits, logFile }) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/r/')) {
        const kitId = decodeURIComponent(url.pathname.slice('/r/'.length));
        const campaign = url.searchParams.get('campaign') || 'redirect';
        const destination = resolveReferralDestination({ kitId, campaign, referrals, kits });
        if (!destination.ok) return sendJson(res, destination.statusCode || 404, destination);

        await writeReferralEvent(logFile, normaliseReferralClick({
          ...destination,
          source: 'redirect',
          isTrackedRedirect: true,
        }));

        res.writeHead(302, {
          Location: destination.destinationUrl,
          'Cache-Control': 'no-store',
        });
        return res.end();
      }

      if (req.method === 'POST' && url.pathname === '/api/referral-clicks') {
        const body = await readJsonBody(req);
        const event = normaliseReferralClick(body);
        await writeReferralEvent(logFile, event);
        return sendJson(res, 202, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/api/referrals/summary') {
        const events = await readReferralEvents(logFile);
        return sendJson(res, 200, buildReferralSummary(events));
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: 'Referral server error' });
    }
  });
}

async function main() {
  const root = resolve(process.env.WATTPATCH_ROOT || process.env.SOLARSPOT_ROOT || process.cwd());
  const referrals = await readJson(join(root, 'src/data/referrals.json'));
  const kits = await readJson(join(root, 'src/data/kits.json'));
  const logFile = process.env.REFERRAL_LOG_FILE || join(root, 'data/referral-clicks.jsonl');
  const port = Number(process.env.PORT || DEFAULT_PORT);

  const server = createReferralServer({ referrals, kits, logFile });
  server.listen(port, () => {
    console.log(`Referral server listening on ${port}`);
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readJsonBody(req) {
  let total = 0;
  const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function writeReferralEvent(logFile, event) {
  await mkdir(dirname(logFile), { recursive: true });
  await appendFile(logFile, `${JSON.stringify(event)}\n`, 'utf8');
}

async function readReferralEvents(logFile) {
  try {
    const content = await readFile(logFile, 'utf8');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function normaliseQuote(quote = {}) {
  if (!quote || typeof quote !== 'object') return undefined;
  return removeEmptyFields({
    quoteId: cleanText(quote.quoteId),
    assumptionMode: cleanText(quote.assumptionMode),
    annualValue: cleanNumber(quote.annualValue),
    paybackYears: cleanNumber(quote.paybackYears),
    annualKwh: cleanNumber(quote.annualKwh),
    hasBattery: typeof quote.hasBattery === 'boolean' ? quote.hasBattery : undefined,
  });
}

function cleanText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  return String(value).trim().slice(0, 160) || undefined;
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function getHost(url) {
  if (!url || typeof url !== 'string') return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function increment(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function removeEmptyFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => {
      if (entryValue === undefined || entryValue === null || entryValue === '') return false;
      if (typeof entryValue === 'object' && !Array.isArray(entryValue) && Object.keys(entryValue).length === 0) return false;
      return true;
    })
  );
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
