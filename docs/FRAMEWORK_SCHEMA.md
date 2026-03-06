# GTM Framework — Data Schema

The living intelligence layer. Populated during onboarding, injected into every Claude interaction to personalize workflows.

---

## Company Identity

| Field | Type | Example |
|-------|------|---------|
| name | string | "Acme Corp" |
| website | string | "https://acme.com" |
| linkedinUrl | string | "https://linkedin.com/company/acme" |
| industry | string | "Developer Tools" |
| subIndustry | string | "API Infrastructure" |
| stage | enum | `pre-seed` · `seed` · `series-a` · `series-b` · `growth` · `enterprise` |
| description | string | What the company does |
| teamSize | string | "11-50" |
| foundedYear | number | 2023 |
| headquarters | string | "San Francisco, CA" |

---

## Positioning

| Field | Type | Description |
|-------|------|-------------|
| valueProp | string | Core value proposition |
| tagline | string | One-liner |
| category | string | Market category |
| differentiators | string[] | What makes you different |
| proofPoints | string[] | Evidence (metrics, logos, awards) |
| competitors | CompetitorProfile[] | See below |

### Competitor Profile

| Field | Type |
|-------|------|
| name | string |
| website | string |
| positioning | string |
| weaknesses | string[] |
| battlecardNotes | string |

---

## ICP Segments

Each segment represents a target audience. One is `primary`, others are `secondary` or `exploratory`.

### Core Fields

| Field | Type |
|-------|------|
| id | string |
| name | string |
| description | string |
| priority | `primary` · `secondary` · `exploratory` |

### Targeting

| Field | Type |
|-------|------|
| targetRoles | string[] |
| targetCompanySizes | string[] |
| targetIndustries | string[] |
| keyDecisionMakers | string[] |

### Pain & Triggers

| Field | Type |
|-------|------|
| painPoints | string[] |
| buyingTriggers | string[] |
| disqualifiers | string[] |

### Voice

| Field | Type | Purpose |
|-------|------|---------|
| tone | string | e.g. "Direct, no-BS" |
| style | string | e.g. "Technical but accessible" |
| keyPhrases | string[] | Words to use |
| avoidPhrases | string[] | Words to never use |
| writingRules | string[] | Style guidelines |
| exampleSentences | string[] | Reference sentences |

### Messaging

| Field | Type |
|-------|------|
| framework | string |
| elevatorPitch | string |
| keyMessages | string[] |
| objectionHandling | `{ objection, response }[]` |

### Content Strategy

| Field | Type |
|-------|------|
| linkedinPostTypes | string[] |
| emailCadence | string |
| contentThemes | string[] |
| redditSubreddits | string[] |
| keyTopics | string[] |

---

## Channels

| Field | Type |
|-------|------|
| active | ChannelType[] |
| preferences | `{ [channel]: { frequency, style, notes } }` |

**Channel types:** `linkedin` · `email` · `reddit` · `twitter` · `cold-call` · `events` · `partnerships` · `content-marketing` · `paid-ads`

---

## Signals & Intent

| Field | Type | Example |
|-------|------|---------|
| buyingIntentSignals | string[] | "Hiring SDRs", "Raised Series A" |
| monitoringKeywords | string[] | "looking for a tool like" |
| triggerEvents | string[] | "New CRO hired", "Competitor contract renewal" |

---

## Objection Library

| Field | Type |
|-------|------|
| id | string |
| objection | string |
| context | string |
| response | string |
| segment | string |

---

## Campaign Learnings

| Field | Type |
|-------|------|
| id | string |
| date | string |
| insight | string |
| source | `campaign` · `feedback` · `manual` · `rlhf` |
| segment | string |
| confidence | `hypothesis` · `validated` · `proven` |

---

## System State

| Field | Type | Purpose |
|-------|------|---------|
| connectedProviders | string[] | Which APIs are linked |
| onboardingComplete | boolean | Has user finished setup |
| lastUpdated | string | ISO timestamp |
| version | number | Schema version (currently 1) |
