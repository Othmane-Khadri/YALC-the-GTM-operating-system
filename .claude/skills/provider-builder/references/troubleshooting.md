# Provider Builder Troubleshooting

Common docs-extraction and smoke-failure patterns, with concrete fixes. Read this before retrying a 3rd smoke iteration.

## A. Auth shape wrong (HTTP 401 / 403)

### Symptom
`pnpm cli adapters:smoke …` returns `ProviderApiError` with status 401 or 403, often with body `{"error": "Unauthorized"}` or `{"message": "Invalid API key"}`.

### Diagnosis
The auth stanza doesn't match what the vendor expects. Three common shapes:

| Vendor sends | Manifest auth |
|---|---|
| `Authorization: Bearer <key>` | `type: bearer`, `value: ${env:VAR}` (no `name`) |
| `X-Api-Key: <key>` (or any custom header) | `type: header`, `name: X-Api-Key`, `value: ${env:VAR}` |
| `?api_key=<key>` (query string) | `type: query`, `name: api_key`, `value: ${env:VAR}` |

### Fix
Re-read the vendor's docs auth section. Cross-check what header / param name they show in the `curl` example. Update `auth.type` and `auth.name`. Re-run smoke.

If 401 persists with a manifest that looks correct, run a raw `curl` with the same key and headers the manifest produces — if curl works and smoke doesn't, the bug is in template rendering (open `references/yaml-template.yaml` for the supported `${env:VAR}` syntax — env interpolation only happens via that exact form, not bare `{{env.VAR}}`).

## B. Wrong endpoint / wrong method (HTTP 404 / 405)

### Symptom
404 on a URL that works in the docs, or 405 "method not allowed."

### Diagnosis
- 404 — usually a base-URL typo (missing version segment like `/v1/` or wrong subdomain like `api.` vs. `app.`). Some vendors namespace by region: `api.eu.example.com` vs `api.us.example.com`.
- 405 — the docs listed POST and you set GET (or vice versa).

### Fix
Compare the manifest's `endpoint.url` + `endpoint.method` against the vendor's docs example exactly. Watch for:
- Missing/extra trailing slash
- Region-specific subdomains (vendor account dashboard usually shows the right one)
- Plural / singular endpoint names (`/companies` vs `/company`)

## C. Required field missing (HTTP 400)

### Symptom
400 with body `{"error": "Field 'foo' is required"}` or similar.

### Diagnosis
The vendor expects a field your `bodyTemplate` doesn't include, or a `queryTemplate` param you forgot.

### Fix
Add the field with `{{input.foo}}` and update `smoke_test.input` to provide it. If the field is constant across all calls (e.g., a `format: json` flag), hard-code it in the template — placeholders are only needed for runtime-variable values.

## D. expectNonEmpty paths empty (smoke red despite HTTP 200)

### Symptom
`adapters:smoke` exits 1 with output like:
```
[MISS] companies[0].domain → <undefined>
```
The HTTP call succeeded, but the `expectNonEmpty` paths are blank.

### Diagnosis
`rootPath` or `mappings` are misaligned with the actual response shape. Inspect the raw response:

```bash
pnpm cli adapters:smoke /tmp/yalc-builder/<file>.yaml --json
```

Look at `response` — that's what the projector returned. Walk the JSON manually and compare to your mappings.

### Common cases

1. **Response wraps the array deeper than expected.** Vendor returns `{"data": {"results": [...]}}` and your `rootPath: data` only descends one level. Fix: `rootPath: data.results`.

2. **Mapping reads from the wrong row.** Source `$.name` reads the `name` field on the current row. If the row doesn't have a `name` field, look at the actual key — e.g. `displayName`, `companyName`, `org_name`.

3. **Array projection without `[]` in target.** A target like `companies.domain` (no brackets) is a scalar — it won't iterate. To project an array, the target MUST have `[]`: `companies[].domain`.

4. **rootPath points at a scalar, not an array.** If `rootPath: data` returns `{ id: 1 }` (an object, not array), `companies[].name` projects an empty array. Use `rootPath: $` (root) for object-shaped responses and project scalars only.

## E. Vendor uses GraphQL

### Symptom
The docs show `POST /graphql` with a body containing `{ "query": "...", "variables": {...} }`. Smoke returns valid HTTP 200 with `{ "errors": [...] }`.

### Diagnosis
GraphQL works fine in declarative manifests if you treat `/graphql` as a normal POST endpoint:

```yaml
endpoint:
  method: POST
  url: https://api.example.com/graphql
request:
  contentType: application/json
  bodyTemplate: |
    {
      "query": "query Search($q: String!) { companies(query: $q) { id name domain } }",
      "variables": { "q": "{{input.keywords}}" }
    }
response:
  rootPath: data.companies
  mappings:
    "companies[].name": "$.name"
    "companies[].domain": "$.domain"
  errorEnvelope:
    matchPath: $.errors
    messagePath: $.errors[0].message
```

The `errorEnvelope.matchPath: $.errors` is the GraphQL-specific bit — GraphQL returns 200 with an `errors` array on failure, so without the envelope the manifest treats failed queries as success.

## F. Vendor uses an SDK with no documented REST endpoint

### Symptom
The docs page says "use our official Node SDK" and links to GitHub. There's no `curl` example. Network tab shows the SDK calling proprietary internal endpoints.

### Diagnosis
Out of scope for declarative v1.

### Fix
Exit cleanly. Tell the user this needs a TS adapter at `src/lib/providers/adapters/<capability>-<provider>.ts` that wraps the SDK. See `peopleEnrichFullenrichAdapter` as a starting template.

## G. Vendor requires signed requests (AWS Sigv4 / HMAC)

### Symptom
The docs reference "signature v4", `aws_access_key_id`, `aws_secret_access_key`, or a "Signature" header computed from the request body.

### Diagnosis
Out of scope for declarative v1. The compiler can't compute request signatures.

### Fix
Same as F — exit cleanly, recommend TS adapter.

## H. Vendor needs OAuth or two-call flow

### Symptom
Auth requires hitting `/oauth/token` first, getting a short-lived token, then calling the data endpoint. Or the docs reference `client_id` + `client_secret` + browser redirect.

### Diagnosis
Out of scope for declarative v1. The DSL supports static auth and one HTTP call per execute.

### Fix
Exit cleanly, recommend TS adapter. Note that some vendors offer a "personal access token" alongside OAuth — if so, prefer that path and use `type: bearer`.

## I. Compile error: "unknown template root"

### Symptom
`ManifestValidationError: unknown template root in {{foo.bar}} — allowed: input, env, auth`

### Diagnosis
You used `{{foo.bar}}` where `foo` isn't `input`, `env`, or `auth`. Often a typo (`{{inputs.x}}` instead of `{{input.x}}`) or trying to chain (`{{input.contacts | first | x}}` — only `default` and `json` filters are supported).

### Fix
Re-root to `input.*` / `env.*` / `auth.*`. For "first contact" semantics, write `{{input.contacts[0].x}}`.

## J. Compile error: "yaml parse failed"

### Symptom
`ManifestValidationError: yaml parse failed: …`

### Diagnosis
YAML syntax error. Most often caused by an unquoted Mustache placeholder at the start of a value:

```yaml
# WRONG — `{{` looks like a YAML flow-mapping start
url: {{input.endpoint}}

# RIGHT — quote it
url: "{{input.endpoint}}"
```

Also watch for trailing tabs and inconsistent indentation in `bodyTemplate` block scalars.

### Fix
Quote any value that begins with `{`, `[`, `!`, `&`, `*`, `?`, `:`, or `-`. Validate with `yamllint` or `python -c "import yaml; yaml.safe_load(open('file.yaml'))"`.

## K. MissingApiKeyError

### Symptom
`MissingApiKeyError: APOLLO_API_KEY`

### Diagnosis
The env var referenced in `auth.value` (and any `${env:…}` in templates) is not set in `process.env` when smoke runs.

### Fix
Ask the user to set it in `~/.gtm-os/.env` and re-run from a shell that sourced that file. Check with:

```bash
node -e "console.log(process.env.APOLLO_API_KEY ? 'set' : 'unset')"
```

**Never** read `~/.gtm-os/.env` directly. **Never** print the value back. The above command is the maximum disclosure allowed.

## L. Mapping target naming doesn't match the capability's output schema

### Symptom
Smoke is green (paths populate), but downstream skills break with a validation error like "expected field `companies` not found, got `orgs`".

### Diagnosis
The capability's `outputSchema` declares specific top-level keys (e.g. `companies`, `results`, `contacts`). Your mapping invented a different name.

### Fix
Read the capability's `outputSchema` in `src/lib/providers/capabilities.ts` and re-name the mapping target so it matches exactly. If the capability expects `companies[].name`, the mapping target must literally be `companies[].name` — not `orgs[].name`, not `data[].name`.
