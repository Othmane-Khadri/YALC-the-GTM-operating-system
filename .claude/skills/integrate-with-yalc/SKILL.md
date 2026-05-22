---
name: integrate-with-yalc
description: "Points at the user's existing Claude Code repo, analyses what's already there, and produces a plan for how to make it work alongside YALC without conflicts. Covers workspace layout, skill trigger collisions, context migration, and orchestration examples. Read-only by default — a separate apply step moves files only after the user confirms. Use when someone says 'integrate my repo with YALC', 'I have my own Claude Code setup, how do I add YALC', 'merge my repo with YALC', 'how do I bolt YALC onto my existing skills', or 'I want to use my own skills alongside YALC'."
version: 1.0.0
---

# Integrate with YALC

The user has an existing Claude Code repo — their own skills, `CLAUDE.md`, project rules — and wants to run it alongside YALC without breaking either. This skill reads both sides, flags every conflict, and produces a written integration plan the user can review before anything changes.

**Read-only by default.** Nothing is moved or written until the user explicitly confirms the apply step.

## When This Skill Applies

- "integrate my repo with YALC"
- "I have my own Claude Code setup, how do I add YALC"
- "merge my repo with YALC"
- "how do I bolt YALC onto my existing skills"
- "I want to use my own skills alongside YALC"
- "I already have a `.claude/` folder — can I still use YALC?"

**NOT this skill** (use `icp-import` instead):
- User just wants to import their ICP/voice/context — no skills to reconcile.

**NOT this skill** (use `yalc-orientation` instead):
- User is new to YALC and has no existing repo to integrate.

## Inputs

Ask for both in a single message if not provided:

> 1. **Absolute path to your existing repo** (e.g. `/Users/alice/my-claude-setup`) — the root directory where your `.claude/` folder lives.
> 2. **One-line description of what your repo does** (optional but useful — e.g. "agency operations brain for B2B SaaS GTM").

If the user already provided the path in their message, use it directly. Don't ask for it again.

## Procedure

### Step 0 — Validate inputs

Confirm the path exists and contains a `.claude/` directory:

```bash
test -d "<user-repo-path>/.claude" && echo "OK" || echo "MISSING"
```

If `MISSING`: tell the user the path doesn't look like a Claude Code repo (no `.claude/` folder found) and ask them to double-check.

### Step 1 — Read the user repo (read-only)

Collect the following. If any are absent, note it but continue — absence is informative.

**a) Directory tree (top two levels):**
```bash
find "<user-repo-path>" -maxdepth 2 -not -path '*/.git/*' | sort
```

**b) All skill names + descriptions + trigger phrases:**
```bash
find "<user-repo-path>/.claude/skills" -name "SKILL.md" 2>/dev/null | sort | xargs -I{} sh -c 'echo "=== {} ===" && head -40 {}'
```

For each SKILL.md, extract:
- `name:` from frontmatter
- `description:` from frontmatter
- Lines under "When This Skill Applies" or equivalent trigger-phrase section

**c) CLAUDE.md and nested CLAUDE.mds:**
```bash
find "<user-repo-path>" -name "CLAUDE.md" -not -path '*/.git/*' | xargs cat 2>/dev/null
```

**d) `.claude/rules/` if present:**
```bash
find "<user-repo-path>/.claude/rules" -name "*.md" 2>/dev/null | xargs cat
```

### Step 2 — Read the YALC side

**YALC skill registry:**
```bash
find /Users/ifarahi/Desktop/yalc-internal/.claude/skills -name "SKILL.md" | sort | xargs -I{} sh -c 'echo "=== {} ===" && head -20 {}'
```

For each YALC skill, extract: name, description, trigger phrases.

### Step 3 — Analyse conflicts and opportunities

Build four internal lists before writing the plan:

**A. Skill name collisions** — user skill `name:` exactly matches a YALC skill `name:`. These are hard conflicts: at runtime, whichever skill file Claude Code loads last wins (or both are presented and the model picks). Flag every one.

**B. Trigger phrase overlaps** — user trigger phrases that share significant keywords with YALC trigger phrases, even if the skill names differ. These are soft collisions: Claude Code routing is model-driven and fuzzy, so overlap creates ambiguity, not a guaranteed winner. Flag as WARN, not ERROR.

**C. Context to migrate** — user repo content that belongs in `~/.gtm-os/`:
  - Voice / tone of voice files → `~/.gtm-os/_preview/voice/`
  - ICP definitions, segment descriptions → `~/.gtm-os/_preview/icp/`
  - Outreach templates, campaign templates → `~/.gtm-os/_preview/campaign_templates.yaml`
  - Qualification rules → `~/.gtm-os/_preview/qualification_rules.md`
  
**D. Orchestration pairs** — identify 2–4 plausible chains where one of the user's skills hands off to a YALC skill (or vice versa). Base these on actual skill descriptions — don't invent fake ones. A valid pair needs a clear data handoff (e.g. "your `research-client` skill → YALC's `campaign-strategy`").

### Step 4 — Write the integration plan

Render the plan in chat under these six sections, then save it to disk.

---

#### 1. Workspace Setup (one paragraph)

Recommend one of these layouts based on what you found:

- **Recommended: Separate folders, single VS Code workspace.** Add both repo paths to a `.code-workspace` file. YALC's `.claude/` and the user's `.claude/` stay separate on disk; Claude Code loads both. Skills from each are available in chat. No file moves needed to get started.
- **Alternative: User repo as `additionalDirectory`.** If the user repo is purely a context/knowledge base (no skills, no CLAUDE.md rules that would conflict), configure it as `additionalDirectory` in YALC's `~/.gtm-os/config.yaml`. Simpler, but loses the ability to invoke the user repo's own Claude Code skills.

State which layout you recommend and why in one sentence.

#### 2. Skill Conflicts

| User Skill | YALC Skill | Collision Type | Recommended Action |
|---|---|---|---|
| `name` | `name` | **Hard** (identical name) | Keep user's / Keep YALC's / Rename user's to `<name>-custom` |
| `name` | `name` | **Soft** (trigger overlap) | Test empirically after integration; rename if wrong skill fires |

For each Hard conflict, give a concrete recommendation: which one wins by default and what to rename the other to.

For Soft conflicts: be explicit that Claude Code's routing is model-driven and fuzzy — the table flags *likely* ambiguity, not guaranteed wrong behaviour. Instruct the user to test by saying the trigger phrase in chat after integration, observe which skill fires, and rename if needed.

If zero conflicts: say so and move on.

#### 3. Context Mapping

Three columns:

| Item found in user repo | Action | Target in YALC |
|---|---|---|
| `voice/tone.md` | Copy to `_preview/` for review + commit | `~/.gtm-os/_preview/voice/tone-of-voice.md` |
| `icp.yaml` | Run `icp-import` on it | `~/.gtm-os/_preview/icp/` |
| `templates/outreach.md` | Copy to `_preview/` for review + commit | `~/.gtm-os/_preview/campaign_templates.yaml` |
| `src/custom-logic.ts` | Leave in user repo | — not a YALC concern |
| `CLAUDE.md` rules about X | Leave in user repo CLAUDE.md | — YALC loads both CLAUDE.mds in a multi-root workspace |

Also state explicitly what is **not touched**:

> **YALC will not touch:** your repo's `CLAUDE.md`, your existing trigger phrases, your project rules, your `.env` files, or any code outside `~/.gtm-os/`. Integration is additive.

If voice or ICP content is found, offer to chain into `icp-import` immediately:
> "I found what looks like ICP/voice content in your repo. Want me to run `icp-import` on it now to map it into `~/.gtm-os/_preview/`?"

#### 4. Orchestration Examples

List 2–4 real chains derived from actual skill pairs found in step 3D. Format:

> **"[trigger phrase the user could type]"**
> → Your `<user-skill>` runs first (does X), then YALC's `<yalc-skill>` picks up the result (does Y).

Example shape (fill with real pairs):
> **"Research this prospect, then build me a strategy for reaching them"**
> → Your `research-prospect-custom` skill enriches the company profile, then YALC's `campaign-strategy` reads it and proposes angle + copy devices.

If fewer than 2 real pairs exist, say so — don't invent hypothetical ones.

#### 5. What to Leave Alone

Explicit list of things the integration plan does NOT touch:

- Your existing `CLAUDE.md` — it stays in your repo and coexists with YALC's CLAUDE.md under multi-root workspace.
- Your project rules in `.claude/rules/` — they load per-directory and don't conflict with YALC's rules unless you're in the same directory.
- Your git history, `.env`, or any credentials.
- Any skill in your repo that has no collision — it continues working exactly as before.
- YALC's live `~/.gtm-os/` files — all context migration goes through `_preview/` first.

#### 6. Migration Steps

Ordered list of actions needed to complete the integration. Mark each as **[auto]** (the apply step can do it) or **[manual]** (user must do it):

1. [manual] Add both repo paths to a shared `.code-workspace` file (workspace setup)
2. [auto] Rename `<user-skill>` to `<user-skill>-custom` (resolve hard conflict)
3. [auto] Copy `<file>` to `~/.gtm-os/_preview/<target>` (context migration)
4. [manual] Run `yalc-gtm start --commit-preview` after reviewing `_preview/`
5. [manual] Test ambiguous trigger phrases listed in Skill Conflicts §2

End with:
> **Next step:** reply `apply` to run the [auto] steps above, or ask me to adjust anything first.

---

### Step 5 — Save the plan to disk

```bash
PLAN_DATE=$(date +%Y-%m-%d)
PLAN_PATH=~/.gtm-os/integration-plan-${PLAN_DATE}.md
```

Write the rendered plan (all six sections) as markdown to `$PLAN_PATH`. Tell the user where it landed.

### Step 6 — Wait for apply confirmation

After rendering the plan in chat, wait. Do NOT apply anything yet.

If the user replies `apply` or "yes, apply the auto steps":

**Apply step — run in order:**

For each [auto] step:

1. **Skill renames:** copy the SKILL.md to the new name, confirm with the user before deleting the original:
   ```bash
   cp "<user-repo-path>/.claude/skills/<old-name>/SKILL.md" \
      "<user-repo-path>/.claude/skills/<new-name>/SKILL.md"
   ```
   Then ask: "OK to remove the old `<old-name>` directory?"

2. **Context migration to `_preview/`:**
   ```bash
   mkdir -p ~/.gtm-os/_preview/<section>/
   cp "<user-repo-path>/<source-file>" ~/.gtm-os/_preview/<section>/<target-file>
   ```

3. After all copies: tell the user to run `yalc-gtm start --commit-preview` to promote the previewed context into the live `~/.gtm-os/` files.

4. If ICP/voice content was migrated: offer to chain into `icp-import` to structure it properly.

**Never delete source files without explicit per-file confirmation.**

### Step 7 — Surface any errors verbatim

If a `find` or `cp` fails, print stderr unchanged. Common failure modes:
- `No such file or directory` — path was mistyped; ask the user to re-confirm.
- `Permission denied` — the user may need to `chmod` the directory.

## Hard Rules

1. **Read-only until explicitly confirmed.** Never move, rename, or write files before the user replies `apply` or equivalent.
2. **Collision detection is probabilistic, not deterministic.** Never tell the user a collision is "resolved" — always instruct them to test empirically. The table flags risk; it doesn't prove runtime behaviour.
3. **Context migration goes through `_preview/` only.** Never write directly to live `~/.gtm-os/` files.
4. **Orchestration examples must be grounded in real skill pairs.** If fewer than 2 real pairs exist, say so.
5. **Never delete a source file without per-file confirmation**, even in the apply step.
6. **The "What to Leave Alone" section is mandatory.** Users get anxious about integration overwriting their setup — surface the guarantee explicitly every time.
