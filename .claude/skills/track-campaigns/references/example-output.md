# track-campaigns — example rendered output

```
Polled 3 active campaigns at 2026-04-30T18:30:00Z

cmp_2026_04_30_x1y2z3 (LinkedIn — VP Marketing Q2 outbound)
  Sent today:        12 connect requests, 5 DM1, 0 DM2
  Replies:           3 new (since last poll)
  Sequence advances: 5 leads moved DM1 → DM2 (day 5 elapsed)
  Status:            running

cmp_2026_04_28_p7q8r9 (Email — Hire-signal nurture)
  Sent today:        47 emails (touch 3)
  Replies:           8 new (since last poll, 2 hot)
  Sequence advances: 47 leads moved touch 3 → touch 4 (day 7 elapsed)
  Status:            running

cmp_2026_04_25_a4b5c6 (LinkedIn — Q1 follow-up)
  Sent today:        0
  Replies:           1 new (out-of-office reply, auto-classified)
  Sequence advances: 0 (campaign ended)
  Status:            completed (final report queued)

Synced 12 reply rows to Notion (campaign_replies DB).

Want me to:
  (a) personalize follow-ups for the 10 hot replies via `personalize-message`?
  (b) generate the weekly campaign report?
```
