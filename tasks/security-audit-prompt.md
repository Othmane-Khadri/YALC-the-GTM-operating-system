# GTM-OS Security Audit Report

**Date:** 2026-03-08
**Auditor:** Claude Opus 4.6 (AI-assisted) + Othmane Khadri
**Scope:** Full codebase at `~/Desktop/gtm-os/` — pre-public-release audit
**Commit range:** `b874f0c` (Day 1) through `99bca7a` (Day 6)

---

## Executive Summary

GTM-OS is ready for public release (MIT license). The codebase is **security-conscious by design** — no hardcoded secrets, proper encryption, environment isolation for MCP child processes, and SSRF protection. Two vulnerabilities were found and fixed during this audit:

1. **MCP server auth used plain `===`** instead of timing-safe comparison (fixed)
2. **Turso authToken not wired** for remote DB deployment (fixed)

---

## Methodology

1. **Secrets scan:** Regex sweep for `sk-`, `key_`, `Bearer` literals, `password=`, hardcoded tokens across all `.ts`/`.tsx` files
2. **Environment audit:** Verified `.env.local`/`.env` in `.gitignore`, checked for `NEXT_PUBLIC_` leaks, reviewed `.env.example`
3. **Auth review:** Read `src/middleware.ts` and `src/app/api/mcp-server/route.ts` for timing attacks, fail-open behavior
4. **Crypto review:** Verified AES-256-GCM implementation in `src/lib/crypto.ts`
5. **SSRF review:** Read `src/lib/web/url-validator.ts` for bypass vectors
6. **MCP isolation:** Verified env filtering and command allowlist in `src/lib/mcp/client.ts`
7. **SQL injection:** Verified Drizzle ORM parameterization across all routes
8. **Dependency audit:** Reviewed `package.json` for known-vulnerable packages

---

## Findings

### HIGH — Fixed

#### H1: MCP Server Auth Timing Attack
- **File:** `src/app/api/mcp-server/route.ts:10`
- **Before:** `return authHeader === \`Bearer ${expectedToken}\``
- **After:** `timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))`
- **Risk:** Timing side-channel could leak token bytes to an attacker
- **Status:** Fixed in commit `d976498`

#### H2: Turso authToken Not Wired
- **File:** `src/lib/db/index.ts:7`
- **Before:** `createClient({ url: DATABASE_URL })`
- **After:** `createClient({ url: DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })`
- **Risk:** Vercel deployment would fail to authenticate with Turso remote DB
- **Status:** Fixed in commit `d976498`

#### H3: Duplicate Raw LibSQL Client
- **File:** `src/app/api/chat/route.ts:18`
- **Before:** Second `createClient()` call duplicating `db/index.ts`
- **After:** Import `rawClient` from `@/lib/db`
- **Risk:** Two clients with potentially different configs; memory waste
- **Status:** Fixed in commit `d976498`

### MEDIUM — Documented (acceptable for OSS)

#### M1: API Routes Fail Open Without GTM_OS_API_TOKEN
- **File:** `src/middleware.ts:31-42`
- **Behavior:** If `GTM_OS_API_TOKEN` is unset, all `/api/*` routes are unprotected
- **Assessment:** By design for local development. Console warning printed once. **Must set in Vercel env vars for production.**

#### M2: No Rate Limiting
- **Files:** All `src/app/api/*/route.ts`
- **Assessment:** Acceptable for local-only OSS. For Vercel deployment, add in-memory throttle or `@upstash/ratelimit` on `/api/chat` and `/api/api-keys`.

#### M3: package.json `"private": false`
- **File:** `package.json`
- **Assessment:** Correct for public OSS repo. Set to `true` in the private Vercel fork to prevent accidental `npm publish`.

### VERIFIED CLEAN

| Check | Result | Details |
|-------|--------|---------|
| Hardcoded secrets | CLEAN | Zero `sk-`, `key_`, `Bearer` literals in source |
| `NEXT_PUBLIC_` vars | CLEAN | No client-side env var exposure |
| `.gitignore` coverage | CLEAN | `.env.local`, `.env`, `*.db`, `CLAUDE.md` all ignored |
| `.env.local` in git | CLEAN | Not tracked (`git ls-files .env.local` = empty) |
| SSRF protection | CLEAN | `url-validator.ts` blocks private IPs, localhost, metadata endpoints |
| MCP env isolation | CLEAN | Only `PATH`, `HOME`, `USER`, `SHELL`, `LANG`, `TERM`, `NODE_ENV` forwarded |
| MCP command allowlist | CLEAN | Only `npx`, `node`, `uvx`, `uv`, `docker`, `python3`, `python`, `deno`, `bun` |
| SQL injection | CLEAN | All queries via Drizzle ORM (parameterized) or `rawClient.execute({ args })` |
| Crypto implementation | CLEAN | AES-256-GCM with random IV, scrypt key derivation, auth tag verification |
| Git history | CLEAN | No secrets in any prior commit |

---

## Environment Variables

| Variable | Required | Where Set | Purpose |
|----------|----------|-----------|---------|
| `ANTHROPIC_API_KEY` | YES | `.env.local` / Vercel | Claude API calls |
| `DATABASE_URL` | NO | Defaults to `file:./gtm-os.db` | libSQL/Turso connection string |
| `TURSO_AUTH_TOKEN` | YES (Vercel) | Vercel dashboard | Turso remote DB authentication |
| `ENCRYPTION_KEY` | YES | `.env.local` / Vercel | AES-256-GCM for API key vault |
| `GTM_OS_API_TOKEN` | YES (Vercel) | Vercel dashboard | Bearer token for all API routes |
| `MCP_SERVER_TOKEN` | NO | Optional | External MCP agent access |
| `APIFY_TOKEN` | YES (real exec) | `.env.local` / Vercel | Apify actor calls |

**Generate secrets:**
```bash
openssl rand -hex 32  # Use for ENCRYPTION_KEY, GTM_OS_API_TOKEN, MCP_SERVER_TOKEN
```

---

## Dual-Repo Strategy

### Public: `github.com/earleads/gtm-os` (MIT)
- All source code (verified clean of secrets)
- `.env.example` with variable names only
- `tasks/` directory included (build narrative)
- `CLAUDE.md` excluded via `.gitignore`

### Private: `github.com/earleads/gtm-os-private`
- Fork of public repo
- `"private": true` in `package.json`
- Rate limiting added for production routes
- Env vars in Vercel dashboard (never committed)
- DB: Turso (libSQL over HTTPS) — free tier sufficient

### Git Workflow
```
public (origin)  ←  all code commits here first
     ↓
private (remote)  ←  git push private main
     ↓
vercel-deploy branch  ←  production-specific changes (rate limiting, private: true)
     ↓
Vercel  ←  auto-deploys from vercel-deploy
```

---

## Remaining Recommendations

1. **Rate limiting (Vercel):** Add in-memory Map-based throttle or `@upstash/ratelimit` on `/api/chat` (expensive — Claude calls) and `/api/api-keys` (sensitive — vault operations)
2. **PDF text extraction:** Currently stubbed — only filename stored. Add `pdf-parse` when needed.
3. **CSP headers:** Add Content-Security-Policy in `next.config.mjs` for production
4. **Dependency audit:** Run `pnpm audit` periodically
5. **ENCRYPTION_KEY rotation:** Document key rotation procedure for API key vault

---

## Commit Log (This Audit)

| Hash | Message |
|------|---------|
| `d976498` | security: harden API auth, encryption, and SSRF protection |
| `49538dd` | rebrand: migrate to The Kiln design language (Day 05) |
| `dff17e1` | feat: tables list page (Day 05) |
| `bf1dae2` | feat: knowledge base page with upload (Day 05) |
| `99bca7a` | feat: knowledge → AI pipeline with FTS5 sync (Day 06) |
