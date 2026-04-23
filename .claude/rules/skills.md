# Skill Development Rules

Applies to: `src/lib/skills/`

## Context to Load
- `src/lib/skills/types.ts` — the `Skill` interface definition
- `src/lib/skills/registry.ts` — how skills are registered and discovered
- Any existing skill in `src/lib/skills/builtin/` — use as pattern reference

## Skill Interface Requirements
Every skill must implement:
- `id` — unique kebab-case identifier
- `name` — human-readable display name
- `description` — one-line summary for `skills:browse`
- `type` — skill category (enrichment, qualification, outreach, intelligence, etc.)
- `capabilities` — array of capability tags for skill routing
- `isAvailable()` — async check if required services/credentials are configured
- `canExecute(context)` — validate inputs before execution
- `execute(context)` — async generator that yields `RowBatch` objects
- `getColumnDefinitions()` — output schema for the data this skill produces

## Hard Rules
1. **`execute()` must yield `RowBatch` objects** via async generator. Never return a flat array.
2. **All skills register in `SkillRegistry`** (`src/lib/skills/registry.ts`) and must be discoverable via `skills:browse`.
3. **Markdown skills** (`.md` files in `~/.gtm-os/skills/`) are also valid skill definitions. They get loaded dynamically at runtime.
4. Skills must handle their own error boundaries — a failing skill should not crash the pipeline.
5. Add new builtin skills to `src/lib/skills/builtin/index.ts` barrel export.

## Creating a New Skill
1. Copy an existing skill from `src/lib/skills/builtin/` (e.g., `find-people.ts`)
2. Implement all interface methods
3. Register in `src/lib/skills/builtin/index.ts`
4. Test with `npx tsx src/cli/index.ts skills:browse` to verify discovery
