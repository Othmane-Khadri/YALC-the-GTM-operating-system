# Skills System

The skills system allows GTM-OS to expose capabilities as composable, callable units.

## Architecture

```
src/lib/skills/
├── types.ts      # Skill interface definition
├── registry.ts   # Skill discovery and registration
└── README.md     # This file
```

## How It Works

1. Each skill is a self-contained GTM capability (find companies, enrich data, qualify leads)
2. Skills are registered in the registry at startup
3. The registry converts skills to Claude tool definitions
4. Claude selects and composes skills based on user intent
5. The execution engine runs skills in sequence or parallel

## Future: Skill Files

Individual skills will live in subdirectories:
```
src/lib/skills/
├── find-companies/
├── enrich-tech-stack/
├── qualify-leads/
├── personalize-outreach/
└── export-csv/
```

Each skill directory contains the implementation and its Anthropic tool schema.
