# list-adapters — example rendered output

Below is what the user sees after `list-adapters` runs on a typical dev install with most keys set + one missing key + one bundled YAML override.

```
Adapter inventory — 17 capabilities

asset-rendering
  #1  ✓ playwright           [built-in]

crm-contact-upsert
  #1  ✗ hubspot              [bundled]    (missing HUBSPOT_API_KEY)

email-campaign-create
  #1  ✓ instantly            [built-in]
  ·   ✗ brevo                [bundled]    (missing BREVO_API_KEY)

funding-feed
  #1  ✓ crustdata            [built-in]

hiring-signal
  #1  ✓ crustdata            [built-in]

icp-company-search
  #1  ✓ crustdata            [built-in]
  #2  ✓ apollo               [built-in]
  ·   ✗ pappers              [built-in]

inbox-replies-fetch
  #1  ✓ instantly            [built-in]

landing-page-deploy
  #1  ✗ vercel               [bundled]    (missing VERCEL_TOKEN)

linkedin-campaign-create
  #1  ✓ unipile              [built-in]

linkedin-content-fetch
  #1  ✓ unipile              [built-in]

linkedin-engager-fetch
  #1  ✓ unipile              [built-in]

linkedin-trending-content
  #1  ✓ unipile              [built-in]

linkedin-user-posts-fetch
  #1  ✓ unipile              [built-in]

news-feed
  #1  ✓ firecrawl            [built-in]

people-enrich
  #1  ✓ fullenrich           [built-in]
  #2  ✓ crustdata            [built-in]
  ·   ✗ peopledatalabs       [bundled]    (missing PDL_API_KEY)

person-job-change-signal
  #1  ✓ crustdata            [built-in]

reasoning
  #1  ✓ anthropic            [built-in]
  ·   ✗ openai               [built-in]   (missing OPENAI_API_KEY)

web-fetch
  #1  ✓ firecrawl            [built-in]

Verdict: 14 / 17 capabilities have at least one available provider.
3 capabilities (crm-contact-upsert, landing-page-deploy + the bundled brevo/PDL providers) need keys before they're usable.

Want me to:
- Open /keys/connect/hubspot to set HUBSPOT_API_KEY?
- Open /keys/connect/vercel to set VERCEL_TOKEN?
```

## Failure modes

If a YAML manifest in `~/.gtm-os/adapters/` failed to compile at boot, the renderer appends a section after the inventory:

```
Declarative manifest errors:
  ~/.gtm-os/adapters/people-enrich-clearbit.yaml
    /endpoint/url: must be a string
```

These are user-actionable. The skill surfaces them so the user can fix the YAML directly or re-run `provider-builder` to regenerate it.
