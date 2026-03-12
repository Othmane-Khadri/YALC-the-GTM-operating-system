#!/usr/bin/env python3
"""Enrich LinkedIn commenters with profile data via Orthogonal → Fiber API."""

import json
import os
import sys
import time
import urllib.request

BASE_URL = "https://api.orth.sh"

def load_api_key():
    env_file = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    with open(env_file) as f:
        for line in f:
            if line.startswith("ORTHOGONAL_API_KEY="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("ORTHOGONAL_API_KEY not found in .env.local")

def fetch_profile(api_key, slug):
    payload = {"api": "fiber", "path": "/v1/linkedin-live-fetch/profile/single", "body": {"identifier": slug}}
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/v1/run",
        data=data,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())

def main():
    api_key = load_api_key()
    input_path = os.path.join(os.path.dirname(__file__), "..", "data", "linkedin-commenters.json")
    output_path = os.path.join(os.path.dirname(__file__), "..", "data", "linkedin-commenters-enriched.json")

    with open(input_path) as f:
        data = json.load(f)

    commenters = data["commenters"]
    enriched = []
    errors = 0

    for i, c in enumerate(commenters):
        slug = c.get("linkedin_slug", "")
        if not slug:
            enriched.append({**c, "headline": "", "company": "", "title": "", "industry": "", "location": "", "connections": 0, "followers": 0, "tags": []})
            continue

        try:
            result = fetch_profile(api_key, slug)
            if result.get("success") and result.get("data", {}).get("output", {}).get("found"):
                p = result["data"]["output"]["profile"]
                # Extract current job
                current_exp = next((e for e in (p.get("experiences") or []) if e.get("is_current")), {})
                enriched.append({
                    **c,
                    "headline": p.get("headline", ""),
                    "company": current_exp.get("company_name", ""),
                    "title": current_exp.get("title", ""),
                    "industry": p.get("industry_name", ""),
                    "location": p.get("locality", ""),
                    "connections": p.get("connection_count", 0),
                    "followers": p.get("follower_count", 0),
                    "tags": p.get("tags", []),
                    "summary": (p.get("summary") or "")[:300],
                })
                print(f"  [{i+1}/{len(commenters)}] {c['name']} → {current_exp.get('title', '?')} @ {current_exp.get('company_name', '?')}")
            else:
                enriched.append({**c, "headline": "", "company": "", "title": "", "industry": "", "location": "", "connections": 0, "followers": 0, "tags": []})
                print(f"  [{i+1}/{len(commenters)}] {c['name']} → NOT FOUND")
        except Exception as e:
            errors += 1
            enriched.append({**c, "headline": "", "company": "", "title": "", "industry": "", "location": "", "connections": 0, "followers": 0, "tags": []})
            print(f"  [{i+1}/{len(commenters)}] {c['name']} → ERROR: {e}", file=sys.stderr)

        time.sleep(0.3)  # rate limit

    with open(output_path, "w") as f:
        json.dump({"total": len(enriched), "errors": errors, "commenters": enriched}, f, indent=2)

    print(f"\nDone: {len(enriched)} enriched, {errors} errors")
    print(f"Saved to: {output_path}")

if __name__ == "__main__":
    main()
