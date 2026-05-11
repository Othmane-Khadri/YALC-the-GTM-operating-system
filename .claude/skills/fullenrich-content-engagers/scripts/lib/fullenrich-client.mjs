/**
 * FullEnrich API v2 client. Shared across the Yalc x FullEnrich skill family.
 *
 * Base URL:    https://app.fullenrich.com/api/v2
 * Auth header: Authorization: Bearer <FULLENRICH_API_KEY>
 *
 * Endpoints implemented:
 *   POST /contact/enrich/bulk         startBulkEnrich(payload)
 *   POST /contact/reverse/email/bulk  startReverseEmailLookup(payload)
 *   GET  /account/credits             getCredits()
 *
 * Webhook payload shape (POSTed back to webhook_url within ~30s):
 *   { id, name, status: "FINISHED", cost: { credits },
 *     data: [{ input, custom, contact_info: {
 *       most_probable_work_email: { email, status },
 *       work_emails: [...], personal_emails: [...], phones: [...]
 *     } }] }
 */

const BASE = process.env.FULLENRICH_BASE_URL || 'https://app.fullenrich.com/api/v2';

function authHeaders() {
  const key = process.env.FULLENRICH_API_KEY;
  if (!key) throw new Error('FULLENRICH_API_KEY not set');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function request(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!r.ok) {
    const err = new Error(`FullEnrich ${method} ${path} -> ${r.status}`);
    err.status = r.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

export async function getCredits() {
  return request('GET', '/account/credits');
}

/**
 * Start a bulk enrichment job.
 * @param {object} payload
 * @param {string} payload.name        Human label visible in dashboard
 * @param {string} [payload.webhook_url]
 * @param {object} [payload.webhook_events]  e.g. { contact_finished: "https://..." }
 * @param {Array<object>} payload.data       Up to 100 contacts
 * @returns {Promise<{enrichment_id: string}>}
 */
export async function startBulkEnrich(payload) {
  if (!payload?.data?.length) throw new Error('payload.data required (1-100 contacts)');
  if (payload.data.length > 100) throw new Error('Max 100 contacts per bulk request');
  return request('POST', '/contact/enrich/bulk', payload);
}

/**
 * Start a reverse email lookup job. Returns identity + LinkedIn for each email.
 * @param {object} payload
 * @param {string} payload.name
 * @param {string} [payload.webhook_url]
 * @param {Array<{email: string, custom?: object}>} payload.data
 */
export async function startReverseEmailLookup(payload) {
  if (!payload?.data?.length) throw new Error('payload.data required');
  return request('POST', '/contact/reverse/email/bulk', payload);
}

/**
 * Helper to chunk a contact list into <=100-row bulk requests.
 */
export function* chunk(rows, size = 100) {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

/**
 * Estimate FullEnrich credit cost for a contact list.
 * Per-contact cost depends on which enrich_fields are requested.
 * Defaults reflect FullEnrich's documented pricing as of 2026-05; verify in dashboard.
 */
export function estimateCost(contacts, weights = { 'contact.work_emails': 1, 'contact.personal_emails': 1, 'contact.phones': 2 }) {
  let total = 0;
  for (const c of contacts) {
    const fields = c.enrich_fields || ['contact.work_emails'];
    total += fields.reduce((sum, f) => sum + (weights[f] ?? 1), 0);
  }
  return total;
}

/**
 * Hard-approval gate. Prints a clear cost preview and blocks until the user
 * types "y" or "yes" on stdin. Pass { yes: true } to skip (for non-interactive runs).
 *
 * Skills MUST call this before any credit-spending API request unless --yes is
 * explicitly set by the user. This is the contract advertised in every skill's SKILL.md.
 */
export async function confirmSpend({
  expected,           // estimated credit cost
  balance,            // current account balance (call getCredits() first)
  label = 'this run', // short description shown in the prompt
  yes = false,        // skip the prompt entirely (--yes power-user flag)
} = {}) {
  const remaining = balance - expected;
  console.log('');
  console.log('  ┌─ FullEnrich spend preview ────────────────────');
  console.log(`  │  Action:           ${label}`);
  console.log(`  │  Estimated cost:   ~${expected} credits`);
  console.log(`  │  Current balance:  ${balance} credits`);
  console.log(`  │  After this run:   ~${remaining} credits ${remaining < 0 ? '(INSUFFICIENT — will be capped)' : ''}`);
  console.log('  └────────────────────────────────────────────────');
  console.log('');

  if (yes) { console.log('  [--yes set, skipping interactive confirmation]'); return true; }
  if (expected <= 0) { console.log('  [zero cost, no confirmation needed]'); return true; }
  if (!process.stdin.isTTY) {
    throw new Error('Refusing to spend credits in a non-interactive shell without --yes. Pass --yes to override.');
  }

  process.stdout.write('  Proceed? Type "yes" to continue, anything else to abort: ');
  const answer = await new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    const onData = chunk => {
      buf += chunk;
      if (buf.includes('\n')) { process.stdin.removeListener('data', onData); resolve(buf.trim()); }
    };
    process.stdin.on('data', onData);
  });
  const ok = /^y(es)?$/i.test(answer);
  if (!ok) console.log('  Aborted by user. No credits spent.');
  return ok;
}

/**
 * Extract the most useful flat fields from a webhook contact result.
 */
export function flattenContact(c) {
  const ci = c?.contact_info || {};
  return {
    first_name: c?.input?.first_name ?? '',
    last_name: c?.input?.last_name ?? '',
    full_name: c?.input?.full_name ?? '',
    company_domain: c?.input?.company_domain ?? '',
    linkedin_url: c?.input?.professional_network_url ?? '',
    email: ci.most_probable_work_email?.email ?? ci.work_emails?.[0]?.email ?? ci.personal_emails?.[0]?.email ?? '',
    email_status: ci.most_probable_work_email?.status ?? ci.work_emails?.[0]?.status ?? '',
    phone: ci.phones?.[0]?.number ?? '',
    custom: c?.custom ?? {},
  };
}
