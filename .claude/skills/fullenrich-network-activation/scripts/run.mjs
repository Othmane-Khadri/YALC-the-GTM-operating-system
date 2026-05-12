#!/usr/bin/env node
/**
 * fullenrich-network-activation — LinkedIn Connections.csv to ICP-ranked, enriched lead list.
 *
 *   node scripts/run.mjs <Connections.csv>
 *       [--out path.csv] [--icp config/icp.json] [--threshold 50]
 *       [--max-credits <N>] [--dry-run] [--yes]
 *
 * Required env: FULLENRICH_API_KEY
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startBulkEnrich,
  getCredits,
  flattenContact,
  chunk,
  estimateCost,
  confirmSpend,
} from './lib/fullenrich-client.mjs';
import {
  fetchFromWebhookSite,
  createWebhookSiteToken,
} from './lib/fullenrich-webhook.mjs';
import { writeCsv, parseCsv } from './lib/csv.mjs';
import { loadIcp, scoreRow } from './icp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const positional = [];
  const flags = {
    out: 'priority-network.csv',
    icp: path.join(__dirname, '..', 'config', 'icp.json'),
    threshold: 50,
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

/**
 * LinkedIn's Connections.csv has a "Notes:" preamble before the actual header row.
 * Strip everything until the line that starts with "First Name".
 */
async function readLinkedInCsv(filePath) {
  let text = await fs.readFile(filePath, 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => /^First Name/i.test(l));
  if (headerIdx === -1) die('Could not find "First Name" header row in CSV. Is this a LinkedIn Connections export?');
  return parseCsv(lines.slice(headerIdx).join('\n'));
}

function rowToContact(row) {
  const first = row['First Name'] || '';
  const last = row['Last Name'] || '';
  const url = row['URL'] || '';
  const position = row['Position'] || '';
  const company = row['Company'] || '';
  const email = row['Email Address'] || '';
  return {
    first_name: first.trim(),
    last_name: last.trim(),
    linkedin_url: url.trim(),
    title: position.trim(),
    headline: position.trim(),
    company_name: company.trim(),
    domain: '',
    existing_email: email.trim(),
    enrich_fields: ['contact.work_emails', 'contact.phones'],
    custom: { source: 'fullenrich-network-activation' },
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) die('Usage: node scripts/run.mjs <Connections.csv> [flags]');
  if (!process.env.FULLENRICH_API_KEY) die('FULLENRICH_API_KEY not set');

  const credits = await getCredits();
  console.log(`[fullenrich] credit balance: ${credits.balance}`);

  const rows = await readLinkedInCsv(inputPath);
  console.log(`[csv] parsed ${rows.length} connections`);

  const all = rows.map(rowToContact).filter(c => c.first_name && c.last_name);
  const icp = await loadIcp(flags.icp);
  const threshold = parseInt(flags.threshold, 10) || 50;
  const scored = all.map(e => ({ ...e, ...scoreRow(e, icp, { threshold }) }));
  const passed = scored.filter(s => s.passed).sort((a, b) => b.score - a.score);
  const failed = scored.filter(s => !s.passed);
  console.log(`[icp] ${passed.length} passed, ${failed.length} dropped (threshold=${threshold})`);

  await writeCsv(flags.out.replace(/\.csv$/, '-disqualified.csv'), failed.map(f => ({
    first_name: f.first_name, last_name: f.last_name, linkedin_url: f.linkedin_url,
    title: f.title, score: f.score, reasons: f.reasons.join('; '),
  })));

  const needEnrich = passed.filter(c => !c.existing_email);
  console.log(`[fullenrich] ${needEnrich.length} of ${passed.length} qualified connections need enrichment (others already have emails)`);

  const maxCredits = parseInt(flags['max-credits'], 10) || 500;
  let contacts = needEnrich;
  let estimated = estimateCost(contacts);
  if (estimated > maxCredits) {
    const ratio = maxCredits / estimated;
    contacts = contacts.slice(0, Math.floor(contacts.length * ratio));
    estimated = estimateCost(contacts);
    console.log(`[fullenrich] capped at --max-credits=${maxCredits} → enriching ${contacts.length} (~${estimated} credits)`);
  } else {
    console.log(`[fullenrich] enriching ${contacts.length} contacts (~${estimated} credits)`);
  }

  if (flags['dry-run']) {
    const dryPath = flags.out.replace(/\.csv$/, '-dryrun.csv');
    await writeCsv(dryPath, contacts);
    console.log(`[dry-run] wrote ${contacts.length} contacts to ${dryPath}. Estimated full-run cost: ${estimated} credits.`);
    return;
  }

  const ok = await confirmSpend({
    expected: estimated,
    balance: credits.balance,
    label: `Enrich ${contacts.length} ICP-qualified connections from ${inputPath}`,
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
      name: `network-activation ${new Date().toISOString().slice(0, 10)} (${batch.length})`,
      webhook_url: webhookUrl,
      data: batch.map(({ score, passed, reasons, existing_email, ...c }) => c),
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
