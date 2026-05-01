# Contributing community providers

Thanks for considering a contribution. The `providers/` tree inside the YALC repo is curated lightly: we want a single canonical manifest per `(capability, provider)` pair on `main`, and we want every merged manifest to actually work against the live vendor.

## What can I contribute

- A **new manifest** for a vendor that isn't already on `main` for the target capability.
- A **bug fix** to an existing manifest (e.g. response mapping is missing a field, error envelope misclassifies a 4xx).
- A **doc/README** improvement.

If a manifest already exists on `main` for the same `(capability, provider)` and you want a different shape, push your variant to a feature branch and link to it from your PR — variants live on branches, never on `main`.

## Manifest format

The manifest spec is the source of truth in the engine repo:

- Spec: [`docs/superpowers/specs/2026-05-01-declarative-adapters-design.md`](https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system/blob/main/docs/superpowers/specs/2026-05-01-declarative-adapters-design.md)
- Schema (canonical, used by both runtime and validator): [`src/lib/providers/declarative/schema.json`](../src/lib/providers/declarative/schema.json)

A manifest is a single YAML file that declares:

- `manifestVersion: 1`
- `capability: <slug>` and `provider: <slug>` (must match the directory and filename)
- `auth` block (`header`, `query`, `bearer`, or `none`)
- `endpoint` (HTTP method + URL with `{{input.*}}` / `${env:VAR}` placeholders)
- `request` (body template, content-type, optional headers)
- `response.mappings` projecting vendor JSON onto the capability output schema
- `smoke_test` (a single input that should produce non-empty paths in the output)

Don't inline secrets. All credentials reference env vars via `${env:NAME}`.

## Local workflow

You need Node 20+ and pnpm. From the YALC repo root:

```bash
pnpm install                                                # installs ajv + yaml (already deps of YALC)
node providers/scripts/validate.mjs                         # schema-validate every manifest
node providers/scripts/smoke.mjs providers/manifests/<cap>/<prov>.yaml
```

`smoke.mjs` shells out to `yalc-gtm adapters:smoke <path>`. The CLI is the binary published as `yalc-gtm-os` on npm; if you cloned the repo, `pnpm cli adapters:smoke <path>` works too.

Set the relevant API key in `~/.gtm-os/.env` before running smoke.

## PR checklist

A PR cannot merge until every box below is ticked. The PR template (auto-loaded on PR creation) reproduces this checklist.

- [ ] `node providers/scripts/validate.mjs` exits 0 locally.
- [ ] Smoke ran green locally; smoke output pasted in the PR body with credentials and personal data redacted.
- [ ] No secrets inlined in the YAML — all credentials reference `${env:NAME}`.
- [ ] No existing manifest on `main` for the same `(capability, provider)` pair, OR the PR documents why this one supersedes it.
- [ ] Vendor docs URL pasted in the PR body.
- [ ] CI green (the `validate` workflow runs on every push to PRs targeting `main`).

## Curation rules

- Two maintainers. Merge requires CI green + one maintainer sign-off + a smoke-output reply in the PR.
- One canonical manifest per `(capability, provider)` on `main`.
- Variants live on branches; we don't fork the path tree to support divergent shapes on `main`.
- Bug-fix PRs bump the manifest's `version` field (semver-ish — patch for response mapping fixes, minor for new request fields, major for breaking input shape).
- Manifests that depend on capabilities the engine doesn't yet declare should be opened as a draft PR with a link to the upstream gtm-os PR adding the capability schema.

## What we won't merge

- Manifests that reach a vendor without static API-key auth (OAuth flows are on the engine's roadmap, not v1 of the DSL).
- Manifests that try to express multi-step flows (call `/token` then `/search`). The DSL is one HTTP call per execute by design.
- Manifests with hard-coded test credentials.
- Manifests that duplicate an entry already on `main` without a clear reason.

## Reporting a problem

Open an issue with the manifest path, the failing input, and the smoke output (credentials redacted).
