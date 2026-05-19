#!/usr/bin/env node
/**
 * fullenrich-content-engagers — engagers to ICP-qualified, enriched CSV.
 *
 * Two input modes:
 *   1. LinkedIn post URL (scrapes engagers via Unipile)
 *      node scripts/run.mjs <linkedin-post-url-or-post-id> [flags]
 *   2. CSV of contacts (skip Unipile entirely)
 *      node scripts/run.mjs --csv path/to/leads.csv [flags]
 *
 * Flags: [--out path.csv] [--icp config/icp.json] [--threshold 50]
 *        [--max <N>] [--max-credits <N>] [--dry-run] [--yes]
 *
 * Required env (URL mode):  FULLENRICH_API_KEY, UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID
 * Required env (CSV mode):  FULLENRICH_API_KEY
 *
 * Setup before first run:
 *   cd .claude/skills/fullenrich-content-engagers
 *   npm install
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UnipileClient } from 'unipile-node-sdk';
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
import { writeCsv, readCsv } from './lib/csv.mjs';
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
    csv: null,
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

function getUnipile() {
  for (const k of ['UNIPILE_API_KEY', 'UNIPILE_DSN', 'UNIPILE_ACCOUNT_ID']) {
    if (!process.env[k]) die(`${k} not set`);
  }
  return {
    client: new UnipileClient(process.env.UNIPILE_DSN, process.env.UNIPILE_API_KEY),
    accountId: process.env.UNIPILE_ACCOUNT_ID,
    dsn: process.env.UNIPILE_DSN,
    apiKey: process.env.UNIPILE_API_KEY,
  };
}

/**
 * Resolve a LinkedIn post URL/URN/ID into the format Unipile expects.
 *
 * Unipile's getPost accepts post URNs (urn:li:share:NNN, urn:li:activity:NNN,
 * urn:li:ugcPost:NNN) but NOT raw URLs. The web URL slug `/posts/{slug}-{id}-{trk}`
 * embeds the SHARE id (not the activity id); calling Unipile with that bare
 * number fails, but `urn:li:share:{id}` works (verified live 2026-05-11).
 *
 * Verified handling:
 *   https://www.linkedin.com/posts/{slug}-share-{NNN}-{trk}  -> urn:li:share:NNN
 *   urn:li:share:NNN                                          -> urn:li:share:NNN
 *   urn:li:activity:NNN                                       -> urn:li:activity:NNN
 *   urn:li:ugcPost:NNN                                        -> urn:li:ugcPost:NNN
 *   raw numeric (assumed share id)                            -> urn:li:share:NNN
 */
function extractPostId(urlOrId) {
  const urn = urlOrId.match(/urn:li:(activity|share|ugcPost):(\d{10,})/);
  if (urn) return `urn:li:${urn[1]}:${urn[2]}`;
  if (/^\d{15,}$/.test(urlOrId)) return `urn:li:share:${urlOrId}`;
  // Web URL with embedded share id: /posts/.../share-NNN-tracking
  const sharePattern = urlOrId.match(/-share[-:](\d{15,})/);
  if (sharePattern) return `urn:li:share:${sharePattern[1]}`;
  // Fallback: longest run of digits, assume share id (the URL conventions
  // we've seen all expose the share id in the slug).
  const all = [...urlOrId.matchAll(/(\d{15,})/g)].map(m => m[1]);
  if (all.length) return `urn:li:share:${all.sort((a, b) => b.length - a.length)[0]}`;
  return urlOrId;
}

/**
 * Resolve a LinkedIn post URL OR a raw post_id/social_id into a {social_id, post}.
 */
async function resolvePost(u, urlOrId) {
  const postId = extractPostId(urlOrId);
  const post = await u.client.users.getPost({ account_id: u.accountId, post_id: postId });
  return { social_id: post.social_id || post.id || postId, post };
}

async function listAllComments(u, postId, maxPages) {
  let all = [];
  let cursor;
  let pages = 0;
  do {
    const page = await u.client.users.getAllPostComments({
      account_id: u.accountId,
      post_id: postId,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    if (page.items) all = all.concat(page.items);
    cursor = page.cursor || null;
    pages++;
  } while (cursor && pages < maxPages);
  return all;
}

/**
 * Reactions: the SDK doesn't expose listing reactions, so raw REST.
 * First page: ?account_id=X&limit=N (no cursor).
 * Subsequent: ?cursor=X only (no account_id/limit).
 * Cursor lives in data.paging.cursor.
 */
async function listAllReactions(u, postId, maxPages) {
  let all = [];
  let cursor;
  let pages = 0;
  do {
    let qs;
    if (cursor) qs = new URLSearchParams({ cursor });
    else qs = new URLSearchParams({ account_id: u.accountId, limit: '100' });
    const url = `${u.dsn}/api/v1/posts/${encodeURIComponent(postId)}/reactions?${qs}`;
    const r = await fetch(url, { headers: { 'X-API-KEY': u.apiKey, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`reactions GET ${r.status}: ${await r.text()}`);
    const data = await r.json();
    if (data.items) all = all.concat(data.items);
    const raw = data.paging?.cursor ?? data.cursor ?? null;
    cursor = typeof raw === 'string' ? raw
           : (raw && typeof raw === 'object' && Object.keys(raw).length) ? JSON.stringify(raw)
           : null;
    pages++;
  } while (cursor && pages < maxPages);
  return all;
}

/**
 * Engager records from comments/reactions have varying shapes. Normalize to
 * the FullEnrich contact shape so ICP scoring + enrichment work uniformly.
 *
 * Common Unipile author fields:
 *   author: { first_name, last_name, public_identifier, profile_url, headline }
 *   author_details: { first_name, last_name, headline, ... } (sometimes nested deeper)
 */
function engagerToContact(raw) {
  const a = raw.author || raw.actor || raw.author_details || raw;
  const fn = a.first_name || (a.name || '').split(' ')[0] || '';
  const ln = a.last_name || (a.name || '').split(' ').slice(1).join(' ') || '';
  const slug = a.public_identifier || a.publicIdentifier || '';
  const profileUrl = a.profile_url || a.profileUrl || (slug ? `https://www.linkedin.com/in/${slug}` : '');
  return {
    first_name: String(fn).trim(),
    last_name: String(ln).trim(),
    linkedin_url: profileUrl,
    title: a.headline || a.title || '',
    headline: a.headline || '',
    company_name: a.company || a.current_company || '',
    domain: '',
    enrich_fields: ['contact.work_emails', 'contact.phones'],
    custom: { source: 'fullenrich-content-engagers' },
  };
}

/**
 * Pick the first non-empty value from a CSV row by trying header aliases
 * case-insensitively. CSVs from different tools (PhantomBuster, Evaboot,
 * Sales Navigator, manual exports) use wildly inconsistent column names —
 * this absorbs the variation so the caller doesn't have to pre-clean.
 */
function pickField(row, aliases) {
  const lowerMap = {};
  for (const k of Object.keys(row)) lowerMap[k.toLowerCase().trim()] = row[k];
  for (const a of aliases) {
    const v = lowerMap[a.toLowerCase()];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

/**
 * Map a raw CSV row to the same contact shape engagerToContact() produces,
 * so the downstream ICP + enrichment pipeline is unchanged.
 */
function csvRowToContact(row) {
  let first = pickField(row, ['first_name', 'firstname', 'first name', 'given_name']);
  let last  = pickField(row, ['last_name', 'lastname', 'last name', 'surname', 'family_name']);
  if (!first || !last) {
    const full = pickField(row, ['full_name', 'fullname', 'name']);
    if (full) {
      const parts = full.split(/\s+/);
      if (!first) first = parts[0] || '';
      if (!last)  last  = parts.slice(1).join(' ') || '';
    }
  }
  const linkedin_url = pickField(row, [
    'linkedin_url', 'linkedin', 'profile_url', 'profileurl',
    'profile_link', 'profilelink', 'profile link', 'linkedinurl',
    'linkedin profile', 'linkedin_profile_url', 'linkedinprofileurl',
    'profile url', 'linkedin url',
  ]);
  const title = pickField(row, [
    'title', 'job_title', 'jobtitle', 'headline', 'position',
    'current_position', 'job title', 'occupation',
  ]);
  const company_name = pickField(row, [
    'company', 'company_name', 'companyname', 'current_company',
    'organization', 'employer',
  ]);
  const domain = pickField(row, ['domain', 'company_domain', 'website']);
  return {
    first_name: first,
    last_name: last,
    linkedin_url,
    title,
    headline: title,
    company_name,
    domain,
    enrich_fields: ['contact.work_emails', 'contact.phones'],
    custom: { source: 'fullenrich-content-engagers:csv' },
  };
}

/**
 * A contact is enrichable iff it has a first_name AND at least one of
 * linkedin_url or company_name — FullEnrich needs at least one of those
 * anchors to attempt enrichment.
 */
function isEnrichable(c) {
  return Boolean(c.first_name && (c.linkedin_url || c.company_name));
}

/**
 * Dedupe by linkedin_url when present, otherwise by name+company. Caller
 * is responsible for filtering to isEnrichable() first, so this function
 * can be used solely to measure duplicates (not duplicates+invalids).
 */
function dedupeContacts(contacts) {
  const seen = new Map();
  for (const c of contacts) {
    const key = c.linkedin_url
      ? c.linkedin_url.toLowerCase()
      : `${c.first_name}|${c.last_name}|${c.company_name}`.toLowerCase();
    seen.set(key, c);
  }
  return [...seen.values()];
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));

  if (!process.env.FULLENRICH_API_KEY) die('FULLENRICH_API_KEY not set');
  if (!flags.csv && !positional[0]) {
    die('Usage: node scripts/run.mjs <linkedin-post-url-or-post-id> OR --csv <path> [flags]');
  }

  const credits = await getCredits();
  console.log(`[fullenrich] credit balance: ${credits.balance}`);

  let engagers;
  let sourceLabel;

  if (flags.csv) {
    console.log(`[csv] reading ${flags.csv}...`);
    const rows = await readCsv(flags.csv);
    const mapped = rows.map(csvRowToContact);
    const valid = mapped.filter(isEnrichable);
    const droppedMissing = rows.length - valid.length;
    let unique = dedupeContacts(valid);
    const droppedDupes = valid.length - unique.length;
    const maxCap = parseInt(flags.max, 10);
    let cappedOff = 0;
    if (maxCap && unique.length > maxCap) {
      cappedOff = unique.length - maxCap;
      unique = unique.slice(0, maxCap);
    }
    engagers = unique;
    console.log(`[csv] ${rows.length} rows -> ${engagers.length} usable contacts (dropped: ${droppedMissing} missing first_name+(url|company), ${droppedDupes} duplicates, ${cappedOff} cap-trimmed)`);
    sourceLabel = `CSV ${flags.csv}`;
  } else {
    const postArg = positional[0];
    const u = getUnipile();

    console.log('[unipile] resolving post...');
    const { social_id, post } = await resolvePost(u, postArg);
    console.log(`[unipile] social_id: ${social_id}`);
    console.log(`[unipile] reactions: ~${post.reaction_counter ?? '?'}, comments: ~${post.comment_counter ?? '?'}`);

    const maxPages = Math.max(1, Math.ceil(parseInt(flags.max, 10) / 100));
    console.log('[unipile] fetching reactions + comments...');
    const [reactions, comments] = await Promise.all([
      listAllReactions(u, social_id, maxPages).catch(e => { console.error('[unipile] reactions failed:', e.message); return []; }),
      listAllComments(u, social_id, maxPages).catch(e => { console.error('[unipile] comments failed:', e.message); return []; }),
    ]);
    console.log(`[unipile] ${reactions.length} reactions + ${comments.length} comments`);

    engagers = dedupeContacts([...reactions, ...comments].map(engagerToContact).filter(isEnrichable));
    console.log(`[unipile] ${reactions.length + comments.length} engagements -> ${engagers.length} unique engagers`);
    sourceLabel = `post ${social_id}`;
  }

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
    label: `Enrich ${contacts.length} ICP-qualified engagers from ${sourceLabel}`,
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
