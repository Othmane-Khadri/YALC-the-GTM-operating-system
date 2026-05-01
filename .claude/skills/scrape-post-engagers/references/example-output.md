# scrape-post-engagers — example rendered output

Below is what the user sees after `scrape-post-engagers` runs against a typical LinkedIn post URL.

## Input

```
https://www.linkedin.com/posts/othmane-khadri_gtm-engineering-leads-activity-7234567890123456789-aBcD
```

## CLI invocation

```bash
npx tsx src/cli/index.ts leads:scrape-post \
  --url 'https://www.linkedin.com/posts/othmane-khadri_gtm-engineering-leads-activity-7234567890123456789-aBcD'
```

## CLI output (last block)

```
✓ Scraped 142 engagers (118 reactors, 24 commenters)
  Result set: rs_2026_04_30_engagers_a1b2
  Output: /Users/othmane/.gtm-os/data/result-sets/rs_2026_04_30_engagers_a1b2.json

Next: yalc-gtm leads:qualify --result-set rs_2026_04_30_engagers_a1b2
```

## Skill summary rendered to user

```
Scraped 142 engagers from the post:
  • 118 reactors (likes / celebrates / supports / etc.)
  •  24 commenters
  •   8 of those overlap (people who both reacted and commented — counted once, deduped on LinkedIn profile URL)

Result set id: rs_2026_04_30_engagers_a1b2
Raw JSON:      /Users/othmane/.gtm-os/data/result-sets/rs_2026_04_30_engagers_a1b2.json

Want me to:
  (a) qualify these 142 leads against your ICP via `qualify-leads --result-set rs_2026_04_30_engagers_a1b2`?
  (b) launch a LinkedIn outreach campaign to them via `launch-linkedin-campaign`?
```

## Failure modes

### LinkedIn channel disabled

```
[leads:scrape-post] LinkedIn channel is disabled in your config (~/.gtm-os/config.yaml).
Re-enable it under `channels.linkedin.enabled: true` and re-run.
```

Surface this verbatim — don't retry, don't fall back to a different channel.

### Unipile rate limit mid-pagination

```
⚠ Unipile rate-limited at page 6/10. Persisted 87 of an estimated 142 engagers.
  Result set: rs_2026_04_30_engagers_a1b2 (partial)

Re-run the same command in 60 minutes to top up the result set, or proceed with the partial 87.
```

### Bad URL

If the URL doesn't resolve to a LinkedIn post Unipile can find, the CLI exits with a 4xx. Ask the user to copy the URL from the post's "Copy link" menu.
