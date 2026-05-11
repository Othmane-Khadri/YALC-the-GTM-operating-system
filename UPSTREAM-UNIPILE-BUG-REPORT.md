# Bug Report: Unipile LinkedIn integration — two issues in `src/lib/services/unipile.ts`

**Target repo:** `YALC-the-GTM-operating-system` (upstream)
**Reporter:** David Small (earleads internal fork)
**Date:** 2026-04-23
**Files affected:** `src/lib/services/unipile.ts`
**Downstream effects:** `src/lib/providers/builtin/unipile-provider.ts`, any script or workflow step that searches LinkedIn or enriches a LinkedIn profile via Unipile

---

## TL;DR

Two related bugs in the Unipile service wrapper make the LinkedIn integration effectively non-functional for any real use case. Both are small fixes (one rewires query parameters, one adds an optional argument). Both are fixed in our internal fork — diffs are at the bottom of this doc.

---

## Bug 1 — `searchLinkedIn()` always returns HTTP 400

### What happens
Every call to `unipileService.searchLinkedIn()` fails immediately:

```
Unipile LinkedIn search failed (400): {"status":400,"type":"errors/invalid_parameters","title":"Invalid parameters","detail":"One or more request parameters are invalid or missing..."}
```

### Why
The REST request sends `account_id` in the JSON body and uses the field name `keyword` (singular). The Unipile API expects `account_id` as a **query string** parameter on the URL, and the field to be named **`keywords`** (plural).

This bug is already noted in a comment inside `scripts/claude-code-attendee-report.ts:266` in the internal fork but was never fixed in the service layer upstream.

### What this blocks — in plain English

- **The `UnipileProvider` in the workflow/agent framework (`src/lib/providers/builtin/unipile-provider.ts`) is broken in its search mode.** Any user-facing agent step that asks the system to "find LinkedIn profiles matching X" through this provider returns an HTTP 400 error instead of results. The provider is advertised as supporting `search` and `enrich`, but `search` has never worked.
- **Any CLI command, script, or workflow that uses `unipileService.searchLinkedIn()` fails at runtime.** There is no safe caller in the current codebase.
- **Downstream scripts have had to inline their own fetch calls to work around this** (see `scripts/claude-code-attendee-linkedin-retry.ts` — it bypasses the service entirely). This creates divergent error handling, duplicate request logic, and means the advertised service surface is lying about what works.

### Fix

```diff
--- a/src/lib/services/unipile.ts
+++ b/src/lib/services/unipile.ts
@@ -32,18 +32,18 @@
     // The SDK doesn't expose a LinkedIn search method — use REST API directly
     const dsn = process.env.UNIPILE_DSN!
     const apiKey = process.env.UNIPILE_API_KEY!
-    const url = `${dsn}/api/v1/linkedin/search`
+    const url = `${dsn}/api/v1/linkedin/search?account_id=${encodeURIComponent(accountId)}`
     const res = await fetch(url, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'X-API-KEY': apiKey,
+        accept: 'application/json',
       },
       body: JSON.stringify({
-        account_id: accountId,
         api: 'classic',
         category: 'people',
-        keyword: query,
+        keywords: query,
         limit,
       }),
     })
```

---

## Bug 2 — `getProfile()` returns only top-level fields, never sections

### What happens
Calling `unipileService.getProfile(accountId, slug)` returns an object with basic identity fields (name, headline, location, follower count, websites) — but **no** `work_experience`, `education`, `skills`, `summary`, `languages`, or `certifications`.

### Why
The Unipile SDK's `getProfile` input accepts an optional `linkedin_sections` parameter (defined in `node_modules/unipile-node-sdk/dist/types/types/input/input-users.d.ts`) with values like `'experience'`, `'education'`, `'skills'`, an array of them, or `'*'` for all. The service wrapper doesn't expose this parameter, so callers can never request full profile data.

### What this blocks — in plain English

Anything that depends on knowing someone's career details, education, or skills is effectively blocked. Specifically:

- **Lead and candidate qualification** against rubrics that consider years of experience, career progression, or role fit has no data to work with. The system can see someone's current headline but nothing behind it.
- **Verification of headline claims** — e.g. "does this person actually have 5 years of SEO experience?" — is impossible.
- **Age inference** from earliest dated role or graduation year (required for any workflow with an age criterion) can't run.
- **Skills / certifications checks** — e.g. "does this person list React on their profile?" — can't run.
- **Any enrichment step that promises to "get the full profile"** silently returns shallow data. Downstream consumers don't know the data is incomplete and make bad decisions with it.

In practice this means Unipile enrichment is currently just "give me the headline and photo URL", which is already visible on the search result page. The value prop of the enrichment step is lost.

### Fix

```diff
--- a/src/lib/services/unipile.ts
+++ b/src/lib/services/unipile.ts
@@ -24,10 +24,16 @@
   async getAccounts() {
     const c = getClient()
     return c.account.getAll()
   }

-  async getProfile(accountId: string, identifier: string) {
+  async getProfile(
+    accountId: string,
+    identifier: string,
+    sections?: 'experience' | 'education' | 'languages' | 'skills' | 'certifications' | 'about'
+      | Array<'experience' | 'education' | 'languages' | 'skills' | 'certifications' | 'about'>
+      | '*',
+  ) {
     const c = getClient()
-    return c.users.getProfile({ account_id: accountId, identifier })
+    const input: Parameters<typeof c.users.getProfile>[0] = { account_id: accountId, identifier }
+    if (sections) input.linkedin_sections = sections
+    return c.users.getProfile(input)
   }
```

And any caller that needs the full profile passes `'*'`:

```ts
await unipileService.getProfile(accountId, slug, '*')
```

**Suggestion:** consider defaulting `sections` to `'*'` rather than `undefined`. The "I want a shallow profile" case is rare, and silent data loss is a bad default. Would be a one-line change on top of the patch above.

---

## Bonus finding — not a bug, but worth documenting

While investigating Bug 1 we discovered that the `classic` LinkedIn search API (which `searchLinkedIn` hardcodes via `api: 'classic'`) returns redacted placeholder results — profiles named `"LinkedIn Member"` with `public_identifier: null` — for anyone outside the searching account's LinkedIn network.

This is a LinkedIn platform limitation, not a code bug. But it means `searchLinkedIn` in its current `classic` mode is **not viable for broad cold sourcing** — only for searching people the account is already connected to. Two options to surface this:

1. **Document it** in the README or provider docs so users don't waste time debugging empty results.
2. **Expose the `api` parameter** (the SDK accepts `'sales_navigator'` and `'recruiter'` which don't have the network-distance redaction, but require the LinkedIn account to have a Sales Navigator or Recruiter seat). This would let advanced users opt in.

For our internal use case we switched to Firecrawl + Google (`site:linkedin.com/in`) to discover candidate slugs, then used `getProfile` to enrich — works reliably regardless of LinkedIn network distance.

---

## Reproduction

```ts
import { unipileService } from './src/lib/services/unipile'

// Bug 1 — always HTTP 400
await unipileService.searchLinkedIn('<any-unipile-account-id>', 'SEO Specialist', 10)

// Bug 2 — sections are missing even though they exist on the profile
const profile = await unipileService.getProfile('<account-id>', 'some-public-slug')
console.log(Object.keys(profile))
// Expected keys to include: work_experience, education, skills, summary, languages
// Actual: only top-level identity fields
```

---

## Why both fixes matter together

Bug 1 blocks LinkedIn **discovery**. Bug 2 blocks LinkedIn **enrichment**. With both broken, the entire Unipile integration is decorative — no real workflow can use it end-to-end. Fixing both gets the integration back to its advertised capability in `UnipileProvider.capabilities = ['search', 'enrich']`.

Both fixes are additive (no signature changes that break existing callers) and can be applied independently in either order.
