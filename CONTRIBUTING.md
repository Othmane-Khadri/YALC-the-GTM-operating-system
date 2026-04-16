# Contributing to YALC

Thanks for your interest in contributing to YALC. Here's how to get started.

## Development Setup

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system.git
cd YALC-the-GTM-operating-system
pnpm install
cp .env.example .env.local   # Add at least ANTHROPIC_API_KEY
pnpm typecheck                # Verify everything compiles
pnpm test                     # Run the test suite
```

## Architecture Rules

YALC follows a strict **three-layer pattern**:

```
Service (API wrapper) → Provider (StepExecutor) → Skill (user-facing operation)
```

Never skip layers. A skill should never call an API directly — it goes through a provider, which goes through a service.

## Code Conventions

- **TypeScript** with strict mode, ESM only (`"type": "module"`)
- **File names:** kebab-case (`campaign-manager.ts`)
- **Imports:** Use `.js` extensions in relative imports (ESM requirement) and `node:` prefix for built-ins
- **Tests:** Vitest, co-located in `__tests__/` directories, in-memory SQLite

## Before Submitting a PR

1. `pnpm typecheck` passes with no errors
2. `pnpm test` — all tests pass
3. Any command that sends or writes supports `--dry-run`
4. No API keys or secrets in code — use `sk-...redacted` pattern in examples
5. Campaign outcomes are wired to the intelligence store

## Adding a New Provider

1. Create `src/lib/providers/builtin/<name>-provider.ts`
2. Implement the `StepExecutor` interface from `src/lib/providers/types.ts`
3. Register it in `src/lib/providers/builtin/index.ts`
4. Add required env vars to `.env.example`
5. Write tests in `src/lib/providers/builtin/__tests__/<name>.test.ts`
6. Document the provider in `docs/providers.md`

## Adding a New Skill

1. Create `src/lib/skills/builtin/<name>.ts`
2. Export a `Skill` object with id, name, description, category, inputSchema, and execute function
3. Register it in `src/lib/skills/builtin/index.ts`
4. Add the skill to `docs/skills.md`

## Reporting Bugs

Open an issue at https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system/issues with:
- What you expected to happen
- What actually happened
- Output of `yalc-gtm doctor`
- Your Node.js version (`node --version`)

## Security Vulnerabilities

Do **not** file public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.
