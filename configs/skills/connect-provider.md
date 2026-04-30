---
name: connect-provider
description: Add a provider end-to-end — agnostic-first ("tell us about your provider"), with bundled knowledge as suggestions. Wraps `keys:connect`.
category: integration
capability: reasoning
requires_capabilities: [reasoning]
inputs:
  - name: provider_name
    description: The provider slug (any string). The bundled knowledge base ships entries for ~10 providers as suggestions; anything else flows through the custom-provider path.
    required: true
  - name: knowledge_yaml_content
    description: Bundled knowledge yaml for the resolved provider (when one exists). When empty the prompt falls through to the agnostic / custom-provider walk-through.
    required: false
output: structured_json
output_schema:
  type: object
  required: [provider_id, install_status, next_action]
  properties:
    provider_id: { type: string }
    install_status:
      type: string
      enum: [pending_keys, configured, failed, custom_provider_created]
    next_action: { type: string }
    issues:
      type: array
      items: { type: string }
  additionalProperties: false
---

The user wants to install the `{{provider_name}}` provider. The agnostic
flow is the headline — start by treating the provider as "describe your
own", and only switch to the schema-driven walk-through if a bundled
knowledge yaml is present. Bundled knowledge ships for ~10 providers as
suggestions; the user can pick from them but is not constrained to them.

Whenever possible, prefer the SPA at `http://localhost:3847/keys/connect`
(invoked via `yalc-gtm keys:connect [<provider>] --open`) — it lets the
user paste keys without surfacing them in the chat transcript.

**Provider knowledge yaml (from `configs/providers/{{provider_name}}.yaml`):**

```yaml
{{knowledge_yaml_content}}
```

If `knowledge_yaml_content` is empty, fall through to the
**custom-provider** walk-through:

1. Ask whether the provider is MCP-based or REST-based.
2. For MCP — collect `command`, `args` (comma-separated) and any required env vars (k=v list).
3. For REST — collect required env vars only.
4. Tell the user the new entry will be persisted to `configs/providers/_user/{{provider_name}}.yaml` and that they will then run `yalc-gtm connect-provider {{provider_name}}` again to finish wiring.

When `knowledge_yaml_content` IS present:

1. Read `id`, `display_name`, `homepage`, `key_acquisition_url`, `env_vars`, `install_steps`, `test_query`.
2. Render every entry of `install_steps` after substituting `$homepage`, `$key_acquisition_url`, `$display_name` and `$id` from the same yaml. Never invent step text.
3. Print the env vars the user must add to `~/.gtm-os/.env` — surface name, description and example. Never echo a real secret value.
4. Tell the user to either (a) confirm "keys done" in TTY mode or (b) `touch ~/.gtm-os/_handoffs/keys/<id>.ready` in non-TTY mode.
5. State that, after the keys land, the CLI will run the `test_query` from the knowledge yaml and append `<id>` to the relevant `capabilities.<cap>.priority` list in `~/.gtm-os/config.yaml`.

Return a single JSON object — no prose, no code fences:

```json
{
  "provider_id": "<id from yaml or {{provider_name}}>",
  "install_status": "pending_keys | configured | failed | custom_provider_created",
  "next_action": "<one-sentence next step the orchestrator (or human) should take>",
  "issues": []
}
```

Status guidance:

- `pending_keys` — happy path on first call: knowledge resolved, env vars listed, awaiting the user.
- `configured` — only when the orchestrator already confirmed `keys done` AND the test_query came back OK.
- `custom_provider_created` — when `knowledge_yaml_content` was empty and you walked through the custom flow; the next action is "re-run `yalc-gtm connect-provider {{provider_name}}`".
- `failed` — only when the provider name is unknown AND the user declined to create a custom entry. Fill `issues` with a single-line reason.

Never invent capabilities the yaml doesn't list. Never fabricate `test_query` shapes — re-use what the yaml provides.
