---
name: provider-builder
description: Use when a teammate wants to add a new vendor to YALC for an existing capability without shipping a release. Triggers include "add a new provider for X", "wire up [vendor] to YALC", "build an adapter for [vendor]", "I want to use [vendor] for [capability]", "add Apollo for icp-company-search", or any variant indicating they want to author a declarative YAML manifest under `~/.gtm-os/adapters/`. Converts a vendor name + capability id + docs URL into a registered, smoke-tested manifest in roughly five minutes.
version: 1.0.0
---

# Provider Builder

Author a declarative adapter manifest from a vendor name, a capability id, and a docs URL. Drafts YAML, smoke-tests against the live vendor, and only then registers the file under `~/.gtm-os/adapters/`. Built on the manifest schema in `src/lib/providers/declarative/types.ts` and the `adapters:smoke` runner. **Never** writes secrets into the manifest, **never** prints API keys back to the user, **never** reads `~/.gtm-os/.env`.

## When to use

- "Add Apollo as a second provider for `icp-company-search`"
- "Wire up PeopleDataLabs for `people-enrich`"
- "Try Brevo instead of Instantly for `email-campaign-create`"
- Hot-patching a broken built-in by dropping a YAML with the same provider id

**Don't use when:** the vendor needs OAuth, request signing (Sigv4 / HMAC), gRPC / websockets, an SDK-only client, or two-call flows (`/token` then `/search`). All of those are out of scope for declarative v1 — exit with a stub TS template (see Failure mode 2 below).

## Pre-flight (do this before step 1)

1. Confirm the trigger is in scope. If the user mentioned OAuth, an SDK, gRPC, or signed requests, jump to **Failure mode 2** and exit cleanly.
2. Confirm `pnpm cli adapters:list` works in the cwd. If not, the package isn't built or the user is in the wrong directory — surface that and stop.
3. Resolve the env var name with the user (e.g., `APOLLO_API_KEY`). **Do not** open `~/.gtm-os/.env`. Use `process.env` only — `node -e "console.log(process.env.APOLLO_API_KEY ? 'set' : 'unset')"` is the maximum disclosure allowed (prints `set` / `unset`, never the value).

## Workflow

### Step 1 — Discover

Resolve the capability id with fuzzy matching. Examples:
- "find emails", "enrich people", "get email" → `people-enrich`
- "find companies", "ICP search", "company search" → `icp-company-search`
- "send email campaign", "cold email" → `email-campaign-create`
- "deploy landing page" → `landing-page-deploy`

```bash
pnpm cli adapters:list
```

Pick the capability id from the output. Then surface its input/output schema to the user so they understand what the manifest must produce. Schemas live in `src/lib/providers/capabilities.ts` and the per-capability adapter files under `src/lib/providers/adapters/<capability>-*.ts`. Read the capability's `inputSchema` + `outputSchema` and present the required fields.

If the requested capability id does not exist, stop. Tell the user a new capability requires a TS change (out of scope for this skill) and offer to file that as a follow-up.

### Step 2 — Read vendor docs

WebFetch (preferred for stable docs) or use the `web-browsing` skill (Firecrawl) for JS-heavy docs sites. Pull these from the docs page:

- **Endpoint** — full URL, HTTP method.
- **Auth method** — `header` / `query` / `bearer`. Note the header or query-param name. If you see `Authorization: Bearer …`, use `bearer`. If you see `X-Api-Key: …`, use `header` with `name: X-Api-Key`.
- **Request shape** — query params (GET) or JSON body (POST). Note required fields.
- **Response shape** — top-level wrapper (`{ data: [...] }`, `{ results: [...] }`, etc.) and the per-item field names.
- **Error envelope** — how errors look when the HTTP status is 200 but the call failed (some vendors do this).
- **Pagination** — `cursor` vs `page`. Skip on first pass; add later only if needed.

Detect out-of-scope flows up front (see Failure mode 2). If the docs reference any of: "OAuth", "authorization code", "refresh_token", "client_secret" + browser redirect, AWS Sigv4, HMAC signature, gRPC, websockets, an official SDK with no documented REST endpoint — exit cleanly.

If the docs page is incomplete (no example response, no error envelope), ask the user for one missing piece at a time. **Never guess.**

### Step 3 — Draft manifest

Write the YAML to `/tmp/yalc-builder/{capability}-{provider}.yaml`. Do **not** write directly to `~/.gtm-os/adapters/` — that comes after smoke green.

```bash
mkdir -p /tmp/yalc-builder
```

Start from `references/yaml-template.yaml`. Required fields:

```yaml
manifestVersion: 1
capability: <id>           # from step 1, exact match
provider: <vendor-id>      # short kebab-case, e.g. "apollo"
version: 0.1.0
auth:
  type: header             # or bearer / query
  name: X-Api-Key          # omit for bearer
  value: ${env:APOLLO_API_KEY}
endpoint:
  method: POST
  url: https://api.example.com/v1/search
request:
  contentType: application/json
  bodyTemplate: |
    { "q": "{{input.keywords}}", "limit": {{input.limit | default: 25}} }
response:
  rootPath: results
  mappings:
    "companies[].name": "$.name"
    "companies[].domain": "$.primary_domain"
  errorEnvelope:
    matchPath: $.error
    messagePath: $.error
smoke_test:
  input:
    keywords: "saas"
    limit: 5
  expectNonEmpty: ["companies[0].domain"]
```

**Mapping rules** (see `src/lib/providers/declarative/compiler.ts`):
- Targets like `companies[].domain` iterate over `rootPath` array; targets without `[]` are scalars.
- Source `$.field` reads from the current row (or root for scalars).
- Source `null` emits literal null.
- Prefix-literal source like `"https://$.url"` keeps the prefix and substitutes the path.
- Equality: `"$.readyState == 'READY'"` returns boolean.

**Template scope** (Mustache-flavour):
- `{{input.foo}}` — the runtime input passed to the capability
- `{{env.VAR}}` — process env
- `{{auth.value}}` / `{{auth.name}}` / `{{auth.type}}` — resolved auth
- Filters: `| default: 25`, `| default: "x"`, `| json`
- Unknown roots fail at compile time, not runtime.

Show the draft to the user before moving on.

### Step 4 — Smoke test

Ask the user for sample input that fits the capability's input schema and is realistic (a real company name, a real domain). Replace the YAML's `smoke_test.input` with that input. Then:

```bash
pnpm cli adapters:smoke /tmp/yalc-builder/<capability>-<provider>.yaml
```

Exit code 0 = green: every `expectNonEmpty` path resolved to a non-empty value. Exit code 1 = red.

**On red, loop:**
1. Read the structured output. If the error is `MissingApiKeyError`, the env var is unset — ask the user to set it in `~/.gtm-os/.env`, then re-run. Do **not** read or print the value.
2. If the error is `ProviderApiError` with HTTP 401/403, auth is mis-shaped (wrong header name, wrong type). Adjust `auth.*` and re-run.
3. If the error is `ProviderApiError` with HTTP 4xx, the request body / query is wrong. Print the response, ask the user which field to revise, edit the manifest, re-run.
4. If pass-checks read empty paths, `rootPath` or `mappings` are wrong. Re-run with `--json` (`pnpm cli adapters:smoke <path> --json`) to inspect the raw response, realign mappings, re-run.

**Hard cap: 3 iterations.** After the third red, stop. Dump the last response + last manifest to `/tmp/yalc-builder/debug.json`. Tell the user the manifest is at `/tmp/yalc-builder/<file>.yaml`, the debug artifact is at `/tmp/yalc-builder/debug.json`, and that they should hand the artifact to a maintainer or use `references/troubleshooting.md`. Exit cleanly — never silently drop a half-broken manifest in the live adapters dir.

### Step 5 — Register

On smoke green:

```bash
mkdir -p ~/.gtm-os/adapters
mv /tmp/yalc-builder/<capability>-<provider>.yaml ~/.gtm-os/adapters/
```

Then prompt the user: "Bump `<provider>` to the front of the priority list for `<capability>`?" If yes, edit `~/.gtm-os/config.yaml`:

```yaml
capabilities:
  <capability>:
    priority: [<new-provider>, <existing-providers...>]
```

If `~/.gtm-os/config.yaml` does not exist, create it:

```yaml
capabilities:
  <capability>:
    priority: [<new-provider>]
```

Verify with `pnpm cli adapters:list` — the new row should show `[declarative]` with the manifest path and `✓` available.

### Step 6 — Document

Append a one-line entry to `~/.gtm-os/adapters/INSTALLED.md`:

```
2026-04-30 — icp-company-search/apollo — smoke OK — https://docs.apollo.io/...
```

If the file does not exist, create it with a header:

```
# YALC declarative adapters installed locally
# date — capability/provider — smoke status — docs URL
```

## Failure modes

### 1. Vendor docs incomplete

If the docs page lacks a response example, an error envelope, or an auth section, ask the user for that one piece. Never invent fields. If the user can't supply it (e.g., docs are private), suggest they run a real call with `curl` and paste the response — that's the source of truth.

### 2. OAuth / SDK-only / signed requests / multi-step flows

Detect in step 2. Exit cleanly with this message:

> "[vendor] needs a TS adapter — out of scope for declarative v1. The declarative DSL only supports static auth (header / bearer / query) and one HTTP call per execute. A TS adapter stub goes at `src/lib/providers/adapters/<capability>-<provider>.ts`. See an existing adapter (e.g. `peopleEnrichFullenrichAdapter`) as a starting point."

Do not draft a YAML. Do not write to `/tmp/yalc-builder/`.

### 3. Smoke red after 3 iterations

Stop. Write `/tmp/yalc-builder/debug.json` with the last manifest and the last response. Hand back to the user. See `references/troubleshooting.md` for the common causes.

### 4. The capability id does not exist

A new capability is a TS change to `src/lib/providers/capabilities.ts`. Out of scope for this skill. Tell the user, offer to file a follow-up.

## Security

This skill MUST:

- **Never** write a key value into a manifest. Manifests reference env vars only via `${env:VAR_NAME}`.
- **Never** print a key value back to the user. The maximum disclosure allowed is "set" / "unset".
- **Never** read `~/.gtm-os/.env`. Verification is `process.env.<VAR> ? 'set' : 'unset'` only.
- **Never** include a real API response in chat if the response includes secrets in headers — strip auth headers before showing the user.

This matches the user's standing rule on never displaying secrets in chat.

## Tools used

- WebFetch — read vendor docs pages (preferred for static HTML docs).
- `web-browsing` skill (Firecrawl) — for JS-heavy docs sites.
- Bash — `pnpm cli adapters:list`, `pnpm cli adapters:smoke`, file ops under `/tmp/yalc-builder/` and `~/.gtm-os/adapters/`.
- Write / Edit — draft YAML and the INSTALLED.md log line.

## References

- `references/yaml-template.yaml` — blank manifest with comments per field. Use this for a docs-light flow where the user pastes a `curl` example instead.
- `references/troubleshooting.md` — common docs-extraction and smoke-failure patterns, with concrete remediations.
- `docs/superpowers/specs/2026-05-01-declarative-adapters-design.md` — full spec (sections 1, 4, 5 are the relevant ones for this skill).
- `src/lib/providers/declarative/types.ts` — manifest type definitions.
- `src/lib/providers/declarative/compiler.ts` — template + mapping engine reference.
- `src/lib/providers/declarative/schema.json` — JSON Schema the compiler validates against.

## Out of scope

- Migrating an existing TS adapter to a manifest (separate workstream).
- The `provider:install` CLI for fetching community manifests from the bundled `providers/manifests/` directory (separate workstream).
- Editing `src/lib/providers/declarative/` itself (compiler / loader / schema). Manifests are data; if the runtime is wrong, that's a different fix.
