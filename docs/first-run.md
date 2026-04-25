# First Run Tutorial

This guide walks you through what happens when you run `yalc-gtm start` for the first time, and then shows you three things to try after setup.

## Prerequisites

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system.git
cd YALC-the-GTM-operating-system
pnpm install
```

## Running `start`

```bash
yalc-gtm start
```

### Step 1/4 — Environment

The CLI creates `~/.gtm-os/` (your persistent GTM brain) and checks for API keys.

**Anthropic key** — the only required key. If it's already in your environment (common in Claude Code sessions), it's detected automatically. Otherwise you'll be prompted:

```
? Anthropic (Claude) (AI reasoning — powers everything)
  Get yours at: https://console.anthropic.com/settings/keys
  Paste your key: ****
  ✓ Anthropic key valid
```

**Optional keys** — the CLI then asks if you want to add provider keys for LinkedIn, web scraping, company search, etc. You can skip all of them and add later:

```
  The following keys unlock additional capabilities (press Enter to skip any):

    Firecrawl: Web scraping — auto-learn from your website
    Crustdata: Company & people search — find leads at scale
    Unipile (LinkedIn): LinkedIn outreach — connect, DM, scrape
    Notion: CRM sync — campaign & lead tracking

? Add optional provider keys now? (y/N)
```

Everything gets saved to `.env.local`. You never need to manually edit this file.

### Step 2/4 — Company Context

The CLI asks 8-10 questions about your company. Answer as specifically as you can — this data drives everything that follows.

```
? Company name: Acme Corp
? Company website URL: https://acme.com
? One-sentence value proposition: We help B2B SaaS companies reduce churn by 40% with predictive analytics
? Primary ICP(s) — industries, company sizes, roles: B2B SaaS, 50-500 employees, VP Customer Success, Head of Revenue Ops
? Top 3 pain points your buyers are trying to solve: 1) Can't predict which customers will churn 2) CS team is reactive not proactive 3) No single view of customer health
? Main competitors: Gainsight, Totango, ChurnZero
? GTM channels you use: LinkedIn, email, events
? Voice description: Direct, data-driven, no fluff. Use specific numbers. Avoid buzzwords like "leverage" or "synergy".
? One or two customer wins to reference: Reduced churn 38% for a 200-person fintech in 3 months
? Auto-disqualifiers: Companies under 20 employees, agencies, consultancies
```

If you added a Firecrawl key, your website is automatically scraped for additional context (homepage, /about, /pricing, /customers).

### Step 3/4 — Building GTM Framework

Claude takes everything from Step 2 and synthesizes it into a structured GTM framework:

```
  Claude is synthesizing your company context into a GTM framework...

  ✓ Framework built from 14 data points
    Company:  Acme Corp
    Value:    Predictive analytics that reduces B2B SaaS churn by 40%
    Segments: VP Customer Success (primary), Head of Revenue Ops (secondary)
```

The framework includes:
- **Company profile** — name, industry, stage, description
- **Positioning** — value prop, differentiators, competitors with weaknesses
- **ICP segments** — target roles, industries, company sizes, pain points, buying triggers
- **Signals** — buying intent signals, monitoring keywords, trigger events

Saved to `~/.gtm-os/framework.yaml` and the local database.

### Step 4/4 — Goals & Configuration

Claude recommends a GTM strategy based on your framework:

```
── GTM Goals ──
Primary Goal:    Generate 50 qualified leads/month from VP CS at mid-market SaaS
Channels:        linkedin, email
Target Volume:   50/month
Campaign Style:  test-and-learn
```

Then auto-generates:
- **Qualification rules** (`~/.gtm-os/qualification_rules.md`) — regex patterns matching your ICP titles and industries
- **Outreach templates** (`~/.gtm-os/campaign_templates.yaml`) — LinkedIn connect note, DM1, DM2 written in your voice
- **Search queries** (`~/.gtm-os/search_queries.txt`) — keywords for monitoring and prospecting

### Readiness Report

At the end, you see what's available based on your configured providers:

```
  ╔══════════════════════════════════════╗
  ║          You're ready to go!         ║
  ╚══════════════════════════════════════╝

    ✓ AI-powered GTM planning
    ✓ Lead qualification
    ○ LinkedIn campaigns        (add UNIPILE_API_KEY to unlock)
    ○ Notion CRM sync           (add NOTION_API_KEY to unlock)
    ○ Web intelligence           (add FIRECRAWL_API_KEY to unlock)

  Try this first:
    yalc-gtm orchestrate "find companies matching my ICP"
```

---

## What to Try Next

### 1. Qualify Your First Leads

Already have a lead list? Run qualification in dry-run mode against your CSV:

```bash
yalc-gtm leads:qualify --source csv --input ./your-leads.csv --dry-run
```

Don't have a list yet? Let YALC find and qualify leads for you:

```bash
yalc-gtm orchestrate "find 10 SaaS CTOs matching my ICP and qualify them"
```

This runs each lead through the 7-gate qualification pipeline:
1. Title match against your ICP roles
2. Company size check
3. Industry alignment
4. Disqualifier screening
5. Signal scoring
6. Framework fit
7. Final scoring (0-100)

Each lead gets a score and reason. Review the results, then run without `--dry-run` to save them.

### 2. Create Your First Campaign

Requires: `UNIPILE_API_KEY` + `UNIPILE_DSN`

```bash
yalc-gtm campaign:create --title "Q2 CS Leaders" --hypothesis "VP CS responds to churn data"
```

This creates a 3-step LinkedIn sequence (connect → DM1 → DM2) with A/B variant testing. The templates use your voice from Step 4.

Track progress daily:
```bash
yalc-gtm campaign:track --dry-run
```

### 3. Orchestrate with Natural Language

The orchestrator takes a plain English request and plans a multi-step workflow:

```bash
yalc-gtm orchestrate "find 10 SaaS companies in New York with 100-500 employees, find their VP of Customer Success, and qualify them"
```

Claude decomposes this into skills (find-companies → find-people → qualify-leads), picks the right providers, and executes step by step.

---

## File Structure After Setup

```
~/.gtm-os/                          Your GTM brain (persists across projects)
├── config.yaml                     Provider settings, Notion IDs, rate limits
├── framework.yaml                  GTM framework — ICP, positioning, signals
├── qualification_rules.md          Lead qualification patterns (auto-generated)
├── campaign_templates.yaml         Outreach copy templates (auto-generated)
├── search_queries.txt              Monitoring keywords (auto-generated)
└── tenants/<slug>/                 Per-tenant overrides (multi-company mode)

./data/                             Working data (in your project directory, optional)
├── leads/                          CSV/JSON lead lists you bring or generate
├── intelligence/                   Campaign learnings and insights
└── campaigns/                      Campaign exports and reports
```

## Re-running Setup

Run `yalc-gtm start` again anytime to reconfigure. It preserves existing keys and lets you update your company context.

To just check your setup health without reconfiguring:
```bash
yalc-gtm doctor
```
