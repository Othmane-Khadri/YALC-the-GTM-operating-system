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
import path from 'node:path';

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

async function postSlack(text) {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
}

async function postHubspot(contact) {
  const token = process.env.HUBSPOT_API_TOKEN;
  if (!token) return;
  await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: {
      email: contact.email,
      firstname: contact.first_name,
      lastname: contact.last_name,
      jobtitle: contact.title,
      company: contact.company_name,
      lifecyclestage: 'lead',
      hs_lead_status: 'NEW',
    }}),
  });
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
    const ci = c?.contact_info || {};
    const ident = c?.identity || c?.input || {};
    const enriched = {
      email: c?.input?.email || ident.email,
      first_name: ident.first_name || '',
      last_name: ident.last_name || '',
      title: ident.title || ident.headline || '',
      company_name: ident.company_name || ident.company || '',
      linkedin_url: ident.linkedin_url || ci.linkedin_url || '',
    };

    const text = `:bust_in_silhouette: PLG signup identified\n*${enriched.first_name} ${enriched.last_name}* — ${enriched.title} @ ${enriched.company_name}\n${enriched.linkedin_url}\nEmail: ${enriched.email}`;
    await Promise.all([
      postSlack(text),
      postHubspot(enriched),
    ]);
    console.log(`[plg-callback] processed ${enriched.email}`);
  }

  res.statusCode = 200; res.end('ok');
}
