# Country Footprint Enrichment — Recipe

**Goal:** for a target company, produce a verified count of countries it operates in, with a cited source URL. Used in ICP filters that gate on multi-country presence (e.g. datascalehr's ≥10-country threshold).

**Concrete > exact.** A defensible lower bound from a citable source is better than a precise but unverifiable number. This recipe never relies on LLM prior knowledge for the count itself — only for parsing, validation, and disambiguation.

## Why this exists

When we first ran C9 (SD Worx Customers Campaign, 2026-05) we relied on Sonnet's prior knowledge for company employee count and country footprint. The numbers looked plausible but were unverifiable, and the user pushed back: "If we reach out to people who we 'assume' are SD Worx customers rather than knowing, that can harm our and the client's reputation." The cascade below was developed in response, smoke-tested on Sanofi, and applied to 12 candidates — see `scripts/c9-country-footprint.ts` for the canonical implementation.

## Source ranking (highest authority first)

| Tier | Source | What it gives | Caveat |
|---|---|---|---|
| A | Company's own annual report / 10-K | Audited country count, often with a list | Slow if you have to scrape PDFs |
| A | Company's own About / Investor / Locations page | Stated "operates in X countries" | What the company chooses to publish; usually conservative |
| B | Clay custom data point ("Country Footprint") | LLM-researched answer with citation | Costs Clay credits; can cite imperfect sources |
| B | PredictLeads `job_opening` signals (location-tagged) | Concrete proof of operations in N countries via active job posts | Requires PredictLeads creds + caching |
| C | LinkedIn `locations[]` (via Unipile) | Distinct countries in displayed offices | **Lower bound only** — companies display only some offices |
| C | Crustdata `screener/company` | `hq_country` + `largest_headcount_country` only | Two countries max; NOT a footprint signal |

Don't trust LLM prior knowledge for the count itself. Use it only to validate that an extracted snippet is making a claim about the right company (see "Validation step" below).

## Cascade (in order)

### 1. Firecrawl search + regex extraction (primary)

For each company (`displayName`, `domain`):

```
queries = [
  `site:${domain} ("operates in" OR "presence in" OR "active in" OR "offices in") countries`,
  `"${displayName}" ("operates in" OR "operations in" OR "present in") countries`,
]
```

For each result: try regex extraction on the snippet first (free). If no match and the URL is on the company's own domain, scrape the page and extract from the full markdown.

**Regex** (see `scripts/c9-country-footprint.ts` for the live patterns):
- `(operate(s|d)?|operations|present|presence|offices?|active|employees?) in (over|more than|nearly|~)? (\d{1,3})\+? countries?`
- Reverse form: `(\d{1,3})\+? countries (across|worldwide|globally|where we operate|of operations)`

### 2. Validation step (mandatory) — the part that actually saves you

The regex will pick up "X countries" from any snippet, including ones about *other* companies (vendors, partners, news subjects, rating agencies). Smoke-test history showed 3/12 false positives on the first pass. Always validate.

**Method:** for each candidate claim `(n, snippet, url)`, ask Claude (Sonnet is fine):

> "Is this snippet making a country-footprint claim ABOUT the target company? Reject if the subject is a partner / vendor / rating agency / news subject mentioned on the page."

Expected JSON: `{ validates: boolean, subject_company: string, reason: string }`.

Drop unvalidated claims. From the survivors, prefer:
1. Claims hosted on the company's own domain (`new URL(c.url).hostname.endsWith(domain)`)
2. Highest concrete number (more authoritative companies state higher counts on their own materials)

### 3. LinkedIn `locations[]` lower bound (fallback)

Use Unipile (`users.getCompanyProfile`, Doug Pearson account per the read-only rule). Count distinct values of `locations[].country`. Treat as a *lower bound only* — if it shows ≥10, the company is concrete-pass on the threshold; if it shows <10, the company is **inconclusive**, not a fail.

### 4. Clay custom data point (paid fallback)

When Firecrawl finds nothing and LinkedIn shows <10, fall back to Clay's `find-and-enrich-company` with a Custom data point like:

> "Number of countries the company has operations or offices in, with a list of those countries. Cite the official source (annual report, About page) where this is stated."

Costs 1 Clay credit per company. Returns a researched answer with citation. Async — poll via `get-task`.

## What to record per company

```jsonl
{
  "company_name": "...",
  "domain_used": "...",
  "final_country_count": 100,
  "final_source": "firecrawl" | "linkedin_lowerbound" | "clay" | "inconclusive",
  "cited_url": "https://...",
  "snippet": "...",
  "passes_country_threshold": true,
  "all_claims": [{ "n": 100, "url": "...", "validated": true, "validation_reason": "..." }, ...]
}
```

The `cited_url` and `snippet` are the audit trail. Keep them so you can defend any list against "where did this number come from."

## Known failure modes & how to handle them

- **Subsidiary case studies** (e.g. "Mercedes-Benz Luxembourg S.A. uses SD Worx") — the case study's named entity may not be the parent. The parent's country footprint is the right ICP unit, but outreach should target the entity that lived through the implementation, not necessarily HQ.
- **Subsidiary-only numbers** (e.g. "Mercedes-Benz Mobility operates in 35 countries", "Würth's tools business unit operates in 43 countries") — these are *under-counts* of the parent group's true footprint. Acceptable because they're concrete lower bounds, but flag in the report so the reader knows the actual figure is higher.
- **Anonymized case studies** (e.g. SD Worx's "47-providers-1-global-paint" customer with 50K emp / 45 ctry but no name) — skip until externally identified. Don't guess.
- **Domain ambiguity** (e.g. `sk.com` returns "John Sisk & Son" not "SK Group") — when a domain returns an unexpected company name, log a manual override. Pattern in `data/scrapes/c9-sdworx-customers/domain-overrides.json`.

## Reference implementation

- `scripts/c9-country-footprint.ts` — canonical script (Firecrawl → LLM validate → LinkedIn fallback)
- `scripts/c9-smoke-firecrawl-about.ts` — single-domain smoke test (use to debug extraction on a new company)
- `scripts/c9-smoke-linkedin-locations.ts` — single-domain LinkedIn smoke test

When this recipe is run for a new client / campaign, copy the C9 scripts as a starting point and adjust the target slugs and output paths. If the same logic gets used a third time, promote it to a reusable function in `src/lib/enrichment/country-footprint.ts` and have the campaign scripts call it.

## See also

- `.claude/rules/enrichment.md` — provider rules (rate limits, credit tracking, error handling)
- `~/.gtm-os/tenants/<tenant>/qualification_rules.md` — tenant-specific country thresholds
