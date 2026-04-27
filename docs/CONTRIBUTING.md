# Contributing — Publishing & Release Operations

This file covers what's specific to release / publish operations. For
day-to-day contributor setup, see the top-level
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Publishing to npm

YALC ships as `yalc-gtm-os` on npm. Releases happen on the `v*` git tag
once CI is green. The CI publish step needs an automation token in the
repo's GitHub Actions secrets.

### Generate an npm automation token

1. Sign in to npm as the maintainer account.
2. Open https://www.npmjs.com/settings/<your-username>/tokens.
3. Click **Generate New Token → Granular Access Token** (or **Automation**
   for a classic token).
4. Scope it to the `yalc-gtm-os` package, **Read and write** permission,
   no expiration (or 1 year).
5. Copy the token. **Never paste the token into chat, code, or commit
   messages.** This is the same hard rule as every other secret in the
   project.

### Set the token as a GitHub repo secret

```bash
# requires the GitHub CLI authenticated to the repo
gh secret set NPM_TOKEN
# paste the token at the prompt; it never appears in the shell history
```

After the secret is set, every push of a `v*` tag will trigger CI to run
`npm publish --access public --provenance` against the tagged commit.
The provenance attestation gives consumers cryptographic proof that the
tarball came from this repository.

### Until NPM_TOKEN is set, manual publish still works

Manual publish from the worktree:

```bash
unset NPM_TOKEN              # avoid leaking a stale token from your shell
cd /path/to/worktree
npm login                    # interactive: browser auth or OTP
npm publish --access public  # uses the credentials cached by `npm login`
```

The `prepublishOnly` script (`pnpm typecheck && pnpm test`) runs
automatically before `npm publish`, so a failing typecheck or test will
abort the publish before any tarball is uploaded.

## Pre-release checklist

Before tagging a release:

1. `pnpm typecheck` clean.
2. `pnpm test` — all tests pass.
3. `npm pack --dry-run` — inspect the tarball contents. Confirm no
   `.env*` files, no `/Users/` paths, no fixtures, and that
   `.claude/skills/`, `configs/frameworks/`, and `configs/skills/` are
   present.
4. `yalc-gtm doctor` runs from a sandbox HOME without errors.
5. Bump `package.json` `version`. Commit. Tag with `v<version>`.
6. Push the tag (and only the tag) to trigger CI publish.
