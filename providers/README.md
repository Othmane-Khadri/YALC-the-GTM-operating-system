# Community providers

Declarative adapter manifests for YALC. A manifest is a single YAML file that teaches YALC how to talk to a vendor API for one capability (`icp-company-search`, `people-enrich`, `crm-contact-upsert`, etc.) without writing a TypeScript adapter. The engine compiles the manifest at boot and registers it as a regular capability adapter — CLI, Notion sync, and campaign runners treat it identically to a built-in.

The manifest spec lives at [`docs/superpowers/specs/2026-05-01-declarative-adapters-design.md`](../docs/superpowers/specs/2026-05-01-declarative-adapters-design.md). The canonical JSON Schema is at [`src/lib/providers/declarative/schema.json`](../src/lib/providers/declarative/schema.json) — `validate.mjs` reads from there directly so there's no duplicate to drift.

## What's in here

```
providers/
  manifests/
    <capability>/
      <provider>.yaml
  scripts/
    validate.mjs   — schema-validate every manifest
    smoke.mjs      — run a manifest's smoke test via `yalc-gtm adapters:smoke`
```

One canonical manifest per `(capability, provider)` pair. Variants live on branches; `main` is curated.

Currently shipped on `main`:

| Capability | Provider | Status |
|------------|----------|--------|
| `icp-company-search` | `apollo` | Smoke-pending (live vendor not exercised in CI) |
| `people-enrich` | `peopledatalabs` | Bundled in 0.11.0 (smoke green) |
| `crm-contact-upsert` | `hubspot` | Bundled in 0.11.0 (smoke green) |
| `email-campaign-create` | `brevo` | Bundled in 0.11.0 (smoke green) |

## Installing a manifest into your local YALC

You need YALC installed first:

```bash
pnpm add -g yalc-gtm-os
```

### Method 1 — via the `provider:install` CLI (recommended)

One command fetches a manifest from this repo's `main`, validates it, drops it in `~/.gtm-os/adapters/`, and offers to update your `config.yaml` priority:

```bash
yalc-gtm provider:install icp-company-search/apollo
```

Optional flags:

- `--source <url>` — pull from a fork or unmerged branch (URL used verbatim)
- `--force` — overwrite an existing manifest at the target path
- `--no-priority-update` — skip the config.yaml prompt
- `--yes` — auto-confirm the priority-list update

Set the matching env var in `~/.gtm-os/.env` (the install output prints which one), then verify:

```bash
yalc-gtm adapters:list
```

You should see the new provider tagged `[user]`. Run a live smoke test before depending on it:

```bash
yalc-gtm adapters:smoke ~/.gtm-os/adapters/icp-company-search-apollo.yaml
```

### Method 2 — manual drop

```bash
mkdir -p ~/.gtm-os/adapters
curl -L https://raw.githubusercontent.com/Othmane-Khadri/YALC-the-GTM-operating-system/main/providers/manifests/icp-company-search/apollo.yaml \
  -o ~/.gtm-os/adapters/icp-company-search-apollo.yaml
```

Then update `~/.gtm-os/config.yaml` if you want it to win priority over the built-ins:

```yaml
capabilities:
  icp-company-search:
    priority:
      - apollo
      - crustdata
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Short version:

1. Read the manifest spec linked above.
2. Author your manifest under `providers/manifests/<capability>/<provider>.yaml`.
3. Validate locally: `node providers/scripts/validate.mjs` (requires `ajv` and `yaml` installed somewhere reachable — the gtm-os root already has them).
4. Smoke against the live vendor: `yalc-gtm adapters:smoke providers/manifests/<cap>/<prov>.yaml`.
5. Open a PR. Paste the smoke output (credentials redacted) into the PR body.
