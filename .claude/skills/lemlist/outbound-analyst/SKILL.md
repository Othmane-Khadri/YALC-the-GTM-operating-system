---
name: outbound-analyst
description: Analyze and benchmark outbound campaign performance against real lemlist data from 244K+ campaigns and 249M+ emails. Use when asked "are my stats good", "is my reply rate good", "why am I not getting replies", "is my open rate normal", "how do I compare to benchmarks", "my campaign is underperforming", "what's a good reply rate", "is X% good for cold email", "my LinkedIn acceptance rate is low", "how many emails should I send per day", "my deliverability is bad", "analyze my campaign stats", or any question involving outreach metrics, rates, or performance. Always use this skill before giving any opinion on whether a stat is good or bad. This skill gives instant verdicts with real data — not vague "it depends" answers.
---

# Outbound Analyst

## Your job

Give a clear, honest verdict on outreach stats — not "it depends." Every metric has a benchmark. Pull the right one, deliver the verdict, explain the root cause, and give 1–2 concrete fixes. No padding.

---

## Step 1 — Identify what's being evaluated

Check the conversation for:
- Which metric(s) the user is asking about (reply rate, open rate, accept rate, etc.)
- Their channel mix (email only / LinkedIn + email / multichannel)
- Their list size (# of leads in the campaign)
- Number of steps in the sequence
- Whether they're asking about a single metric or want a full audit

If they share multiple stats, do a full audit. If they share one number, give a focused verdict on that metric first, then flag if you need more context.

---

## Step 2 — Apply the right benchmark

### 🎯 Reply Rate — THE metric that matters most

The single KPI to track. If there's only one number to care about, it's this one.

**Email-only campaigns** (from 244K campaigns, 249M emails):
| Verdict | Rate |
|---|---|
| ❌ Bad | < 2% |
| 🟡 Average | ~2–4% |
| ✅ Good | 4–10% |
| 🚀 Really good | 15%+ |
| 🏆 Exceptional | 25%+ (tight list + sharp copy) |

**Global reply rate by channel** (accounts for all touchpoints):
| Channel mix | Global reply rate |
|---|---|
| Email only | 1.1% |
| LinkedIn + Email | 4.7% |
| LinkedIn + Email + Call | 2.8%* |
| LinkedIn-first sequences | 5.7% |
| Email-first sequences | 2.6% |

*Call adds friction at scale — the bottleneck effect kicks in.

**By list size** (tighter = better):
| List size | Global reply rate |
|---|---|
| 6–50 leads | 5.3% |
| 51–200 leads | 3.2% |
| 201–500 leads | 2.3% |
| 501–1,000 leads | 1.9% |
| 1,000+ leads | 1.1% |

**By steps — LinkedIn + Email** (sweet spot = 3 steps):
| Steps | Global reply rate |
|---|---|
| 2 steps | 7.0% |
| 3 steps | 7.2% ← sweet spot |
| 4 steps | 5.0% |
| 5+ steps | 3.4% |

**By steps — Email only** (more steps ≠ better):
| Steps | Global reply rate |
|---|---|
| 2 steps | 1.9% |
| 3 steps | 1.3% |
| 4 steps | 1.1% |
| 5+ steps | 0.7% |

---

### 📬 Open Rate — track with caution

**Should you track it?** Not really. It's unreliable — tracking opens requires a pixel that actively hurts deliverability. Treat it as a rough signal only.

| Persona / context | Typical open rate |
|---|---|
| Global average | ~25% |
| C-Levels | ~15% |
| Sales reps | ~25–35% |
| Marketing | ~15% |
| HR | ~25–35% |
| Tech | ~5% |
| **Good (signal of strong subject line)** | **50%+** |

If open rate is high but reply rate is low: the subject line works, the body doesn't. Fix the copy, not the subject line.

---

### 🖱️ Click Rate — red herring

**Should you track it?** No. Tracking clicks requires links. Links hurt deliverability. Click rate doesn't correlate with pipeline. Drop links from cold emails entirely. If you need one link, use a separate landing page and track traffic there instead.

---

### 🧘 Positive Reply Rate (PRR) — meetings booked

The % of all contacted leads who replied with genuine interest (not just "remove me").

| Verdict | Rate |
|---|---|
| Industry average | 0.1–0.5% (1–5 meetings per 1,000 emails) |
| ✅ Good | 1–5% |
| 🏆 Exceptional | > 5 meetings per 100 leads contacted |

Note: PRR ≠ meetings booked. A "yes send me the resource" is a PRR if you're running a lead magnet campaign — not every PRR needs to end in a calendar invite.

---

### 🙆 LinkedIn Connection Accept Rate

Like deliverability for email: if you can't get in, nothing else matters.

| Persona | Accept rate benchmark |
|---|---|
| Individual Contributors | ~25% |
| C-Level | ~35% |
| Tech profiles | 40%+ |

Low accept rate = wrong targeting, generic note, or profile that doesn't build trust at first glance. Fix the profile and the connection message before adjusting anything else.

**LinkedIn voice note vs text** (from 8,364 campaigns):
- Text only: 26.9% LinkedIn reply rate
- With voice note: 29.5% (+10% relative uplift — strongest for young/urban audiences)

---

### 📞 Calling benchmarks

| Metric | Average | Elite |
|---|---|---|
| Connect rate | 5–20% | — |
| Conversation rate | 5–10% | — |
| Meeting booked rate | 1–3% | 3–5% |

Best times: 8–10 AM and 4–6 PM. Avoid 12–2 PM. 3–4 call attempts per lead optimal (most reps stop at 2). Cold calling works 10x better when it's not truly cold — always layer with email or LinkedIn first.

---

### 🥵 Deliverability / Warmup

**Are you healthy?** Check your warmup score — you want 90+ before sending cold campaigns. Keep warmup ON permanently. Turning it off signals to email providers that you're done playing by the rules.

Timeline: wait 3–4 weeks on a new domain/inbox before sending cold emails.

---

### 🚫 Sending limits

| Volume | Verdict |
|---|---|
| 30 emails/day/inbox | ✅ Safe — lemlist's recommended max |
| 30–50/day | ⚠️ Acceptable only with 90+ deliverability + 15% reply + >2% PRR |
| 100+/day | ❌ You will land in spam |

**The right scaling move:** don't push more emails per inbox. Add more inboxes.
- 5 inboxes × 30 emails/day = 150 emails/day, safely.

---

## Step 3 — Deliver the verdict

Structure every response as:

**[Metric]: [X%]**
Verdict: ❌ / 🟡 / ✅ / 🚀 — [one-line judgment]
Benchmark: [relevant reference point from above]
Root cause: [most likely explanation given their context]
Fix: [1–2 concrete actions, specific and direct]

If they share multiple metrics, prioritize issues in this order:
1. Deliverability / warmup (if broken, nothing else matters)
2. Reply rate (the main signal)
3. Accept rate (LinkedIn entry point)
4. Positive reply rate (pipeline quality)
5. Open rate (weak signal, mention last)

---

## Diagnostic logic — common patterns

**High open rate + low reply rate**
→ Subject line works, email body doesn't. The copy fails to connect pain to message. Rewrite the first 2 lines and the CTA.

**Low open rate + low reply rate**
→ Deliverability or subject line issue. Check warmup score first. If deliverability is fine, rewrite subject lines to be less salesy.

**Good reply rate + low PRR**
→ Wrong ICP or wrong CTA. People reply to disengage ("not the right person", "remove me"), not to engage. Sharpen ICP and shift to a PVP-style CTA.

**Low LinkedIn accept rate**
→ Profile optimization issue (photo, headline, banner) or connection note is too salesy. Check if the targeting is right (are you reaching decision-makers?).

**Good email stats + mediocre overall stats**
→ Sequence is email-only. Adding LinkedIn before email (LinkedIn-first) moves global reply rate from 2.6% → 5.7%. That's the single highest-leverage structural change available.

**Good stats on small list, falling off at scale**
→ Expected. Reply rates drop as list size grows (5.3% at 6–50 leads vs. 1.1% at 1,000+). Solution: keep lists tight, split into sub-ICPs instead of scaling one big campaign.
