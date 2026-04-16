# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in YALC, **please do not file a public issue.**

Instead, email the details to the project maintainer. Include:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You can expect an initial response within 48 hours.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.5.x   | Yes       |
| < 0.5   | No        |

## Security Design

YALC handles sensitive data (API keys, lead information, campaign data). Key security measures:

- **API key encryption:** Stored keys are encrypted with AES-256-GCM using the `ENCRYPTION_KEY` env var
- **Outbound validation:** Every human-facing message passes through `validateMessage()` before sending
- **Rate limiting:** DB-backed token bucket prevents abuse of external APIs
- **No secret logging:** API keys are never logged — masked as `sk-...redacted`
- **Local-first:** All data stored in local SQLite by default, nothing leaves your machine unless you configure external providers
