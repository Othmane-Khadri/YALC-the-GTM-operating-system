# YALC: The GTM-operating-system
Clay Pro costs $720/month. That's $8,640/year for webhooks, CRM sync, and a credit system on top of APIs you're already paying for.

I already run dozens of enrichment and scoring agents in production they scrape, enrich, score, and push leads to my CRM every morning before I wake up. All outside of Clay. No credit system. No tier gates. Just my own API keys and logic.
So I'm building the whole thing in the open. 30 days. An open-source Clay alternative using Claude Code, Apify, and direct API calls to the same enrichment providers. Signal detection. Waterfall enrichment. Account scoring. CRM sync. All of it. 
I'll push updates here daily: what I built, what broke, where AI helped, and where I had to think.

# About
GTM OS is a self-hosted lead enrichment and scoring engine. It will do what Clay does: waterfall enrichment, account scoring, CRM sync — but you bring your own API keys and pay nothing for the orchestration layer.
You plug in the providers you already use (Apollo, Clearbit, Hunter, Proxycurl, or whatever else), connect your own LLM keys for AI scoring and personalization, and the system handles the rest: waterfall logic, deduplication, transforms, and pushing enriched data to your CRM or outreach tool.
No per-lead pricing. No usage credits. No middleman markup on API calls you could make yourself.

Built with:

- Claude Code — AI-assisted development
- Apify — web scraping and data collection
- Direct API calls to enrichment providers

# Build Log
Day 0 — Setup
Challenge announced. Repo is live. Let's go.

# License
MIT — see LICENSE.
Built by Earleads
