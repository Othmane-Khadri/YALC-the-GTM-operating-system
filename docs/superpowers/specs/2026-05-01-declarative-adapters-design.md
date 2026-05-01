# Declarative Adapter Manifests + Provider-Builder Skill

**Status:** Design spec — v1 proposal
**Date:** 2026-05-01
**Owner:** YALC GTM-OS core
**Branch:** `wt/b1-spec`

## Context

YALC ships 21 capability adapters as TypeScript files under `src/lib/providers/adapters/`. Each implements `CapabilityAdapter` (see `src/lib/providers/capabilities.ts`) and is wired into `registerBuiltinCapabilities()`. Adding a new provider — even a thin REST wrapper like Apollo — requires editing the package and shipping a release.

This spec proposes a declarative path: a YAML DSL under `~/.gtm-os/adapters/`, a runtime compiler that turns each manifest into a fetch call, and a Claude Code skill (`provider-builder`) that lets a user add a new provider in a 5-minute conversation. Built-in TS adapters keep working unchanged; declarative adapters layer onto the same `CapabilityRegistry`.

## 1. Manifest format (YAML DSL)

Manifests live at `~/.gtm-os/adapters/<capability>-<provider>.yaml`. One file per (capability, provider) pair.

**Schema (manifestVersion 1) — required fields unless marked optional:**

- `manifestVersion`: integer, currently `1`.
- `capability`: capability id, must match a registered `Capability`.
- `provider`: provider id, unique per capability.
- `version`: adapter semver, bumped on each manifest edit.
- `auth`: `{ type: header|query|bearer, name, value }`. `value` uses `${env:VAR}` interpolation.
- `endpoint`: `{ method, url, queryTemplate? }`. URL supports `{{var}}` from a merged scope.
- `request` (optional): `{ headers?, bodyTemplate?, contentType? }`. Body is JSON with placeholders. Omit for GET.
- `response`: `{ rootPath, mappings, errorEnvelope }`. `mappings` projects raw fields onto the capability's output schema.
- `pagination` (optional): `{ style: cursor|page, pageParam, cursorPath, limit }`. Compiler walks pages until `limit` items collected.
- `rateLimit` (optional): `{ rps?, retry: { on: [429, 503], backoff: exponential, maxAttempts: 3 } }`.
- `smoke_test`: `{ input, expectNonEmpty: [paths] }`. Run by the provider-builder skill before registration.

Templates use Mustache-flavour `{{var}}` against a merged scope: `input.*`, `env.*` (whitelisted), `auth.*`. Unknown placeholders are a compile error.

### Example A — `icp-company-search` via Apollo

```yaml
manifestVersion: 1
capability: icp-company-search
provider: apollo
version: 0.1.0
auth:
  type: header
  name: X-Api-Key
  value: ${env:APOLLO_API_KEY}
endpoint:
  method: POST
  url: https://api.apollo.io/v1/mixed_companies/search
request:
  contentType: application/json
  bodyTemplate: |
    {
      "q_organization_keyword_tags": ["{{input.keywords}}"],
      "organization_locations": ["{{input.location}}"],
      "organization_num_employees_ranges": ["{{input.employeeRange}}"],
      "page": 1,
      "per_page": {{input.limit | default: 25}}
    }
response:
  rootPath: organizations
  mappings:
    "companies[].name": "$.name"
    "companies[].domain": "$.primary_domain"
    "companies[].linkedin_url": "$.linkedin_url"
    "companies[].headcount": "$.estimated_num_employees"
  errorEnvelope:
    matchPath: $.error
    messagePath: $.error
smoke_test:
  input:
    industry: "SaaS"
    employeeRange: "11-50"
    location: "United States"
    limit: 5
  expectNonEmpty: [companies, "companies[0].domain"]
```

### Example B — `people-enrich` via PeopleDataLabs (PDL)

```yaml
manifestVersion: 1
capability: people-enrich
provider: peopledatalabs
version: 0.1.0
auth:
  type: header
  name: X-Api-Key
  value: ${env:PDL_API_KEY}
endpoint:
  method: GET
  url: https://api.peopledatalabs.com/v5/person/enrich
  queryTemplate:
    first_name: "{{input.contacts[0].firstname}}"
    last_name: "{{input.contacts[0].lastname}}"
    company: "{{input.contacts[0].company_name}}"
    profile: "{{input.contacts[0].linkedin_url}}"
response:
  rootPath: data
  mappings:
    "results[].firstname": "$.first_name"
    "results[].lastname": "$.last_name"
    "results[].email": "$.work_email"
    "results[].phone": "$.mobile_phone"
    "results[].linkedin_url": "$.linkedin_url"
  errorEnvelope:
    matchPath: $.status
    matchValue: error
    messagePath: $.error.message
smoke_test:
  input:
    contacts:
      - firstname: Marc
        lastname: Benioff
        company_name: Salesforce
  expectNonEmpty: ["results[0].email"]
```

### Example C — `landing-page-deploy` via Vercel

```yaml
manifestVersion: 1
capability: landing-page-deploy
provider: vercel
version: 0.1.0
auth:
  type: bearer
  value: ${env:VERCEL_TOKEN}
endpoint:
  method: POST
  url: https://api.vercel.com/v13/deployments?teamId={{env.VERCEL_TEAM_ID}}
request:
  contentType: application/json
  bodyTemplate: |
    {
      "name": "{{input.slug | default: page}}",
      "files": [
        {"file": "index.html", "data": {{input.html | json}}}
      ],
      "projectSettings": {"framework": null},
      "target": "production"
    }
response:
  rootPath: $
  mappings:
    "deployed": "$.readyState == 'READY'"
    "url": "https://$.url"
    "fallbackReason": null
  errorEnvelope:
    matchPath: $.error.code
    messagePath: $.error.message
smoke_test:
  input:
    html: "<!doctype html><h1>yalc-smoke</h1>"
    slug: "yalc-smoke"
  expectNonEmpty: [url]
```

## 2. Runtime compilation

`src/lib/providers/declarative/compile.ts` exposes:

```ts
export interface CompiledManifest {
  capabilityId: string
  providerId: string
  envVars: string[]
  invoke(input: unknown, ctx: AdapterContext): Promise<unknown>
}

export function compileManifest(raw: string, source: string): CompiledManifest
```

The compiler:

1. Parses YAML and validates against the `manifestVersion: 1` schema (ajv). Validation errors include the offending JSON pointer.
2. Resolves env-var references in `auth.value` and `endpoint.url`. Missing env vars raise `MissingApiKeyError(provider, varName)` — the same class declarative adapters share with built-in ones, so the existing capability error envelope stays consistent.
3. Validates capability input via the registered `Capability.inputSchema` (ajv). Bad input raises `ValidationError` before any HTTP call.
4. Renders `endpoint.url`, `endpoint.queryTemplate`, `request.bodyTemplate`, and `request.headers` against the merged scope. Unknown placeholders fail compile, not run, so manifests are deterministic.
5. Issues the fetch with the resolved auth + body. On non-2xx OR on a body matching `response.errorEnvelope`, throws `ProviderApiError(provider, message, status)`.
6. Walks `response.mappings` (JSONPath-lite) into the capability's `outputSchema` shape and returns the result. The output is re-validated against `Capability.outputSchema` so a buggy manifest can't poison downstream skills.
7. Pagination (when declared) loops until `limit` items are collected or the cursor exhausts, concatenating into the same array slot.

**Caching.** No response cache in v1. The compiled `CompiledManifest` is memoized in-process keyed by `(source, mtime)` so adapter dir reads happen once per process. Response caching, if added later, lives in `signals_log` — out of scope here.

**Error normalization.** Declarative adapters throw the existing `MissingApiKeyError`, `ProviderApiError`, and `ValidationError` classes. Skills don't need to know whether the adapter is TS or YAML.

## 3. Capability registry integration

The registry today resolves adapters via this loop in `src/lib/providers/capabilities.ts`:

```ts
const configured = readConfiguredPriority(capabilityId)
const priority = configured ?? cap.defaultPriority
for (const providerId of priority) {
  tried.push(providerId)
  const adapter = bucket.get(providerId)
  if (!adapter) continue
  if (!isAdapterAvailable(adapter, providerRegistry)) continue
  return adapter
}
```

Declarative adapters plug into the same `bucket` (the `Map<providerId, CapabilityAdapter>` already maintained per capability). A new loader, `registerDeclarativeAdapters(registry)`, runs **after** `registerBuiltinCapabilities()`. It scans `~/.gtm-os/adapters/*.yaml`, compiles each, and calls `registry.register({ capabilityId, providerId, isAvailable, execute })` where `execute` delegates to `CompiledManifest.invoke`.

**Priority resolution.** Unchanged. User config (`~/.gtm-os/config.yaml → capabilities.<id>.priority`) wins, then `defaultPriority` from the capability declaration. To prefer a declarative adapter over the built-in one, the user adds the new provider id to their priority list:

```yaml
capabilities:
  icp-company-search:
    priority: [apollo, crustdata]
```

When the same `(capabilityId, providerId)` exists as both a built-in TS adapter and a declarative manifest, the declarative manifest **overrides** the built-in (last write to `bucket.set()` wins). This makes hot-patching a broken TS adapter possible without shipping a YALC release: drop a manifest with the same provider id and it takes over. A startup log line announces the override so users see it.

**isAvailable.** A declarative adapter is "available" iff every env var referenced in `auth.value` is present in the process env. No registry executor lookup is needed (declarative adapters bypass the provider registry — they are self-contained).

## 4. Provider-builder skill

Lives at `.claude/skills/provider-builder/SKILL.md` plus a small reference folder (`schema.md`, `mappings-cheatsheet.md`).

**Trigger phrases:** "add a new provider for X", "wire up [vendor] to YALC", "build an adapter for [vendor]", "I want to use [vendor] for [capability]".

**Inputs:** vendor name, target capability id, vendor docs URL (optional but recommended), API key env var name (the skill double-checks the user has it in `~/.gtm-os/.env` without ever reading the value).

**Workflow:**

1. **Discover.** Resolve the capability id (fuzzy match — "find emails" → `people-enrich`). Show the capability's input/output schema.
2. **Read vendor docs.** WebFetch / Firecrawl the docs URL. Pull endpoint, auth, request and response shapes.
3. **Draft manifest.** Write YAML to `/tmp/yalc-builder/{capability}-{provider}.yaml` first (not the live adapters dir).
4. **Smoke test.** Run `smoke_test.input` against the compiled invoke. Green = `expectNonEmpty` paths populated. Red = print response, revise mapping/auth, loop.
5. **Register.** On green, move file to `~/.gtm-os/adapters/`, append the provider id to `config.yaml → capabilities.<id>.priority` (front of list, with confirmation).
6. **Document.** Append a one-line entry to `~/.gtm-os/adapters/INSTALLED.md`.

**Failure modes:**

- *Vendor docs incomplete.* Skill asks for the missing piece. Never guesses.
- *Auth flow non-trivial (OAuth, signed requests).* Detected in step 2; skill exits with "needs a TS adapter — out of scope for declarative v1" plus a stub TS template.
- *SDK-only vendors (gRPC, websockets).* Same exit.
- *Smoke test red after 3 iterations.* Skill stops, dumps last response + last manifest to `/tmp/yalc-builder/debug.json`, hands back to user.

## 5. Security

All credentials live in `~/.gtm-os/.env` and are loaded by the existing keys system at process start. **Manifests never contain secrets.** They reference env vars exclusively via `${env:VAR_NAME}`.

When a manifest is loaded:

- The compiler scans `auth.value` and `endpoint.url` for `${env:...}` references and records them on `CompiledManifest.envVars`.
- At register time, if any required env var is missing, the adapter is registered but `isAvailable()` returns false. A warning is logged: `[declarative:apollo] APOLLO_API_KEY missing — adapter registered but unavailable`.
- At execute time (defensive double-check), missing env vars raise `MissingApiKeyError` with the variable name — same UX as built-in adapters.

The provider-builder skill must NEVER write a key value into a manifest, NEVER print a key value back to the user, and NEVER read the contents of `~/.gtm-os/.env`. It only verifies the env var name is set in the live process. (This matches the user's standing rule on never displaying secrets in chat.)

## 6. Versioning + deprecation

**Schema version.** Every manifest declares `manifestVersion: 1`. The compiler refuses unknown versions and prints an upgrade hint. Bumps are reserved for breaking changes.

**Deprecating built-in TS adapters.** When a declarative manifest reaches parity:

1. Mark the TS file `@deprecated since 0.x.0 — use docs/adapters/<capability>-<provider>.yaml`.
2. Move the canonical YAML into `docs/adapters/` (shipped, not loaded by default).
3. After two minor versions, delete the TS file. Users opt in via `yalc-gtm provider:install <capability>-<provider>`.

**Migration guide.** A one-pager in `docs/providers.md` covers: spotting deprecated providers via `yalc-gtm doctor`, installing the declarative replacement, and overriding behaviour locally.

## 7. Community providers (in-repo)

Community manifests live inside the YALC repo under `providers/manifests/<capability>/<provider>.yaml`. Single repo for engine + manifests — contributors PR to the same place and use the same issue tracker.

**Layout:**

```
providers/
  manifests/
    icp-company-search/
      apollo.yaml
    people-enrich/
      peopledatalabs.yaml
    crm-contact-upsert/
      hubspot.yaml
    email-campaign-create/
      brevo.yaml
  scripts/
    validate.mjs   # ajv-validates every manifest against the canonical schema at src/lib/providers/declarative/schema.json
    smoke.mjs      # wraps `yalc-gtm adapters:smoke <path>`
  README.md
  CONTRIBUTING.md
```

`.github/workflows/providers-validate.yml` runs `validate.mjs` on PRs touching `providers/**` or the schema.

**PR checklist** (auto-loaded from `.github/PULL_REQUEST_TEMPLATE.md`): confirm the smoke test passed locally, paste the smoke output (credentials redacted), declare any rate-limit gotchas, and tick a checkbox confirming no secrets are inlined.

**Curation rules (light).** Merge requires (a) CI green (schema validation), (b) one maintainer sign-off, (c) a smoke-test reply in the PR. One canonical manifest per (capability, provider) lives on `main`; variants live on branches.

**Installing.** CLI: `yalc-gtm provider:install icp-company-search/apollo` fetches the YAML from `main`, writes it to `~/.gtm-os/adapters/`, and prompts to add to `config.yaml` priority. Manual: download the YAML from the raw GitHub URL and drop it in.

## 8. Test plan

**Unit tests** (`src/lib/providers/declarative/__tests__/compile.test.ts`):

- Schema validation rejects unknown fields, missing required fields, bad `manifestVersion`.
- Template rendering substitutes `input.*`, `env.*`, `auth.*` correctly; rejects unknown placeholders.
- Mapping projects nested arrays into `arr[].field` slots.
- Error envelope detection turns vendor error bodies into `ProviderApiError`.
- Missing env vars produce `MissingApiKeyError` with the right variable name.
- Pagination loop stops at `limit` and concatenates page results.

**Integration tests** (one per migrated adapter — proof of parity):

- `peopledatalabs` for `people-enrich`: recorded fixture, same shape as `peopleEnrichFullenrichAdapter`.
- `hubspot` for a new `crm-contact-upsert` capability: end-to-end against HubSpot sandbox.
- `brevo` for `email-campaign-create`: parity check vs. `emailCampaignCreateInstantlyAdapter`.

Recorded fixtures live in `__fixtures__/declarative/<provider>/<scenario>.http.json` and are replayed via a fetch shim so tests are hermetic.

**E2E for provider-builder.** A mock vendor server (Express on a random port) exposes `/search` and `/docs`. Skill invoked with `vendor: mockco, capability: icp-company-search`. Assertions: docs fetched, manifest drafted, smoke green, file in a temp adapters dir, capability resolves to `mockco` after priority bump.

## 9. Out of scope (v1)

Called out so they don't block shipping:

- **Multi-step OAuth flows** (Google, HubSpot OAuth, Salesforce). Redirect + token refresh — declarative templates can't express that. Bearer/header auth vendors ship now; OAuth vendors stay on TS adapters.
- **Non-HTTP transports** (gRPC, websockets, custom binary). DSL is fetch-only.
- **Request signing** (AWS Sigv4, vendor HMAC). v1 supports static auth only.
- **Streaming responses** (SSE, chunked). Reasoning capability stays on TS Anthropic/OpenAI adapters.
- **Cross-step state** ("first /token, then /search"). One HTTP call per execute; two-call flows need a TS adapter.

All future-work candidates for `manifestVersion: 2` once declarative v1 has traction.

---

**Acceptance for v1 ship:** Three community manifests merged (Apollo, PeopleDataLabs, Brevo). `provider-builder` skill completes a real "add Apollo" flow under 5 min against fresh user state. Integration tests pass in CI. `docs/providers.md` documents the override + migration model.
