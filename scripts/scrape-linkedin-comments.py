#!/usr/bin/env python3
"""Paginate through all LinkedIn post comments via Orthogonal → Fiber API."""

import json
import os
import sys
import time
import urllib.request

BASE_URL = "https://api.orth.sh"
CONTENT_ID = "urn:li:activity:7437839112063234049"

def load_api_key():
    env_file = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    with open(env_file) as f:
        for line in f:
            if line.startswith("ORTHOGONAL_API_KEY="):
                return line.strip().split("=", 1)[1]
    raise RuntimeError("ORTHOGONAL_API_KEY not found in .env.local")

def fetch_page(api_key, cursor=None):
    payload = {"api": "fiber", "path": "/v1/linkedin-live-fetch/post-comments", "body": {"contentId": CONTENT_ID}}
    if cursor:
        payload["body"]["cursor"] = cursor

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
    all_comments = []
    cursor = None
    page = 0

    while True:
        page += 1
        result = fetch_page(api_key, cursor)

        if not result.get("success"):
            print(f"  Page {page} failed: {result}", file=sys.stderr)
            break

        output = result.get("data", {}).get("output", {})
        comments = output.get("data", [])
        new_cursor = output.get("cursor")
        credits = result.get("data", {}).get("chargeInfo", {}).get("creditsCharged", "?")

        for c in comments:
            commenter = c.get("commenter", {})
            # Skip Othmane's own replies
            if "othmane-khadri" in commenter.get("linkedinSlug", ""):
                continue
            all_comments.append({
                "name": commenter.get("name", ""),
                "linkedin_url": commenter.get("linkedinUrl", ""),
                "linkedin_slug": commenter.get("linkedinSlug", ""),
                "comment": c.get("commentary", ""),
                "created_at": c.get("createdAt", ""),
                "num_reactions": c.get("numReactions", 0),
            })

        print(f"  Page {page}: {len(comments)} comments (total unique: {len(all_comments)}, credits: {credits})")

        if not new_cursor or not comments:
            break
        cursor = new_cursor
        time.sleep(0.5)  # rate limit courtesy

    # Deduplicate by linkedin_slug
    seen = set()
    unique = []
    for c in all_comments:
        slug = c["linkedin_slug"]
        if slug and slug not in seen:
            seen.add(slug)
            unique.append(c)
        elif not slug:
            unique.append(c)

    output_path = os.path.join(os.path.dirname(__file__), "..", "data", "linkedin-commenters.json")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump({"total_comments": len(all_comments), "unique_commenters": len(unique), "commenters": unique}, f, indent=2)

    print(f"\nDone: {len(all_comments)} total comments, {len(unique)} unique commenters")
    print(f"Saved to: {output_path}")

if __name__ == "__main__":
    main()
