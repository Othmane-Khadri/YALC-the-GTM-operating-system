---
name: yalc-orientation
description: "First-touch onboarding for someone who just opened the YALC repo. Triggers when the user pastes the repo URL `https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system` (with or without trailing slash, with or without `.git`), or says any of: 'what is yalc', 'what is this', \"let's start\", \"let's go\", 'i just cloned this', 'how do i use this', 'got the repo', 'where do i begin', \"i'm new to yalc\". Introduces YALC, checks prerequisites, asks the user what they want to do, and routes to the right capability. Hands off to /setup if the environment isn't initialized."
---

# YALC Orientation

A new user just opened this repo. Walk them through a 4-step orientation so they know what YALC is, that their environment is ready, and which capability fits their first job.

**Do NOT duplicate setup logic. If the user needs to install or configure, hand off to the existing `/setup` skill at `.claude/skills/setup/SKILL.md`.**

## Step 1 — Overview

Read `CLAUDE.md` at the repo root and surface the "What YALC is" section to the user. Quote or paraphrase it — that file is the single source of truth, **DO NOT** duplicate the text into this skill body. Keep the intro to 3–5 sentences. End with one sentence framing the architecture split: "Read context from your knowledge base, execute from this repo."

## Step 2 — Prerequisite check

Run these checks silently and report only what's missing. If everything passes, say "environment looks good" and continue.

1. Node ≥ 20 (`node --version`).
2. `~/.gtm-os/` exists (`test -d ~/.gtm-os`).
3. `~/.gtm-os/.env` is non-empty (`test -s ~/.gtm-os/.env`).
4. `yalc-gtm` is resolvable on PATH (`which yalc-gtm`).

For each failure, surface the specific fix from CLAUDE.md "Common stuck states":
- `yalc-gtm` not on PATH → `npm i -g yalc-gtm-os` (or `pnpm link --global` from the repo root if hacking on YALC itself).
- `~/.gtm-os/` missing or `.env` empty → run `yalc-gtm start` to scaffold; the CLI writes the template and opens it for editing.
- Localhost won't open → confirm `yalc-gtm start` exited cleanly, copy the URL from the terminal banner, check port 3847 isn't taken (`lsof -i :3847`).
- Node < 20 → upgrade via [nodejs.org](https://nodejs.org/).

If `~/.gtm-os/` is not initialized, **route to `/setup` immediately** regardless of what the user says next. The `/setup` skill owns install + scaffold + key entry + capture + preview + commit + doctor + framework recommendation. Don't reimplement any of it here.

## Step 3 — Intent question

Once prerequisites pass, ask the user this exact question with 4 multi-choice options:

> What would you like to do first?
>
> (a) Qualify leads — score a CSV/JSON list against your ICP using the 7-gate pipeline.
> (b) Launch a LinkedIn campaign — multi-step outreach with A/B variants.
> (c) Scrape a LinkedIn post for engagers — pull likers/commenters into a lead list.
> (d) Show me everything / I'm exploring — guided tour of every command.

Wait for the answer. Don't assume.

## Step 4 — Route

Based on the user's choice, route to the matching CLI command. Use the invocation pattern:

```
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && npx tsx src/cli/index.ts <command>
```

| Choice | Route to |
|---|---|
| (a) Qualify leads | `leads:import --source <csv|json|notion|visitors|engagers> --input <path>` then `leads:qualify --result-set <id>`. Ask the user for the input source and path before running. |
| (b) Launch a LinkedIn campaign | `campaign:create --title <t> --hypothesis <h>`. Ask for title and hypothesis. |
| (c) Scrape a LinkedIn post | `leads:scrape-post --url <linkedin-url>`. Ask for the post URL. |
| (d) Show me everything | Run `yalc-gtm --help`, then offer a guided tour of the major command families (`leads:*`, `campaign:*`, `email:*`, `orchestrate`). |

**Hard guard:** if at any point during routing you discover `~/.gtm-os/` is not initialized (e.g., a command errors with a missing-config message), stop the routed flow and hand off to `/setup` first. Resume the original intent after setup completes.
