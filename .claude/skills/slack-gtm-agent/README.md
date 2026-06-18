# slack-gtm-agent

Inbound Slack entry-point that turns a DM brief into a paused Lemlist DRAFT campaign. Parses the brief, delegates to `lemlist-campaign-from-icp`, posts the dryrun as a Block Kit thread reply, ships on a thumbsup reaction from the original sender. Per-channel rate limit of one campaign per hour. Never auto-starts.

See `SKILL.md` for the full pipeline and acceptance criteria.
