# How to Publish Your Work to the Public Repo

This guide is for anyone who has built or updated a skill in YALC and wants to make it available to users on the public repo.

You don't need to know how to use git. Everything happens through a conversation with Claude.

---

## What This Does

When you finish building a skill and it gets reviewed and merged into the internal repo, it isn't automatically visible to the public. There's a second step: pushing those changes to the public-facing repo and opening a pull request for a developer to do a final review.

This skill handles that entire second step for you. You just tell Claude you're ready to publish, confirm what's about to go out, and Claude takes care of the rest.

---

## Before You Start

Make sure these two things are true before triggering the skill:

1. **Your branch has been merged into the internal repo's main branch.** If you're not sure, check with your team or look for a "merged" label on your pull request in GitHub. If it hasn't been merged yet, Claude will catch this and walk you through that step first.

2. **This is your first time running it, or you've already done the one-time setup.** The first time you use this skill, Claude will ask you to identify which of your git remotes is the internal repo and which is the public repo. It only asks once — after that it remembers.

---

## How to Trigger It

Open Claude and say any of the following:

- *"publish to public"*
- *"release to public"*
- *"push my changes to the public repo"*
- *"my skill is merged — how do I release it?"*
- *"ship to public"*

---

## What Happens Step by Step

### 1. First-time setup (only once)
If Claude hasn't worked with your setup before, it will show you a list of your git remotes and ask:
- Which one is the **internal** repo?
- Which one is the **public** repo?

Answer with the names you see in the list (e.g. `origin`, `public`). Claude saves this and will never ask again.

### 2. Branch check
Claude checks whether your current branch is already merged into the internal repo's main branch.

- **If it is:** great, carry on.
- **If it isn't:** Claude will warn you and offer to run `yalc-gtm publish` to open the internal PR first. Do that, wait for it to be merged, then come back and trigger the skill again.

### 3. Preview
Claude shows you a summary of everything that's about to be published — new skills, updated commands, documentation changes. Read through it to make sure it looks right.

You may also see a notice like:

> ⚠️ The public repo has X commit(s) that were pushed directly (not through the internal repo). These will be preserved.

This is normal — it just means someone made a small fix directly on the public repo. Claude handles it automatically; nothing is lost.

Once you're happy with the preview, reply **"yes"**, **"go"**, **"ship it"**, or anything affirmative.

### 4. Push and PR
Claude creates a branch, pushes your changes to the public repo, and opens a pull request with a plain-English description of what changed. You don't need to do anything here.

### 5. CHANGES.md
Claude writes a short `CHANGES.md` file in plain English summarising the release. You can share this with your team or use it for announcements.

### 6. Done
Claude gives you the pull request link and a summary:

> ✅ Done — changes are staged for the public repo.
> PR opened: https://github.com/...
> A developer will review and merge the PR. Ping them with the PR link above.

**Send that PR link to your developer.** Once they merge it, the changes are live on the public repo.

---

## What the Developer Does at the End

Your job ends at step 6. The developer gets the PR link, reviews the changes, and merges. This is the final safety check before anything goes public. It usually takes a few minutes.

---

## Common Situations

**"Nothing new to publish"**
Claude tells you the public repo is already up to date. This means everything that's merged in the internal repo is already in the public repo. Nothing to do.

**"Your branch hasn't been merged yet"**
Your skill is still in review or hasn't been merged into the internal main branch. Either wait for approval, or ask Claude to run `yalc-gtm publish` if you haven't done that step yet.

**"There's a merge conflict"**
Rare — only happens when someone made a direct change to the public repo that touches the exact same file as your changes. Claude will stop and give you a message to forward to a developer to resolve it manually.

---

## Quick Reference

| What you say | What happens |
|---|---|
| "publish to public" | Triggers the full publish flow |
| "yes" / "go" / "ship it" | Confirms the preview and starts the push |
| Anything other than an affirmative at the preview | Cancels cleanly — nothing is pushed |

---

## Questions?

If something goes wrong or Claude gets stuck, copy the error message and open a bug ticket with `/bug` — it goes straight to the developer team.
