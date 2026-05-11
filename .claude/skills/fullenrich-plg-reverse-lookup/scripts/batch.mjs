#!/usr/bin/env node
/**
 * fullenrich-plg-reverse-lookup (CLI batch mode)
 *
 *   node scripts/batch.mjs --input signups.csv --out enriched.json
 *       [--max-credits <N>] [--dry-run] [--yes]
 *
 * Required env: FULLENRICH_API_KEY
 */

import fs from 'node:fs/promises';
import {
  startReverseEmailLookup,
  getCredits,
  chunk,
  estimateCost,
  confirmSpend,
} from '../../_shared/fullenrich/client.mjs';
import {
  fetchFromWebhookSite,
  createWebhookSiteToken,
} from '../../_shared/fullenrich/webhook.mjs';
import { readCsv } from '../../_shared/fullenrich/csv.mjs';

function parseArgs(argv) {
  const flags = {
    input: null,
    out: 'enriched.json',
    'max-credits': 100,
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
    }
  }
  return flags;
}

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readInput(inputPath) {
  if (!inputPath) die('--input required (csv or json file with email field)');
  const text = await fs.readFile(inputPath, 'utf8');
  if (inputPath.endsWith('.json')) {
    const arr = JSON.parse(text);
    return arr.map(o => ({ email: o.email, custom: o.custom || {} }));
  }
  const rows = await readCsv(inputPath);
  return rows.map(r => ({ email: r.email || r.Email || r.EMAIL || '', custom: { ...r } }));
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!process.env.FULLENRICH_API_KEY) die('FULLENRICH_API_KEY not set');

  const credits = await getCredits();
  console.log(`[fullenrich] credit balance: ${credits.balance}`);

  const raw = await readInput(flags.input);
  const emails = [...new Set(raw.map(r => r.email.trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  const records = emails.map(email => ({ email, custom: { source: 'fullenrich-plg-reverse-lookup' } }));
  console.log(`[input] ${raw.length} rows -> ${emails.length} unique valid emails`);

  const maxCredits = parseInt(flags['max-credits'], 10) || 100;
  let toLookup = records;
  let estimated = estimateCost(toLookup.map(r => ({ enrich_fields: ['contact.work_emails'] })));
  if (estimated > maxCredits) {
    toLookup = toLookup.slice(0, maxCredits);
    estimated = toLookup.length;
    console.log(`[fullenrich] capped at --max-credits=${maxCredits} → looking up ${toLookup.length} emails (~${estimated} credits)`);
  } else {
    console.log(`[fullenrich] looking up ${toLookup.length} emails (~${estimated} credits)`);
  }

  if (flags['dry-run']) {
    const dryPath = flags.out.replace(/\.json$/, '-dryrun.json');
    await fs.writeFile(dryPath, JSON.stringify(toLookup, null, 2));
    console.log(`[dry-run] wrote ${toLookup.length} email candidates to ${dryPath}. Estimated full-run cost: ${estimated} credits.`);
    return;
  }

  const ok = await confirmSpend({
    expected: estimated,
    balance: credits.balance,
    label: `Reverse-lookup ${toLookup.length} signup emails`,
    yes: flags.yes,
  });
  if (!ok) process.exit(2);

  let webhookUuid = null;
  let webhookUrl = process.env.FULLENRICH_WEBHOOK_URL;
  if (!webhookUrl) {
    const t = await createWebhookSiteToken();
    webhookUrl = t.url; webhookUuid = t.uuid;
    console.log(`[webhook] using webhook.site: ${webhookUrl}`);
  }

  const enrichmentIds = [];
  for (const batch of chunk(toLookup, 100)) {
    const { enrichment_id } = await startReverseEmailLookup({
      name: `plg-reverse ${new Date().toISOString().slice(0, 10)} (${batch.length})`,
      webhook_url: webhookUrl,
      data: batch,
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
      results.push(...payload.data);
    }
  }

  await fs.writeFile(flags.out, JSON.stringify(results, null, 2));
  console.log(`[fullenrich] wrote ${results.length} results to ${flags.out}`);
}

main().catch(e => { console.error(e); process.exit(1); });
