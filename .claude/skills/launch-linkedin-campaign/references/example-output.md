# launch-linkedin-campaign — example rendered output

Full flow showing the hypothesis gate, both shell-outs, and the rendered summary.

## Pre-flight: hypothesis gate

```bash
$ test -f ~/.gtm-os/frameworks/installed/outreach-campaign-builder.hypothesis.json && echo "OK"
OK
```

## Step 2: campaign:create

```
$ npx tsx src/cli/index.ts campaign:create \
    --title "VP Marketing Q2 outbound — hire signal" \
    --hypothesis "marketing-ops engineer hire signal indicates lead-routing pain" \
    --leads-filter '{"score":{"$gte":80}}'

✓ Campaign created
  ID: cmp_2026_04_30_x1y2z3
  Pulled: 23 qualified leads (filter: score >= 80)
  Status: draft
```

## Step 4: campaign:create-sequence

```
$ npx tsx src/cli/index.ts campaign:create-sequence \
    --sequence configs/sequences/connect-dm1-dm2.yaml \
    --source ~/.gtm-os/data/result-sets/rs_2026_04_30_a1b2.json

✓ Sequence staged
  Steps: connect → DM1 → DM2
  Personalized: 23 / 23 leads (3 variants each = 69 messages)
```

## Skill summary

```
Campaign cmp_2026_04_30_x1y2z3 staged.
  Leads: 23 qualified
  Sequence: connect → DM1 → DM2
  Variants: 3 (A signal-first | B peer-mention | C data-led)
  Messages: 69 staged

Status: DRAFT — nothing sent yet.

Ready to send? Run `yalc-gtm campaign:track` once to start the tracker.
```

## Failure modes

### Hypothesis sidecar missing

```
⚠ Cannot launch — no outbound hypothesis recorded.
Run: yalc-gtm framework:set-hypothesis outreach-campaign-builder \
       --icp-segment '<seg>' --message-angle '<angle>' \
       --signal-trigger '<sig>' --expected-reply-rate 0.05
```

### No qualified leads

```
campaign:create failed: No qualified leads in holding pool matching filter.
Run `qualify-leads` first.
```
