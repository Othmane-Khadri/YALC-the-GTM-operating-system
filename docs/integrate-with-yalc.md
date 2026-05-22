# Integrating Your Existing Setup with YALC

## What this does, in plain English

If you were already using Claude Code before discovering YALC — maybe you had your own folder of commands, automations, or AI instructions — this feature helps you bring both setups together without losing anything.

Think of it like merging two toolboxes. YALC has its own set of tools (finding leads, launching campaigns, enriching contacts). You might have your own tools built for your specific workflow. This feature looks at both, spots anything that might clash, and gives you a written plan — which you review before anything is touched.

**Nothing is moved or changed until you say so.**

---

## Who this is for

- You already have a Claude Code setup with your own commands or automations
- You want to start using YALC's outbound tools without breaking what you already have
- You're not sure how to make both coexist without conflicts

If you're brand new to Claude Code and just want to set up YALC from scratch, you don't need this — just say "let's start" in the chat.

---

## How to use it

Open Claude Code in your IDE (VS Code or Cursor) and type one of these:

> "integrate my repo with YALC"

> "I have my own Claude Code setup, how do I add YALC"

> "merge my repo with YALC"

Claude will ask you for two things:

1. **The full path to your existing folder** — for example `/Users/sarah/my-claude-workspace`. This is the folder where your existing Claude Code setup lives.
2. **A one-line description of what your existing setup does** — optional, but helps Claude understand the context. For example: "agency playbooks for B2B SaaS clients".

---

## What happens next — step by step

### 1. Claude reads both setups

Claude looks at:
- What commands and automations you already have (your `.claude/skills/` folder)
- Your existing instructions file (`CLAUDE.md`)
- YALC's full list of built-in tools

This is **read-only**. Nothing is changed during this step.

### 2. Claude produces a written plan

You'll see a plan broken into six sections. Here's what each one means:

**Workspace Setup** — the simplest way to have both setups running side by side without file conflicts. Usually this means keeping them in separate folders and opening both in one IDE window.

**Skill Conflicts** — a table listing any commands where the names or trigger phrases overlap between your setup and YALC's. For example, if you have a command called `qualify-leads` and YALC has one too, that shows up here with a recommendation (keep yours, keep YALC's, or rename one).

**Context Mapping** — anything in your existing setup that should move into YALC's brain: your tone of voice, your ICP definition, your outreach templates. Claude tells you what to move, where it goes, and what to leave alone.

**Orchestration Examples** — a few examples of how your existing commands and YALC's tools can work together in sequence. These are based on what Claude actually found in your setup, not generic examples.

**What to Leave Alone** — an explicit list of everything the plan will NOT touch: your existing instructions file, your project rules, your credentials, any commands that don't conflict. This section exists so you can see clearly that integration is additive — it doesn't overwrite anything.

**Migration Steps** — an ordered checklist. Each step is labelled either `[auto]` (Claude can do it for you) or `[manual]` (you do it). Nothing happens until you confirm.

### 3. You review the plan

Read through it. Ask Claude to adjust anything that doesn't look right. The plan is also saved to a file on your machine (`~/.gtm-os/integration-plan-<today's date>.md`) so you can read it later.

### 4. You say "apply" to run the automatic steps

When you're ready, just reply:

> "apply"

Claude will run every step marked `[auto]` — renaming conflicting commands, copying context files into YALC's preview folder. For any file it's about to delete, it asks for your confirmation individually.

The manual steps are listed clearly so you know exactly what you need to do yourself.

### 5. Review and commit the context (if any was migrated)

If your existing setup had voice, ICP, or outreach templates that moved into YALC's preview folder, you'll need to confirm those before they go live. Claude will tell you exactly what to run:

```
yalc-gtm start --commit-preview
```

---

## A full example

**The situation:** Sarah is a GTM consultant. She's been using Claude Code for six months with her own setup: a `CLAUDE.md` with her agency's rules, three custom commands (`research-client`, `draft-proposal`, and `qualify-lead`), and a voice file describing how she writes.

She discovers YALC and wants to use its LinkedIn outreach and enrichment tools, but doesn't want to lose her existing setup.

---

Sarah opens Claude Code and types:

> "integrate my repo with YALC"

Claude asks:

> 1. What's the absolute path to your existing repo?
> 2. One-line description of what it does (optional)?

Sarah replies:

> `/Users/sarah/agency-claude` — it's my agency operations brain for B2B SaaS GTM consulting.

---

Claude reads both setups and produces the plan:

**Workspace Setup**
> Recommendation: keep both repos in separate folders and open them together as a single VS Code workspace. No file moves needed for this part.

**Skill Conflicts**

| Your command | YALC command | Type | Recommendation |
|---|---|---|---|
| `qualify-lead` | `qualify-leads` | Soft (similar triggers) | Test after integration — rename yours to `qualify-lead-custom` if the wrong one fires |

> Note: Claude Code picks which command to run based on context, not a strict lookup. "Soft" conflicts mean the trigger phrases are similar enough that Claude might occasionally pick the wrong one. The fix is simple: test it, and rename if needed.

**Context Mapping**

| Found in your repo | Action | Where it goes in YALC |
|---|---|---|
| `voice/sarah-tone.md` | Copy to preview folder | `~/.gtm-os/_preview/voice/tone-of-voice.md` |
| `research-client` command | Leave in your repo | — not a YALC concern |
| `draft-proposal` command | Leave in your repo | — not a YALC concern |
| Your `CLAUDE.md` | Leave in your repo | — YALC loads both |

> **YALC will not touch:** your `CLAUDE.md`, your project rules, your `research-client` and `draft-proposal` commands, your credentials, or any file outside `~/.gtm-os/`.

**Orchestration Examples**

> "Research this prospect, then build me a LinkedIn campaign strategy for them"
> → Your `research-client` runs first and builds the company profile, then YALC's `campaign-strategy` reads it and proposes angle, audience, and copy devices.

> "Qualify these leads, then launch a LinkedIn sequence for the ones that pass"
> → Your `qualify-lead-custom` scores the list, then YALC's `launch-linkedin-campaign` takes the qualified set and drafts the outreach.

**What to Leave Alone**
- Your `CLAUDE.md` — stays in your repo, YALC reads it alongside its own
- Your `research-client` and `draft-proposal` commands — no conflicts, they continue working exactly as before
- Your git history and `.env` files — not touched
- YALC's live files — all context migration goes through preview first

**Migration Steps**
1. `[manual]` Add both repo paths to a `.code-workspace` file in VS Code
2. `[auto]` Copy `voice/sarah-tone.md` → `~/.gtm-os/_preview/voice/tone-of-voice.md`
3. `[manual]` Run `yalc-gtm start --commit-preview` after reviewing the preview folder
4. `[manual]` Test the `qualify-lead` trigger phrase in chat to confirm the right command fires

---

Sarah reads the plan, confirms it looks right, and replies:

> "apply"

Claude copies the voice file to the preview folder. It tells Sarah:

> "Step 2 done. Now run `yalc-gtm start --commit-preview` to promote your voice file into YALC's live brain. Then open both repos as a workspace (step 1) and you're set."

Five minutes later, Sarah can type:

> "Research Notion's GTM motion, then build me a campaign strategy for reaching their VP of Revenue"

And YALC chains her existing `research-client` command with its own `campaign-strategy` skill — one fluid response.

---

## Frequently asked questions

**Will this overwrite my existing setup?**
No. The plan is read-only until you say "apply", and even then it only touches files listed in the plan. Your existing commands, rules, and credentials are never modified.

**What if I don't like part of the plan?**
Just tell Claude in chat. For example: "don't rename my qualify-lead command, leave it as is." Claude will revise the plan before applying anything.

**What's a "soft conflict"?**
It means two commands have similar trigger phrases — words you'd say to activate them overlap. Claude Code picks commands by understanding context, not by strict keyword matching, so similar phrases can occasionally cause the wrong command to run. The fix is to test it and rename one if needed. The plan flags these so you're not surprised.

**Can I run this more than once?**
Yes. If you add new commands to your existing repo later, run the skill again. It produces a fresh plan and saves it with today's date.

**What if Claude can't find my folder?**
Double-check the path — it needs to be the full path starting from the root (e.g. `/Users/yourname/...`, not a relative path like `../my-folder`). The folder must contain a `.claude/` subfolder for Claude to recognise it as a Claude Code setup.
