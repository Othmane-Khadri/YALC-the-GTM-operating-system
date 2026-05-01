---
name: answer-linkedin-comments
description: "Reply to comments on a LinkedIn post via Unipile — drafts thread-aware replies grounded in the user's voice and the conversation context, then sends on approval. Use when the user says 'answer comments on my post', 'reply to LinkedIn comments', 'respond to engagement on this post', 'draft replies to commenters', or 'answer the LinkedIn thread'. Side-effecting — calls Unipile to read + post replies."
version: 1.0.0
---

# Answer LinkedIn Comments

I'll wrap `linkedin:answer-comments`. Take a post URL, fetch comments via Unipile, draft replies in the user's voice, ask for approval, and send on yes.

## When This Skill Applies

- "answer comments on my post"
- "reply to LinkedIn comments"
- "respond to engagement on this post"
- "draft replies to commenters"
- "answer the LinkedIn thread"

**NOT this skill** (use `scrape-post-engagers` instead):
- "scrape the engagers off this post" — that produces a result set; this skill produces replies.

**NOT this skill** (use `personalize-message` instead):
- "draft a DM to this commenter" — DM is one-to-one; this skill is for the public thread.

## Workflow

### Step 0 — Ask for the LinkedIn post URL

> "What's the LinkedIn post URL with comments to answer?"

### Step 1 — Validate URL

### Step 2 — Shell out to draft

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts linkedin:answer-comments --url <url> --draft-only
```

(Verify exact flag via `--help`. The skill always drafts first, then asks before sending.)

### Step 3 — Render the drafts

Show each comment + its drafted reply.

### Step 4 — Ask for approval per comment OR bulk

> "Send all? (yes / approve some / cancel)"

### Step 5 — Shell out to send (if approved)

```bash
npx tsx src/cli/index.ts linkedin:answer-comments --url <url> --approved <ids>
```

### Step 6 — Render send result

## Notes

- Replies use the brand voice from `~/.gtm-os/brand-voice.yaml` if present; otherwise defaults to a neutral conversational tone.
- The CLI never auto-sends without `--approved`. Drafts always render to chat first.
- Skips comments from the post author themselves (no self-replies).
