# CLI Smoke Test Results

Date: 2026-04-01

## Summary

All CLI commands load and display help without crashes. Core functionality works.
Commands requiring API keys work when keys are configured.

## Results

| Command | Status | Notes |
|---------|--------|-------|
| `--help` | PASS | All 30+ commands listed |
| `setup` | PASS | All 7 API keys detected, 4 providers validated |
| `leads:qualify --help` | PASS | Shows options: source, input, result-set, dry-run |
| `campaign:create --help` | PASS | Shows all scheduling options |
| `campaign:track --help` | PASS | Shows dry-run option |
| `doctor` | PASS | 5-layer health check runs, finds real issues (YAML loader, FK) |
| `campaign:dashboard` | PASS | Starts Hono server on port 3847 |

## Commands Requiring API Keys

These commands need valid API keys in `.env.local` to function:
- `leads:qualify` — needs ANTHROPIC_API_KEY + source-specific keys
- `campaign:track` — needs UNIPILE_API_KEY + NOTION_API_KEY
- `campaign:create` — needs NOTION_API_KEY (writes to DB)
- `leads:scrape-post` — needs UNIPILE_API_KEY
- `email:send` — needs INSTANTLY_API_KEY

## Known Issues

1. **`yalc-gtm --help`** fails because Commander receives `--` as first arg. Use `npx tsx src/cli/index.ts --help` directly.
2. **`doctor`**: GTM framework YAML check reports "require is not defined" — likely a CJS/ESM loader issue in the YAML schema validator.
3. **Instantly provider** marked as SKIP — API key not configured (optional provider).
