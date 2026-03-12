#!/usr/bin/env python3
"""Qualify LinkedIn commenters against Earleads ICP using Claude."""

import json
import os
import sys
import urllib.request

def load_api_key():
    env_file = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    with open(env_file) as f:
        for line in f:
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("ANTHROPIC_API_KEY not found in .env.local")

ICP_PROMPT = """You are an ICP qualification engine for Earleads.

## Earleads ICP
- **Primary segment:** B2B SaaS Founders & GTM Leaders
- **Company stage:** Series A-B
- **Company size:** 50-300 employees
- **Target roles:** CEO/Founder, VP Marketing, Head of Growth, CMO, VP Sales, RevOps Lead, GTM Engineer
- **Target industries:** SaaS, Developer Tools, Fintech, HR Tech, eCommerce Infrastructure
- **Buying triggers:** Just raised funding, hired first marketing person, competitor gaining visibility, board pressure for pipeline growth
- **Disqualifiers:** Pre-revenue companies, 500+ employees (have in-house teams), non-B2B businesses, students, junior individual contributors with no buying power

## Scoring Guide
- **80-100 (Strong):** Decision-maker at a B2B SaaS company (50-300 employees), title matches target roles, industry matches
- **60-79 (Moderate):** Related role but not exact (e.g., AE at SaaS company, Growth at a startup), or right role but unclear company fit
- **40-59 (Weak):** Tangentially related (e.g., freelancer in GTM space, agency founder serving B2B)
- **20-39 (Poor):** Wrong industry, wrong company stage, or no buying power
- **0-19 (Disqualified):** Student, non-B2B, no professional context, spam commenter

## Task
Score each person. Return ONLY valid JSON — an array of objects with these fields:
- "name": string (exact name from input)
- "score": number (0-100)
- "reasoning": string (1 sentence explaining the score)
- "qualified": boolean (true if score >= 60)
"""

def qualify_batch(api_key, batch):
    """Send a batch of up to 30 profiles to Claude for scoring."""
    profiles_text = "\n".join(
        f"- {p['name']} | {p.get('title', '?')} @ {p.get('company', '?')} | Headline: {p.get('headline', '?')} | Industry: {p.get('industry', '?')} | Location: {p.get('location', '?')} | Connections: {p.get('connections', '?')} | Followers: {p.get('followers', '?')} | Tags: {','.join(p.get('tags', []))}"
        for p in batch
    )

    payload = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 4096,
        "messages": [
            {"role": "user", "content": f"Score these {len(batch)} people against the Earleads ICP. Return ONLY a JSON array.\n\n{profiles_text}"}
        ],
        "system": ICP_PROMPT,
    }

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read())

    # Extract JSON from response
    text = result["content"][0]["text"]
    # Find JSON array in response
    start = text.find("[")
    end = text.rfind("]") + 1
    if start == -1 or end == 0:
        print(f"  WARNING: Could not parse JSON from response: {text[:200]}", file=sys.stderr)
        return []
    return json.loads(text[start:end])

def main():
    api_key = load_api_key()
    input_path = os.path.join(os.path.dirname(__file__), "..", "data", "linkedin-commenters-enriched.json")
    output_path = os.path.join(os.path.dirname(__file__), "..", "data", "linkedin-commenters-qualified.json")

    with open(input_path) as f:
        data = json.load(f)

    commenters = data["commenters"]
    BATCH_SIZE = 30
    all_scores = {}

    for i in range(0, len(commenters), BATCH_SIZE):
        batch = commenters[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (len(commenters) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"  Batch {batch_num}/{total_batches}: qualifying {len(batch)} profiles...")

        try:
            scores = qualify_batch(api_key, batch)
            for s in scores:
                all_scores[s["name"]] = s
        except Exception as e:
            print(f"  ERROR in batch {batch_num}: {e}", file=sys.stderr)

    # Merge scores back into commenter data
    qualified = []
    for c in commenters:
        score_data = all_scores.get(c["name"], {"score": 0, "reasoning": "Not scored", "qualified": False})
        qualified.append({
            **c,
            "icp_score": score_data.get("score", 0),
            "icp_reasoning": score_data.get("reasoning", ""),
            "qualified": score_data.get("qualified", False),
        })

    # Sort by ICP score descending
    qualified.sort(key=lambda x: x["icp_score"], reverse=True)

    # Stats
    strong = sum(1 for q in qualified if q["icp_score"] >= 80)
    moderate = sum(1 for q in qualified if 60 <= q["icp_score"] < 80)
    weak = sum(1 for q in qualified if 40 <= q["icp_score"] < 60)
    poor = sum(1 for q in qualified if q["icp_score"] < 40)

    result = {
        "total": len(qualified),
        "strong": strong,
        "moderate": moderate,
        "weak": weak,
        "poor": poor,
        "qualified_count": strong + moderate,
        "commenters": qualified,
    }

    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"\nQualification complete:")
    print(f"  Strong (80+): {strong}")
    print(f"  Moderate (60-79): {moderate}")
    print(f"  Weak (40-59): {weak}")
    print(f"  Poor (<40): {poor}")
    print(f"  Total qualified (60+): {strong + moderate}")
    print(f"Saved to: {output_path}")

if __name__ == "__main__":
    main()
