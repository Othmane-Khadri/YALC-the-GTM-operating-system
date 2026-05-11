#!/usr/bin/env node
/**
 * fullenrich-content-engagers — LinkedIn post URL to ICP-qualified, enriched CSV.
 *
 *   node scripts/run.mjs <linkedin-post-url>
 *       [--out path.csv] [--icp config/icp.json] [--threshold 50]
 *       [--max <N>] [--max-credits <N>] [--dry-run] [--yes]
 *
 * Required env: FULLENRICH_API_KEY, UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startBulkEnrich,
  getCredits,
  flattenContact,
  chunk,
  estimateCost,
  confirmSpend,
} from '../../_shared/fullenrich/client.mjs';
import {
  fetchFromWebhookSite,
  createWebhookSiteToken,
} from '../../_shared/fullenrich/webhook.mjs';
import { writeCsv } from '../../_shared/fullenrich/csv.mjs';
import { loadIcp, scoreRow } from './icp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const positional = [];
  const flags = {
    out: 'qualified-engagers.csv',
    icp: path.join(__dirname, '..', 'config', 'icp.json'),
    threshold: 50,
    max: 500,
    'max-credits': 500,
    'dry-run': false,
    yes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { flags['dry-run'] = true; continue; }
    if (a === '--yes' || a === '-y') { flags.yes = true; continue; }
    if (a.startsWith('--')) {
      const [k, v] = a.includes('=') ? a.slice(2).split('=') : [a.slice(2), argv[++i]];
      flags[k] = v;
    } else positional.push(a);
  }
  return { positional, flags };
}

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

function unipileEnv() {
  const env = {
    apiKey: process.env.UNIPILE_API_KEY,
    dsn: process.env.UNIPILE_DSN,
    accountId: process.env.UNIPILE_ACCOUNT_ID,
  };
  for (const [k, v] of Object.entries(env)) if (!v) die(`UNIPILE_${k.replace(/[A-Z]/g, c => '_' + c).toUpperCase().replace(/^_/, '')} not set`);
  return env;
}

async function unipileGet(envU, path, query = {}) {
  const url = new URL(envU.dsn + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { 'X-API-KEY': envU.apiKey, accept: 'application/json' } });
  if (!r.ok) throw new Error(`Unipile ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function paginate(envU, path, query = {}, max = 1000) {
  const items = [];
  let cursor = null;
  while (items.length < max) {
    const q = cursor ? { ...query, cursor } : query;
    const page = await unipileGet(envU, path, q);
    items.push(...(page.items || []));
    if (!page.cursor || (page.items || []).length === 0) break;
    cursor = page.cursor;
  }
  return items.slice(0, max);
}

function engagerToContact(e) {
  return {
    first_name: e.first_name || (e.name || '').split(' ')[0] || '',
    last_name: e.last_name || (e.name || '').split(' ').slice(1).join(' ') || '',
    linkedin_url: e.profile_url || e.public_identifier ? `https://linkedin.com/in/${e.public_identifier}` : (e.linkedin_url || ''),
    title: e.headline || e.title || '',
    headline: e.headline || '',
    company_name: e.company || '',
    domain: e.company_domain || '',
    enrich_fields: ['contact.work_emails', 'contact.phones'],
    custom: { source: 'fullenrich-content-engagers' },
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const postUrl = positional[0];
  if (!postUrl) die('Usage: node scripts/run.mjs <linkedin-post-url> [flags]');
  if (!process.env.FULLENRICH_API_KEY) die('FULLENRICH_API_KEY not set');
  const envU = unipileEnv();

  const credits = await getCredits();
  console.log(`[fullenrich] credit balance: ${credits.balance}`);

  console.log('[unipile] resolving post...');
  const post = await unipileGet(envU, `/api/v1/posts/${encodeURIComponent(postUrl)}`, { account_id: envU.accountId });
  const socialId = post.social_id || post.id;
  console.log(`[unipile] social_id: ${socialId}`);

  console.log('[unipile] fetching reactions + comments...');
  const [reactions, comments] = await Promise.all([
    paginate(envU, `/api/v1/posts/${socialId}/reactions`, { account_id: envU.accountId }, parseInt(flags.max, 10)),
    paginate(envU, `/api/v1/posts/${socialId}/comments`, { account_id: envU.accountId }, parseInt(flags.max, 10)),
  ]);
  const all = [...reactions, ...comments];
  const byUrl = new Map();
  for (const e of all) {
    const c = engagerToContact(e);
    if (c.linkedin_url) byUrl.set(c.linkedin_url, c);
  }
  const engagers = [...byUrl.values()];
  console.log(`[unipile] ${all.length} engagements -> ${engagers.length} unique engagers`);

  const icp = await loadIcp(flags.icp);
  const threshold = parseInt(flags.threshold, 10) || 50;
  const scored = engagers.map(e => ({ ...e, ...scoreRow(e, icp, { threshold }) }));
  const passed = scored.filter(s => s.passed);
  const failed = scored.filter(s => !s.passed);
  console.log(`[icp] ${passed.length} passed, ${failed.length} dropped (threshold=${threshold})`);

  await writeCsv(flags.out.replace(/\.csv$/, '-disqualified.csv'), failed.map(f => ({
    first_name: f.first_name, last_name: f.last_name, linkedin_url: f.linkedin_url,
    title: f.title, score: f.score, reasons: f.reasons.join('; '),
  })));

  const maxCredits = parseInt(flags['max-credits'], 10) || 500;
  let contacts = passed;
  let estimated = estimateCost(contacts);
  if (estimated > maxCredits) {
    const ratio = maxCredits / estimated;
    contacts = contacts.slice(0, Math.floor(contacts.length * ratio));
    estimated = estimateCost(contacts);
    console.log(`[fullenrich] capped at --max-credits=${maxCredits} → enriching ${contacts.length} of ${passed.length} qualified (~${estimated} credits)`);
  } else {
    console.log(`[fullenrich] enriching ${contacts.length} qualified engagers (~${estimated} credits)`);
  }

  if (flags['dry-run']) {
    const dryPath = flags.out.replace(/\.csv$/, '-dryrun.csv');
    await writeCsv(dryPath, contacts);
    console.log(`[dry-run] wrote ${contacts.length} qualified contacts to ${dryPath}. Estimated full-run cost: ${estimated} credits.`);
    return;
  }

  const ok = await confirmSpend({
    expected: estimated,
    balance: credits.balance,
    label: `Enrich ${contacts.length} ICP-qualified engagers from ${postUrl}`,
    yes: flags.yes,
  });
  if (!ok) process.exit(2);

  let webhookUuid = null;
  let webhookUrl = process.env.FULLENRICH_WEBHOOK_URL;
  if (!webhookUrl) {
    const t = await createWebhookSiteToken();
    webhookUrl = t.url; webhookUuid = t.uuid;
    console.log(`[webhook] using webhook.site: ${webhookUrl}`);
    console.log(`[webhook] watch live: https://webhook.site/#!/${webhookUuid}`);
  }

  const enrichmentIds = [];
  for (const batch of chunk(contacts, 100)) {
    const { enrichment_id } = await startBulkEnrich({
      name: `content-engagers ${new Date().toISOString().slice(0, 10)} (${batch.length})`,
      webhook_url: webhookUrl,
      data: batch.map(({ score, passed, reasons, ...c }) => c),
    });
    enrichmentIds.push(enrichment_id);
    console.log(`[fullenrich] enqueued batch ${enrichmentIds.length}: ${enrichment_id}`);
  }

  const results = [];
  for (const id of enrichmentIds) {
    if (webhookUuid) {
      const payload = await fetchFromWebhookSite(webhookUuid, {
        timeoutMs: 5 * 60_000,
        matches: p => p.id === id && p.status === 'FINISHED',
      });
      console.log(`[fullenrich] ${id} done — ${payload.cost?.credits ?? '?'} credits`);
      results.push(...payload.data.map(flattenContact));
    } else {
      console.log(`[fullenrich] webhook delivered to your URL — collect ${id} from your receiver`);
    }
  }

  if (results.length) {
    await writeCsv(flags.out, results, [
      'first_name', 'last_name', 'linkedin_url',
      'email', 'email_status', 'phone', 'company_domain',
    ]);
    console.log(`[fullenrich] wrote ${results.length} enriched rows to ${flags.out}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
