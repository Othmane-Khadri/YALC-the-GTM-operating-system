# {{title}}

_Last run: {{ranAt}}_

{{summary}}

| Subreddit | Title | Score | Sentiment | Rationale |
|---|---|---|---|---|
{{#each rows}}| {{subreddit}} | [{{title}}]({{url}}) | {{relevance_score}} | {{sentiment}} | {{rationale}} |
{{/each}}
