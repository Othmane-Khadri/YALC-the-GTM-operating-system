# Skills Catalog

Skills are the execution primitives of GTM-OS. Each skill is a self-contained operation that can be invoked by the CLI, the orchestrator, or chained together in multi-step workflows.

Skills are provider-agnostic — `find-companies` doesn't know about Crustdata or Firecrawl. It declares what capabilities it needs, and the Provider Registry resolves the best available provider.

## Quick Reference

| Skill | Category | What it does | Key provider |
|-------|----------|-------------|--------------|
| `find-companies` | research | Search companies by criteria | Crustdata |
| `find-people` | research | Search people by title, company, role | Crustdata |
| `find-linkedin` | research | Resolve LinkedIn URLs from name + email | Crustdata |
| `scrape-linkedin` | research | Scrape post likers/commenters | Unipile |
| `competitive-intel` | research | Research competitors (web + data) | Firecrawl + Crustdata |
| `research` | research | Open-ended multi-step web research | Anthropic + Firecrawl |
| `qualify-leads` | analysis | 7-gate ICP qualification scoring | Anthropic |
| `track-campaign` | outreach | Poll providers, advance sequences, sync state | Unipile + Instantly |
| `enrich-leads` | data | Add contact info, tech stack, signals | Crustdata, FullEnrich |
| `export-data` | data | Export results as CSV/JSON | None (local) |
| `personalize` | content | AI-personalize outreach messages | Anthropic + Unipile |
| `email-sequence` | content | Generate email drip sequences | Anthropic |
| `answer-comments` | outreach | Reply to LinkedIn post comments | Unipile |
| `reply-to-comments` | outreach | Template-based LinkedIn replies | Unipile |
| `send-email-sequence` | outreach | Send emails via Instantly | Instantly |
| `multi-channel-campaign` | outreach | LinkedIn + email combined | Unipile + Instantly |
| `orchestrate` | integration | Natural language → multi-step workflow | Anthropic |
| `visualize-campaigns` | analysis | Campaign dashboard in browser | None (local) |
| `monthly-campaign-report` | analysis | Cross-campaign intelligence report | Anthropic |
| `optimize-skill` | analysis | RL-based skill tuning via swipe UI | Anthropic |

## Detailed Descriptions

### Research

#### `find-companies`
Search for companies matching specific criteria — industry, size, location, funding stage.

```
yalc-gtm orchestrate "find 10 SaaS companies in Berlin with 50-200 employees"
```

**Inputs:** `query` (natural language), `count` (default: 10)
**Providers:** Uses Crustdata for structured search, Firecrawl for web search fallback.
**Output:** Company list with name, website, industry, headcount, location.

#### `find-people`
Search for people by title, company, seniority level, and location.

```
yalc-gtm orchestrate "find VP of Engineering at Stripe"
```

**Inputs:** `companies` (array), `titles` (array), `seniorityLevels` (array), `location`, `limit`
**Providers:** Crustdata people search.
**Output:** People list with name, title, company, LinkedIn URL.

#### `scrape-linkedin`
Scrape likers and commenters from a LinkedIn post URL. Optionally auto-qualify results.

```
yalc-gtm leads:scrape-post --url "https://linkedin.com/feed/update/..."
```

**Inputs:** `url`, `type` (likers, commenters, both), `maxPages`, `autoQualify`
**Providers:** Unipile.
**Output:** People list with LinkedIn profile data.

#### `competitive-intel`
Research a competitor — scrape their website, pull company data, analyze positioning.

```
yalc-gtm orchestrate "research Gainsight's positioning and pricing"
```

**Inputs:** `competitor` (URL or name), `enrichWithCrustdata` (boolean)
**Providers:** Firecrawl (web scraping) + Crustdata (company data).
**Output:** Competitor profile with positioning, pricing, strengths, weaknesses.

### Analysis

#### `qualify-leads`
Score and qualify leads against your ICP framework. Each lead gets a 0-100 score with reasoning.

**Inputs:** `resultSetId`, `segment` (optional — qualify against specific ICP segment)
**Providers:** Anthropic (AI scoring against framework + intelligence).
**Output:** Qualified leads with scores and reasons.

The 7-gate pipeline:
1. Title match against ICP roles
2. Company size check
3. Industry alignment
4. Disqualifier screening
5. Signal scoring (buying intent signals, trigger events)
6. Framework fit (positioning alignment)
7. Final composite score

#### `visualize-campaigns`
Launch a visual dashboard showing campaign status, per-lead timelines, and variant performance.

**Inputs:** `campaignId` (optional), `status` filter, `port` (default: 3847)
**Output:** Opens browser dashboard at `http://localhost:3847`

#### `monthly-campaign-report`
Generate a cross-campaign monthly intelligence report analyzing performance, variant winners, and strategic recommendations.

**Inputs:** `month` (YYYY-MM format), `campaignIds` (optional)
**Output:** Structured report with metrics, insights, and next-month recommendations.

#### `optimize-skill`
Reinforcement learning for skills. Generates sample outputs, presents them in a swipe UI, and tunes prompts based on your preferences.

**Inputs:** `skillId`, `samples` (array of sample inputs), `outputType`, `port`
**Output:** Opens swipe UI at localhost. Swipe right = like, left = dislike. Saves tuned prompt.

### Data

#### `enrich-leads`
Enrich leads with additional data — contact info, tech stack, company signals.

**Inputs:** `resultSetId`, `type` (contact, company, tech-stack, full)
**Providers:** Crustdata (company), FullEnrich (contact), Orthogonal (fallback).

#### `export-data`
Export a result set as CSV or JSON. No external provider needed.

**Inputs:** `resultSetId`, `format` (csv, json)
**Output:** File written to `./data/` directory.

### Content

#### `personalize`
AI-personalize an outreach message for a specific lead. Pulls LinkedIn profile, company signals, and intelligence to write a unique message.

**Inputs:** `lead` (object with email, name, company, linkedinUrl), `template`, `enrichWithCrustdata`, `segmentId`
**Providers:** Anthropic + Unipile (LinkedIn profile) + Crustdata (company data).
**Output:** Personalized message text.

#### `email-sequence`
Generate a complete email drip sequence based on your framework, ICP segment, and product context.

**Inputs:** `type` (cold-outreach, nurture, re-engagement, onboarding), `segmentId`, `productContext`, `audienceContext`
**Providers:** Anthropic.
**Output:** Multi-step email sequence with subjects, bodies, and timing.

### Outreach

#### `answer-comments`
Reply to comments on a LinkedIn post. Modes: conversational (AI-generated replies) or lead-magnet (template with personalization).

**Inputs:** `url`, `mode` (conversational, lead-magnet), `template`, `maxReplies`, `dryRun`
**Providers:** Unipile.

#### `reply-to-comments`
Template-based LinkedIn comment replies with personalization tokens. Lower-level than `answer-comments`.

**Inputs:** `url`, `template` (use `{{name}}` for first name), `excludeAuthors`, `maxReplies`, `dryRun`
**Providers:** Unipile.

#### `send-email-sequence`
Send an email sequence via Instantly. Creates the campaign, adds leads, and launches.

**Inputs:** `campaignName`, `leads` (array), `sequences` (array of steps), `dryRun`
**Providers:** Instantly.
**Prerequisite:** At least one email account configured in Instantly.

#### `multi-channel-campaign`
Combined LinkedIn + email campaign. Sends LinkedIn connections via Unipile and email sequences via Instantly.

**Inputs:** `sequencePath` (YAML), `leads`, `linkedinAccountId`, `dryRun`
**Providers:** Unipile + Instantly.

### Integration

#### `orchestrate`
The meta-skill. Takes a natural language request, decomposes it into a multi-step workflow, selects skills and providers, and executes.

```
yalc-gtm orchestrate "find 10 companies matching my ICP, find their decision makers, qualify them, and create a LinkedIn campaign"
```

**Inputs:** `query` (natural language), `autoApprove` (skip confirmation gates)
**Providers:** Anthropic (planning) + whatever the sub-skills need.

This is the most powerful skill — it chains other skills together based on your request and available providers.

## Decision Tree

**"I want to..."**

- Find companies → `find-companies` or `orchestrate`
- Find people at a company → `find-people`
- Get emails/phones for leads → `enrich-leads` (type: contact)
- Score leads against my ICP → `qualify-leads`
- Scrape a LinkedIn post → `scrape-linkedin`
- Research a competitor → `competitive-intel`
- Write personalized outreach → `personalize`
- Generate email sequences → `email-sequence`
- Reply to LinkedIn comments → `answer-comments`
- Send cold emails → `send-email-sequence`
- Run LinkedIn + email together → `multi-channel-campaign`
- Do something complex → `orchestrate` (describe it in plain English)
- See campaign performance → `visualize-campaigns`
- Monthly report → `monthly-campaign-report`
- Export data → `export-data`
