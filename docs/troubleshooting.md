# Troubleshooting

> **Tip:** you can run any of these commands by asking Claude Code in your IDE — see [Quick start in README](../README.md#quick-start).

Run `yalc-gtm doctor` first — it checks 5 layers and tells you exactly what's wrong.

## Environment Issues

### Missing ANTHROPIC_API_KEY
```
✗ [FAIL] ANTHROPIC_API_KEY
         Environment variable not set
```
**Fix:** Add your key to `.env.local`:
```bash
echo "ANTHROPIC_API_KEY=sk-ant-api03-..." >> .env.local
```
Or run `yalc-gtm start` which will prompt you for it.

### Missing .env.local
```
✗ [FAIL] .env.local not found
```
**Fix:** Copy the example and fill in your keys:
```bash
cp .env.example .env.local
```

### ENCRYPTION_KEY not set
```
✗ [FAIL] ENCRYPTION_KEY
```
**Fix:** Generate one:
```bash
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env.local
```

### Invalid Unipile DSN format
The DSN should look like `https://api{N}.unipile.com:13{XXX}`. Common mistakes:
- Missing `https://` prefix
- Missing port number
- Using the API key in the DSN field

### Key detected but validation fails
If `doctor` shows the key is present but validation fails, the key may be expired, revoked, or malformed. Re-copy it from the provider's dashboard.

## Provider Issues

### Anthropic: "timeout" during validation
The validation makes a small API call. If it times out:
- Check your internet connection
- Verify the key at https://console.anthropic.com/settings/keys
- Try: `curl -H "x-api-key: $ANTHROPIC_API_KEY" https://api.anthropic.com/v1/messages -d '{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' -H "content-type: application/json" -H "anthropic-version: 2023-06-01"`

### Unipile: "account not found"
The DSN rotates with Unipile infrastructure updates. Re-check your DSN at https://app.unipile.com/settings/api.

### Firecrawl: scrape failures
- Free tier has 500 credits — check if exhausted
- Some sites block scrapers — this is expected, not a bug
- The validation scrapes `example.com` — if that fails, it's a network or key issue

### Crustdata: empty results
- Use `yalc-gtm doctor` to verify the key
- Crustdata is credit-based — check your balance at the dashboard
- Some searches return 0 results legitimately (very narrow filters)

### Notion: "Request body too large"
Notion limits batch operations. GTM-OS batches to 40 pages per call, but if you hit this:
- Check your data size
- This is automatically handled — report if you see it

### Notion: "Could not find database"
Your Notion integration must be shared with the specific databases you want to sync:
1. Open the database in Notion
2. Click "..." → "Connections" → Add your integration
3. Verify the database ID in `~/.gtm-os/config.yaml`

### Instantly: campaign created but no emails sent
Instantly campaigns with no sequences silently never send. GTM-OS blocks this — if you see an error about empty sequences, add at least one email step with a subject and body.

Also verify you have at least one email sending account configured in Instantly.

## Database Issues

### Schema mismatch after update
If you update GTM-OS and see database errors:
```bash
yalc-gtm doctor   # Check database layer
```
Drizzle migrations should run automatically. If they don't:
```bash
pnpm drizzle-kit push
```

### Database locked
SQLite allows one writer at a time. If you get "database is locked":
- Check if another GTM-OS process is running
- Check for zombie processes: `ps aux | grep gtm-os`
- The lock auto-releases when the process ends

## Campaign Issues

### Rate limiting: "too many requests"
GTM-OS enforces rate limits to protect your accounts:
- LinkedIn: 30 connection requests/day, 3-second delay between calls
- These are configurable in `~/.gtm-os/config.yaml` under `unipile:`

If you hit external rate limits (429 errors), wait and retry. GTM-OS handles backoff automatically.

### Campaign stuck in "scheduled" state
Campaigns with `--start-at` start as 'scheduled' and auto-activate on that date. Check:
```bash
yalc-gtm campaign:track --campaign-id <id> --dry-run
```

### Outbound message blocked
Every message passes through `validateMessage()`. Hard violations block sends. Common reasons:
- Message too long
- Contains banned patterns
- Missing personalization tokens

Check `~/.gtm-os/campaign_templates.yaml` for your current templates.

## Agent Issues

### launchd agent not running
```bash
launchctl list | grep gtm-os
```
If not listed:
```bash
yalc-gtm agent:install --agent <name>
```
If listed but not running, check logs:
```bash
cat ~/Library/Logs/gtm-os/<agent-name>.log
```

### Agent crashes repeatedly
Check the log file for the specific error. Common causes:
- API key expired (check `.env.local`)
- Network issues
- Provider rate limits exceeded

## Framework Issues

### "No framework found"
Run onboarding first:
```bash
yalc-gtm start
```
Or if you already onboarded but the framework wasn't saved:
```bash
yalc-gtm framework:derive
```

### Framework seems outdated
Re-derive from current memory:
```bash
yalc-gtm framework:derive --tenant <slug>
```

## Getting Help

1. Run `yalc-gtm doctor` — solves 80% of issues
2. Check this guide for the specific error
3. File an issue: https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system/issues
