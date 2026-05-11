#!/usr/bin/env node
/**
 * fullenrich-event-attendees — turn LinkedIn event attendees into an SDR-ready CSV.
 *
 * TWO INPUT MODES:
 *
 *   1. CSV mode (default, recommended):
 *      node scripts/run.mjs --input attendees.csv [--out leads.csv]
 *      Bring your own attendee export from PhantomBuster, Evaboot, Sales Navigator,
 *      or any CSV with columns the script can map. See README for header conventions.
 *
 *   2. Apify mode (run an actor you've configured):
 *      node scripts/run.mjs --event-url https://www.linkedin.com/events/<id>/
 *                            --actor <user>/<actor-slug>
 *      Requires APIFY_TOKEN, plus LinkedIn cookies (LINKEDIN_LI_AT, LINKEDIN_JSESSIONID,
 *      LINKEDIN_USER_AGENT) for actors that need authenticated LinkedIn sessions.
 *      The skill does not bundle an Apify actor — pick one in the Apify Store and
 *      configure its input via --actor-input '{"...":"..."}' if its keys differ from
 *      the defaults.
 *
 * Both modes converge on the same FullEnrich enrichment pipeline.
 *
 * Required env (always): FULLENRICH_API_KEY
 * Required env (Apify mode): APIFY_TOKEN
 * Common env (Apify mode, depending on actor): LINKEDIN_LI_AT, LINKEDIN_JSESSIONID, LINKEDIN_USER_AGENT
 */

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
import { writeCsv, readCsv } from '../../_shared/fullenrich/csv.mjs';

function parseArgs(argv) {
  const flags = {
    // CSV mode
    input: null,
    // Apify mode
    'event-url': null,
    actor: null,
    'actor-input': null,
    // Output + safeguards (both modes)
    out: 'attendees.csv',
    max: 250,
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
    }
  }
  return flags;
}

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }

function pickField(row, ...candidates) {
  for (const c of candidates) {
    const v = row[c];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/**
 * Map a CSV row (from any common LinkedIn-export tool) to a FullEnrich contact.
 * Tries common header variants from PhantomBuster, Evaboot, Sales Navigator,
 * manual paste, and the Apify actor outputs we support.
 */
function rowToContact(row) {
  const fullName = pickField(row, 'Full Name', 'fullName', 'name', 'Name');
  const [first0, ...rest0] = fullName.split(' ');

  return {
    first_name: pickField(row, 'First Name', 'firstName', 'first_name') || first0 || '',
    last_name: pickField(row, 'Last Name', 'lastName', 'last_name') || rest0.join(' ') || '',
    linkedin_url: pickField(row,
      'Profile URL', 'profileUrl', 'profile_url',
      'LinkedIn URL', 'linkedinUrl', 'linkedin_url',
      'linkedinProfileUrl', 'profileLink', 'url'
    ),
    company_name: pickField(row, 'Company', 'company', 'companyName', 'company_name', 'currentCompany'),
    domain: pickField(row, 'Company Domain', 'companyDomain', 'domain', 'Website'),
    title: pickField(row, 'Title', 'title', 'currentJobTitle', 'jobTitle', 'Position', 'headline'),
    enrich_fields: ['contact.work_emails', 'contact.phones'],
    custom: { source: 'fullenrich-event-attendees' },
  };
}

/**
 * Random delay between min and max ms. Used between Apify run-status polls
 * to be polite, not because Apify needs it (the actor itself handles humanlike pacing
 * on the LinkedIn side).
 */
function jitter(min, max) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise(r => setTimeout(r, ms));
}

async function readCsvMode(flags) {
  const rows = await readCsv(flags.input);
  console.log(`[csv] parsed ${rows.length} rows from ${flags.input}`);
  return rows.map(rowToContact).filter(c => c.first_name && c.last_name);
}

async function runApifyActor({ actor, eventUrl, actorInput, token }) {
  const baseInput = actorInput
    ? JSON.parse(actorInput)
    : {
        // Default shape suitable for actors that take event_urls + cookies. Each user
        // overrides via --actor-input '{ ...exact keys for your actor... }'.
        event_urls: [eventUrl],
        cookies: [
          process.env.LINKEDIN_LI_AT && { name: 'li_at', value: process.env.LINKEDIN_LI_AT },
          process.env.LINKEDIN_JSESSIONID && { name: 'JSESSIONID', value: process.env.LINKEDIN_JSESSIONID },
        ].filter(Boolean),
        userAgent: process.env.LINKEDIN_USER_AGENT || 'Mozilla/5.0',
      };

  const url = `https://api.apify.com/v2/acts/${actor.replace('/', '~')}/runs?token=${token}`;
  const startRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(baseInput),
  });
  if (!startRes.ok) die(`Apify actor start failed: ${startRes.status} ${await startRes.text()}`);
  const { data: run } = await startRes.json();
  console.log(`[apify] run started: ${run.id}, polling for completion...`);

  const runUrl = `https://api.apify.com/v2/actor-runs/${run.id}?token=${token}`;
  while (true) {
    await jitter(4000, 12_000);
    const r = await fetch(runUrl);
    const { data } = await r.json();
    process.stdout.write(`.`);
    if (['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(data.status)) {
      process.stdout.write('\n');
      if (data.status !== 'SUCCEEDED') die(`Apify run ${data.status}`);
      const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${data.defaultDatasetId}/items?token=${token}`);
      const items = await itemsRes.json();
      console.log(`[apify] scraped ${items.length} attendees`);
      return items;
    }
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!process.env.FULLENRICH_API_KEY) die('FULLENRICH_API_KEY not set');

  const credits = await getCredits();
  console.log(`[fullenrich] credit balance: ${credits.balance}`);

  let allContacts;
  let sourceLabel;

  if (flags.input) {
    sourceLabel = `CSV file ${flags.input}`;
    allContacts = await readCsvMode(flags);
  } else if (flags['event-url']) {
    if (!flags.actor) die('--event-url requires --actor <user/slug>. Bring your own Apify actor; see README.');
    if (!process.env.APIFY_TOKEN) die('APIFY_TOKEN not set (required for Apify mode)');
    sourceLabel = `Apify actor ${flags.actor} on ${flags['event-url']}`;
    const items = await runApifyActor({
      actor: flags.actor,
      eventUrl: flags['event-url'],
      actorInput: flags['actor-input'],
      token: process.env.APIFY_TOKEN,
    });
    allContacts = items.map(rowToContact).filter(c => c.first_name && c.last_name);
  } else {
    die('Provide either --input <attendees.csv> or --event-url <linkedin-event-url> --actor <user/slug>. See README.');
  }

  console.log(`[contacts] ${allContacts.length} valid attendees from ${sourceLabel}`);

  const maxAttendees = parseInt(flags.max, 10) || 250;
  const maxCredits = parseInt(flags['max-credits'], 10) || 500;
  let contacts = allContacts.slice(0, maxAttendees);
  let estimated = estimateCost(contacts);

  if (estimated > maxCredits) {
    const ratio = maxCredits / estimated;
    contacts = contacts.slice(0, Math.floor(contacts.length * ratio));
    estimated = estimateCost(contacts);
    console.log(`[fullenrich] capped at --max-credits=${maxCredits} → enriching ${contacts.length} of ${allContacts.length} (~${estimated} credits)`);
  } else {
    console.log(`[fullenrich] selected ${contacts.length} of ${allContacts.length} attendees (~${estimated} credits)`);
  }

  if (flags['dry-run']) {
    const dryPath = flags.out.replace(/\.csv$/, '-dryrun.csv');
    await writeCsv(dryPath, contacts);
    console.log(`[dry-run] wrote ${contacts.length} contacts to ${dryPath} without enriching. Estimated full-run cost: ${estimated} credits.`);
    return;
  }

  const ok = await confirmSpend({
    expected: estimated,
    balance: credits.balance,
    label: `Enrich ${contacts.length} attendees from ${sourceLabel}`,
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
      name: `event-attendees ${new Date().toISOString().slice(0, 10)} (${batch.length})`,
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
