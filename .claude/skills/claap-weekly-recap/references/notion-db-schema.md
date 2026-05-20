# Notion DB Schema — GTM Action Items

This skill writes to a Notion database with the shape below. Recreate it in
your workspace via the Notion MCP (`notion-create-database`). The skill's
**SETUP MODE** does this for you on first run — what follows is the verified
JSON contract it submits, kept here as reference for manual setup or audit.

> Notion docs cited:
> - Create a database: https://developers.notion.com/reference/create-a-database
> - Update a data source: https://developers.notion.com/reference/update-a-data-source
> - Create a page (in a data source): https://developers.notion.com/reference/post-page
> - Database views (board): https://developers.notion.com/reference/create-database-view
>
> The Notion MCP wraps these endpoints. Pseudo-SQL (`CREATE TABLE …`,
> `ALTER COLUMN …`) is **not** a valid input — the MCP wants the JSON
> property objects below.

## Allowed select colors

Notion accepts exactly these color values on select / multi_select / status
options:

```
default · gray · brown · orange · yellow · green · blue · purple · pink · red
```

Any other value is rejected.

## Properties (10) — default schema

| # | Name | Notion type | Notes |
|---|---|---|---|
| 1 | `Title` | title | The action sentence or focus block name |
| 2 | `Type` | select — `Action Item` (blue), `Focus Block` (orange) | Tactical vs strategic |
| 3 | `Status` | select — `Backlog` (gray), `Focus This Week` (purple), `Done` (green), `Archived` (default) | Kanban grouping |
| 4 | `Deal / Lead` | rich_text | Free-form deal identifier. Empty for Focus Block rows. |
| 5 | `Verbatim Quote` | rich_text | Prospect's exact wording (10–25 words) |
| 6 | `Claap Link` | url | Direct timestamped URL into the Claap recording |
| 7 | `Source Call Date` | date | Date of the originating call |
| 8 | `Surfaced By` | select — `Weekly Recap Agent` (purple), `Manual` (gray) | Provenance |
| 9 | `Week` | rich_text | ISO week label like `2026-W20`; used for filtering |
| 10 | `Due` | date | Optional; only set when the call explicitly promised a date |

SETUP MODE may extend this list with anything the user supplies under
`extra_properties` in `.claap-config.json`.

## `notion-create-database` — verified JSON body

Submit this body once. The MCP returns the new database object, including
the `data_source` UUID the skill writes pages into.

```json
{
  "parent": { "type": "page_id", "page_id": "<YOUR_NOTION_PAGE_ID>" },
  "title": [
    { "type": "text", "text": { "content": "GTM Action Items" } }
  ],
  "initial_data_source": {
    "properties": {
      "Title":   { "type": "title",     "title": {} },
      "Type":    { "type": "select",    "select": {
        "options": [
          { "name": "Action Item", "color": "blue" },
          { "name": "Focus Block", "color": "orange" }
        ]
      } },
      "Status":  { "type": "select",    "select": {
        "options": [
          { "name": "Backlog",         "color": "gray"    },
          { "name": "Focus This Week", "color": "purple"  },
          { "name": "Done",            "color": "green"   },
          { "name": "Archived",        "color": "default" }
        ]
      } },
      "Deal / Lead":      { "type": "rich_text", "rich_text": {} },
      "Verbatim Quote":   { "type": "rich_text", "rich_text": {} },
      "Claap Link":       { "type": "url",       "url": {} },
      "Source Call Date": { "type": "date",      "date": {} },
      "Surfaced By":      { "type": "select",    "select": {
        "options": [
          { "name": "Weekly Recap Agent", "color": "purple" },
          { "name": "Manual",             "color": "gray"   }
        ]
      } },
      "Week":             { "type": "rich_text", "rich_text": {} },
      "Due":              { "type": "date",      "date": {} }
    }
  }
}
```

After the call returns, capture:

- The database's `data_source` UUID (or its `collection://...` URL).
- The `property_id` values for `Title`, `Status`, `Type`, `Deal / Lead` —
  needed for the Kanban view body below. Get them by calling
  `notion-fetch` on the new data source.

## `notion-create-view` — verified JSON body (board / Kanban)

The board view groups cards by `Status`. Replace each `<...>` with the
property IDs returned by `notion-fetch`.

```json
{
  "data_source_id": "<YOUR_DATA_SOURCE_UUID>",
  "name": "Kanban",
  "type": "board",
  "configuration": {
    "type": "board",
    "group_by": {
      "type": "select",
      "property_id": "<STATUS_PROPERTY_ID>",
      "sort": { "type": "manual" }
    },
    "properties": [
      { "property_id": "<TITLE_PROPERTY_ID>",       "visible": true },
      { "property_id": "<TYPE_PROPERTY_ID>",        "visible": true },
      { "property_id": "<DEAL_LEAD_PROPERTY_ID>",   "visible": true },
      { "property_id": "<VERBATIM_QUOTE_PROP_ID>",  "visible": true },
      { "property_id": "<CLAAP_LINK_PROPERTY_ID>",  "visible": true },
      { "property_id": "<SOURCE_DATE_PROPERTY_ID>", "visible": true },
      { "property_id": "<WEEK_PROPERTY_ID>",        "visible": true },
      { "property_id": "<SURFACED_BY_PROP_ID>",     "visible": true },
      { "property_id": "<DUE_PROPERTY_ID>",         "visible": true }
    ]
  }
}
```

## `notion-update-data-source` — add or change select options

Use this if a select option needs to be added later (e.g. user adds a custom
Kanban column in SETUP MODE), or if an existing option must be renamed.

```json
{
  "data_source_id": "<YOUR_DATA_SOURCE_UUID>",
  "properties": {
    "Status": {
      "select": {
        "options": [
          { "id": "<EXISTING_BACKLOG_OPTION_ID>" },
          { "id": "<EXISTING_FOCUS_OPTION_ID>" },
          { "id": "<EXISTING_DONE_OPTION_ID>" },
          { "id": "<EXISTING_ARCHIVED_OPTION_ID>" },
          { "name": "Snoozed", "color": "yellow" }
        ]
      }
    }
  }
}
```

> WARNING: when you send the `options` array, Notion treats it as the
> **full** option set. **Omitting an existing option REMOVES it** (and orphans
> any pages tagged with it). Always include `{ "id": "<existing-id>" }`
> entries for every option you want to keep, plus the new `{ "name": ...,
> "color": ... }` entries you want to add.

To discover existing option IDs, call `notion-fetch` on the data source and
read the `options[]` arrays under each select property.

## `notion-create-pages` — verified JSON body (Action Item + Focus Block)

Batch up to 40 pages per call. Each entry's `properties` keys must match the
property **names** in the data source (case-sensitive). Values use the
typed wrapper Notion expects for each property type.

```json
{
  "parent": { "data_source_id": "<YOUR_DATA_SOURCE_UUID>" },
  "pages": [
    {
      "properties": {
        "Title": {
          "title": [{ "type": "text", "text": { "content": "Follow up with Acme on procurement timeline before EOW" } }]
        },
        "Type":           { "select": { "name": "Action Item" } },
        "Status":         { "select": { "name": "Backlog" } },
        "Deal / Lead":    { "rich_text": [{ "type": "text", "text": { "content": "Acme Corp · Jordan (VP Ops)" } }] },
        "Verbatim Quote": { "rich_text": [{ "type": "text", "text": { "content": "If procurement greenlights us by Friday we can be on a contract next week — otherwise we slip into next quarter." } }] },
        "Claap Link":     { "url": "https://app.claap.io/c/<recording-id>?t=720" },
        "Source Call Date": { "date": { "start": "2026-05-19" } },
        "Surfaced By":    { "select": { "name": "Weekly Recap Agent" } },
        "Week":           { "rich_text": [{ "type": "text", "text": { "content": "2026-W20" } }] }
      }
    },
    {
      "properties": {
        "Title": {
          "title": [{ "type": "text", "text": { "content": "Tighten pricing objection rebuttal" } }]
        },
        "Type":           { "select": { "name": "Focus Block" } },
        "Status":         { "select": { "name": "Focus This Week" } },
        "Verbatim Quote": { "rich_text": [{ "type": "text", "text": { "content": "Surfaced in 4 deals (Acme, Sofie GmbH, Northwind, BetaCo) — 6 distinct moments." } }] },
        "Claap Link":     { "url": "https://app.claap.io/c/<representative-recording-id>?t=128" },
        "Source Call Date": { "date": { "start": "2026-05-19" } },
        "Surfaced By":    { "select": { "name": "Weekly Recap Agent" } },
        "Week":           { "rich_text": [{ "type": "text", "text": { "content": "2026-W20" } }] }
      }
    }
  ]
}
```

For Focus Block rows, leave `Deal / Lead` out of the properties object
entirely (Notion treats absent rich_text as empty).

## Where to put the DB in your Notion workspace

Anywhere. The skill only needs the data source ID. Common parents:

- Under your personal HQ page
- Under a "GTM" or "Operations" hub
- Standalone at workspace root

You can move it later — the data source ID stays stable.

## Why these specific 10 properties

| Concern | Property that addresses it |
|---|---|
| What action to take | `Title` |
| Whether it's tactical or strategic | `Type` |
| Where it sits in your weekly workflow | `Status` (drives Kanban) |
| Whose deal this is | `Deal / Lead` |
| Evidence it's a real ask, not paraphrasing | `Verbatim Quote` |
| One-click jump to the moment in the call | `Claap Link` |
| Recency / aging | `Source Call Date` |
| Manual vs. agent provenance | `Surfaced By` |
| Weekly filtering | `Week` |
| Time-bounded commitments (rare) | `Due` |

The verbatim quote and the timestamped Claap link are what make these cards
usable without re-reading the transcript. That's the whole point.
