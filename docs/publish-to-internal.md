# How to Submit Your Work for Review (Internal Repo)

This guide is for anyone who has built or updated a skill in YALC and wants to submit it for review so it can be merged into the main codebase.

You don't need to know how to use git. Everything happens through a conversation with Claude.

---

## What This Does

While you're building a skill, you're working on your own personal branch — a separate copy of the codebase that only you can see. When you're ready to share your work, this command packages everything up, pushes it to the shared internal repo, and opens a pull request so a developer can review it.

Think of it as clicking "submit" on your work. Nothing gets merged automatically — a developer always reviews first.

This is **step 1 of 2** if you eventually want your skill to reach the public repo. Once a developer merges your pull request here, you can then use the [publish to public](./publish-to-public.md) flow to take it the rest of the way.

---

## Before You Start

You should be on your own working branch (e.g. `yourname/skill-name`), not on `main`. If you're not sure which branch you're on, ask Claude: *"what branch am I on?"*

Make sure you've saved all your changes. The command picks up everything in your current working directory — you don't need to manually select files.

---

## How to Trigger It

Open Claude and say any of the following:

- *"publish my changes"*
- *"submit my skill for review"*
- *"create a PR for my work"*
- *"push my branch to internal"*
- *"I'm done, publish this"*

Claude will run the publish command on your behalf.

---

## What Happens Step by Step

### 1. GitHub setup (only if needed)
If the GitHub CLI isn't installed on your machine yet, Claude installs it automatically. If you haven't logged in to GitHub through the CLI before, a browser window opens for you to authenticate. This only happens once.

### 2. All your changes are saved and pushed
Claude stages everything you've worked on, commits it with an automatic message, and pushes your branch to the internal repo. You don't need to select files or write a commit message — it handles all of that.

If your working directory is already clean (nothing new since your last push), it skips the commit and just pushes.

### 3. A pull request is opened
Claude opens a pull request in the internal repo asking to merge your branch into `main`. If a pull request for your branch is already open from a previous run, it reuses that one instead of creating a duplicate.

### 4. A plain-English summary is written
Claude reads your changes and writes a `CHANGES.md` file in your current directory. This is a short, plain-English description of what you built — what it does, what changed, and what users will notice. You can read it to double-check everything looks right.

### 5. Done
Claude gives you the pull request link:

> ✅ Branch "yourname/skill-name" is up and a PR is open against main.

**Send that PR link to your developer for review.** Once they approve and merge it, your work is in the internal main branch — and you can then publish it to the public repo if needed.

---

## What the Developer Does

Your job ends at step 5. The developer opens the pull request, reads through your changes, and either merges it or leaves comments asking for adjustments. If they leave comments, make your changes and run the publish command again — it will update the same pull request automatically.

---

## Common Situations

**"Nothing to commit — working tree is clean"**
You've already pushed everything. If a pull request is already open, Claude will show you the existing link. If not, it means your branch is fully up to date and there's nothing new to submit.

**A browser window opens asking you to log in**
This is the GitHub CLI asking you to authenticate. Follow the on-screen prompts — it only happens on first use. Once done, the publish command resumes automatically.

**The command fails with a push error**
Usually means your branch name has a conflict with something on the remote, or there's a permissions issue. Copy the error message and open a bug ticket with `/bug` for the developer team.

---

## The Two-Step Release Flow

If your goal is to get a skill in front of users on the public repo, the full journey is:

```
Your branch
    ↓
"publish my changes"  ← you are here
    ↓
Pull request opened in internal repo
    ↓
Developer reviews and merges
    ↓
"publish to public"   ← see publish-to-public.md
    ↓
Pull request opened in public repo
    ↓
Developer reviews and merges
    ↓
Live for users
```

You own the first and third steps. The developer handles the reviews in between.

---

## Quick Reference

| What you say | What happens |
|---|---|
| "publish my changes" | Stages, commits, pushes, opens PR |
| "what branch am I on?" | Claude tells you your current branch |
| "what's in my PR?" | Claude fetches and summarises the open PR |

---

## Questions?

If something goes wrong or Claude gets stuck, copy the error message and open a bug ticket with `/bug` — it goes straight to the developer team.
