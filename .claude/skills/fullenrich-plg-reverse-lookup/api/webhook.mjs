/**
 * Vercel-compatible webhook receiver. Two endpoints in one file:
 *
 *   POST /api/webhook            <- your product POSTs { email, custom? } here on signup
 *   POST /api/fullenrich-callback <- FullEnrich POSTs the enrichment result here
 *
 * Vercel routing: drop this file at api/webhook.mjs and api/fullenrich-callback.mjs
 * (a 4-line wrapper for each path) — see the shipped wrappers next to this file.
 *
 * Daily credit safeguard: MAX_CREDITS_PER_DAY env var (default 200). Webhook
 * short-circuits with HTTP 429 once exceeded. Counter persists in /tmp/lookup-counter.json
 * for cold-start safety.
 *
 * WEBHOOK_DRY_RUN=1 disables FullEnrich calls entirely; the request is logged
 * with the would-be cost but no credits are spent. Use this for the first 24h
 * after deploy to validate signup wiring without burning credits.
 */

import fs from 'node:fs/promises';

const COUNTER_PATH = process.env.COUNTER_PATH || '/tmp/lookup-counter.json';
const MAX_CREDITS_PER_DAY = parseInt(process.env.MAX_CREDITS_PER_DAY || '200', 10);
const DRY_RUN = process.env.WEBHOOK_DRY_RUN === '1';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readCounter() {
  try {
    const raw = await fs.readFile(COUNTER_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (parsed.day !== today) return { day: today, used: 0 };
    return parsed;
  } catch { return { day: new Date().toISOString().slice(0, 10), used: 0 }; }
}

async function writeCounter(c) {
  await fs.writeFile(COUNTER_PATH, JSON.stringify(c));
}

async function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => buf += c);
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/**
 * Forward the enriched record to a user-defined webhook (optional).
 * Generic POST with the full enriched JSON body. Wire it to whatever you want.
 */
async function forwardToWebhook(enriched) {
  const url = process.env.FORWARD_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enriched),
    });
  } catch (e) {
    console.error(`[plg-callback] forward webhook failed: ${e.message}`);
  }
}

/**
 * Append the enriched record to a JSONL log file. Default: /tmp/plg-enriched.jsonl.
 * Override with PLG_LOG_PATH env var. Set to empty string to disable.
 */
async function appendLog(enriched) {
  const logPath = process.env.PLG_LOG_PATH ?? '/tmp/plg-enriched.jsonl';
  if (!logPath) return;
  try {
    await fs.appendFile(logPath, JSON.stringify(enriched) + '\n');
  } catch (e) {
    console.error(`[plg-callback] log append failed: ${e.message}`);
  }
}

export async function handleSignup(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }

  let payload;
  try { payload = await readJson(req); } catch { res.statusCode = 400; return res.end('invalid json'); }

  const email = (payload.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) { res.statusCode = 400; return res.end('invalid email'); }

  const counter = await readCounter();
  if (counter.used >= MAX_CREDITS_PER_DAY) {
    res.statusCode = 429;
    return res.end(`daily credit ceiling reached (${counter.used}/${MAX_CREDITS_PER_DAY})`);
  }

  if (DRY_RUN) {
    console.log(`[plg-webhook] DRY_RUN: would lookup ${email} (1 credit). counter=${counter.used}/${MAX_CREDITS_PER_DAY}`);
    res.statusCode = 200; return res.end('ok (dry-run)');
  }

  const callbackUrl = `${(req.headers['x-forwarded-proto'] || 'https')}://${req.headers.host}/api/fullenrich-callback`;
  const r = await fetch('https://app.fullenrich.com/api/v2/contact/reverse/email/bulk', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.FULLENRICH_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: `plg-${email}`,
      webhook_url: callbackUrl,
      data: [{ email, custom: { ...payload.custom, source_email: email } }],
    }),
  });

  if (!r.ok) {
    console.error(`[plg-webhook] FullEnrich rejected: ${r.status} ${await r.text()}`);
    res.statusCode = 502; return res.end('upstream error');
  }

  counter.used += 1;
  await writeCounter(counter);
  console.log(`[plg-webhook] queued ${email}. counter=${counter.used}/${MAX_CREDITS_PER_DAY}`);
  res.statusCode = 202; res.end('queued');
}

export async function handleFullenrichCallback(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }

  let payload;
  try { payload = await readJson(req); } catch { res.statusCode = 400; return res.end('invalid json'); }

  if (payload.status !== 'FINISHED') {
    res.statusCode = 200; return res.end('ignored');
  }

  for (const c of payload.data || []) {
    // Reverse-lookup payload shape (verified live 2026-05-11):
    //   { input: { email }, custom, contact_info: {}, profile: {
    //       id, full_name, first_name, last_name,
    //       location: { country, country_code, city, region },
    //       employment: { current: { title, seniority, company: { name, domain, industry, ... }, is_current, start_at } },
    //       social_profiles: { professional_network: { url, handle, id } } } }
    const p = c?.profile || {};
    const emp = p.employment?.current || {};
    const enriched = {
      email: c?.input?.email || '',
      first_name: p.first_name || '',
      last_name: p.last_name || '',
      full_name: p.full_name || '',
      title: emp.title || '',
      seniority: emp.seniority || '',
      company_name: emp.company?.name || '',
      company_domain: emp.company?.domain || '',
      industry: emp.company?.industry?.main_industry || '',
      linkedin_url: p.social_profiles?.professional_network?.url || '',
      location: [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(', '),
      custom: c?.custom || {},
    };

    if (!enriched.first_name && !enriched.last_name) {
      console.log(`[plg-callback] no profile data returned for ${enriched.email} — skipping downstream pushes`);
      continue;
    }

    // Pure FullEnrich output: structured log + optional generic forward webhook.
    // No third-party SaaS integrations baked in. Pipe the JSONL/log/webhook to
    // whatever stack you run (CRM, data warehouse, BI, messaging, automation).
    await Promise.all([
      appendLog(enriched),
      forwardToWebhook(enriched),
    ]);
    console.log(`[plg-callback] enriched: ${JSON.stringify(enriched)}`);
  }

  res.statusCode = 200; res.end('ok');
}
