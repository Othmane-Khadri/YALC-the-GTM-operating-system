# QA Audit Prompt — YALC (GTM-OS)

You are a QA tester auditing YALC, an AI-native GTM operating system built with Next.js 14, SQLite, Drizzle ORM, and the Anthropic Claude API. Your job is to walk through every user-facing flow, try to break things, and document what fails.

**Environment setup:**
- Clone the repo, run `pnpm install`, `cp .env.example .env.local`
- Add your `ANTHROPIC_API_KEY` to `.env.local`
- Generate an `ENCRYPTION_KEY`: `openssl rand -hex 32` and add it
- Run `pnpm db:push` then `pnpm dev`
- Open `http://localhost:3000`

**For each test below:** note Pass/Fail, what you expected, what actually happened, and any console errors (browser + terminal).

---

## Test 1: First Visit & Onboarding

The onboarding modal should auto-fire when no framework exists.

1. Open `http://localhost:3000` in a fresh browser (clear localStorage/cookies)
2. You should land on `/chat` with the onboarding modal open
3. Verify you CANNOT close the modal (no X button, no backdrop click dismiss)

**Step 0 — Website URL:**
- [ ] Enter a real company URL (e.g. `https://stripe.com`) and click Next
- [ ] Try entering an empty URL — button should be disabled
- [ ] Try entering `http://169.254.169.254/latest/meta-data/` (SSRF) — should be blocked
- [ ] Try entering `http://localhost:3000` (loopback) — should be blocked

**Step 1 — File Upload:**
- [ ] Upload a `.txt` file — should show in the list
- [ ] Upload a `.md` file — should show in the list
- [ ] Upload a `.pdf` file — does it show? (Known issue: PDF text is NOT extracted, just stored as a placeholder string)
- [ ] Upload a `.docx` file — does it accept it? What happens? (Known issue: docx is binary, `readAsText()` produces garbled output that gets sent to Claude)
- [ ] Upload a file larger than 100KB — what happens?
- [ ] Skip uploading entirely and click Next — should still work

**Step 2 — AI Processing:**
- [ ] Watch the streaming status messages. Does extraction complete?
- [ ] If your URL was unreachable, does it show an error or continue silently with a bad framework?
- [ ] Check terminal for any errors during extraction
- [ ] Time the extraction — how long does it take?

**Step 3 — Review:**
- [ ] Verify the extracted framework is editable
- [ ] Make a change (e.g. edit company name) and click Next
- [ ] Does your edit persist to step 4?

**Step 4 — Follow-up Questions:**
- [ ] Answer at least one follow-up question
- [ ] Click "Complete Setup"
- [ ] **CRITICAL CHECK:** After completing, go to `/settings` — does the framework contain your follow-up answers? (Known issue: follow-up answers are collected in browser state but NEVER sent to the server — they may be lost)
- [ ] Check terminal for errors during the complete call
- [ ] **FAILURE TEST:** Open browser DevTools Network tab. When "Complete Setup" fires `POST /api/onboarding/complete`, block that request (right-click → Block request URL). Does the modal close anyway? Does the user get an error? (Known issue: modal closes silently even on server failure)

---

## Test 2: Chat Interface

After onboarding, you should be on `/chat`.

**Basic messaging:**
- [ ] Type "Hello" and send — should get a streaming Claude response
- [ ] Check that the message appears in the chat history
- [ ] Refresh the page — does the conversation persist?
- [ ] Start a new conversation — verify old one is still accessible

**Workflow proposal:**
- [ ] Type "Find 20 SaaS companies in France with 50-200 employees"
- [ ] Claude should respond with a `WorkflowPreviewCard` showing steps
- [ ] Verify each step shows a provider badge — should say `mock` (unless you set `APIFY_TOKEN`)
- [ ] Verify the step types have correct icons (search, enrich, qualify, filter, export)
- [ ] Check the estimated time and result count

**Edge cases:**
- [ ] Send an empty message — should be blocked
- [ ] Send a very long message (5000+ characters) — does it work?
- [ ] Rapidly send 10 messages — any race conditions? Duplicate messages?
- [ ] While Claude is streaming, send another message — what happens?
- [ ] Close the browser tab during streaming, then reopen — is the conversation corrupted?

---

## Test 3: Workflow Execution

From the workflow proposal card in chat:

1. Click "Run this workflow"
2. The button should change to "Running..." with a spinner

**During execution:**
- [ ] Watch for SSE events in the chat — step progress updates
- [ ] Each step should show start → complete with row counts
- [ ] Filter and export steps should show informational notes (not 0 rows)
- [ ] After completion, a "View Table" link card should appear

**Failure tests:**
- [ ] Close the browser tab during execution. Reopen. Check terminal — is the server still processing? (Known issue: no SSE cancel handler — server continues for up to 3 minutes)
- [ ] Check the terminal for any `step_warning` fallback events
- [ ] If you have `APIFY_TOKEN` set: temporarily set it to an invalid value, run a workflow that uses Apify. Does it fall back to mock gracefully?

---

## Test 4: Table View & RLHF

Navigate to the table (via "View Table" link or `/tables`).

**Tables list:**
- [ ] `/tables` shows all result sets with row counts
- [ ] Each card shows feedback progress bar (if any feedback given)
- [ ] Click a table card — navigates to `/tables/[id]`

**Table detail:**
- [ ] Columns render correctly with proper headers
- [ ] Row data is visible and scrollable
- [ ] Text search filters rows in real-time

**Feedback (individual):**
- [ ] Click approve on a row — green checkmark appears
- [ ] Click reject on a row — red X appears
- [ ] Click flag on a row — yellow flag appears
- [ ] Click the same feedback again — should toggle off (null)
- [ ] Use keyboard: press `j`/`k` to navigate, `a`/`r`/`f` to feedback

**Feedback (bulk):**
- [ ] Select all rows, click "Approve All"
- [ ] Verify all rows show approved state
- [ ] Refresh page — does the feedback persist in the DB?
- [ ] **FAILURE TEST:** Open DevTools, go offline (Network tab → Offline). Try to approve a row. What happens? (Known issue: optimistic update applies but server call fails silently — UI and DB are out of sync)

**Learning extraction:**
- [ ] Approve at least 5 rows and reject at least 5 rows
- [ ] Click "Done Reviewing" — should trigger learning extraction
- [ ] If you have fewer than 5 approved OR fewer than 5 rejected, does it show an error? (Known issue: the 400 error message is not displayed to the user)
- [ ] Review the extracted learnings — edit one, dismiss one, confirm the rest
- [ ] Click "Save N Learnings"
- [ ] Go to `/settings` — verify learnings appear in the framework

---

## Test 5: Knowledge Base

Navigate to `/knowledge`.

**Upload:**
- [ ] Drag and drop a `.md` file — should upload and appear in the list
- [ ] Upload a `.txt` file — same
- [ ] Upload a `.csv` file — same
- [ ] Upload a `.pdf` file — appears in list but check: go to chat and ask about the PDF content. Does Claude know anything from it? (Known issue: PDF text is `[PDF file: name.pdf]` — no actual content extraction)
- [ ] Upload a file with special characters in the name
- [ ] Upload the same file twice — are duplicates created?

**Search & filter:**
- [ ] Type in the search box — does it filter the knowledge items?
- [ ] Use the type filter dropdown — does it work? (Note: all uploads default to type `other`)

**Delete:**
- [ ] Delete a knowledge item — does it disappear?
- [ ] Refresh — is it gone from the DB?
- [ ] **FAILURE TEST:** Block the DELETE API call in DevTools — what feedback does the user get? (Known issue: no error handling on delete)

**Integration with chat:**
- [ ] Upload a document with distinctive content (e.g. "Our target market is underwater basket weaving")
- [ ] In chat, ask "What is our target market?"
- [ ] Does Claude reference the knowledge base content in its response?

---

## Test 6: API Keys Page

Navigate to `/api-keys`.

- [ ] Page shows 6 providers: Apollo, Firecrawl, Hunter, Clearbit, BuiltWith, OpenAI
- [ ] Note: Anthropic and Apify are NOT listed here (they use env vars only)
- [ ] Enter a fake API key for any provider, click Save
- [ ] Status should show "Connected" — but this is misleading (it only validates encryption format, not actual connectivity)
- [ ] Click "Test Connection" — does it return "Connected"? (Known issue: test only checks format, not real API)
- [ ] Delete a saved key — does it clear?
- [ ] **FAILURE TEST:** Remove `ENCRYPTION_KEY` from `.env.local`, restart server, try to save a key. What error do you get?

---

## Test 7: MCP Server Connections

Navigate to `/mcps`.

- [ ] Page loads with empty server list (or any previously added)
- [ ] Try adding a server with an invalid command — what error?
- [ ] Try adding an SSE server with `http://localhost:9999` (nothing running) — what happens?
- [ ] If you have an MCP server available, test full connection flow
- [ ] Toggle "Expose as MCP Server" — note the generated token. Does it persist across page reloads? (Known issue: token is browser-side only, requires manual env var setup)

---

## Test 8: Campaigns

From chat, get Claude to propose a campaign (try "Create a campaign to find and qualify 100 B2B SaaS leads in Europe").

- [ ] Campaign preview card appears in chat
- [ ] Click "Start Campaign" — does it create?
- [ ] Navigate to `/campaigns` — is the campaign listed?
- [ ] Click into the campaign — do steps render?
- [ ] Try executing a step — does it work or error?
- [ ] Try pause/resume actions
- [ ] Try "Analyze" — does the optimizer run? (Known issue: no try/catch at route level — Claude failures crash the endpoint)

---

## Test 9: Settings Page

Navigate to `/settings`.

- [ ] Framework editor loads with current data
- [ ] Edit a field, click Save — verify "Saved" message
- [ ] Click "Redo Onboarding" — should reset framework and redirect to `/chat` with onboarding modal
- [ ] After re-onboarding, does the old framework data carry over? (It shouldn't — reset deletes it)

---

## Test 10: Environment & Security Edge Cases

**Missing env vars (test one at a time, restart server each time):**
- [ ] Remove `ANTHROPIC_API_KEY` — try to chat. What error does the user see?
- [ ] Remove `ENCRYPTION_KEY` — try to save an API key. What happens?
- [ ] Remove `DATABASE_URL` — does it fall back to local SQLite?
- [ ] Skip running `pnpm db:push` on a fresh install — what errors appear?

**Auth (if Google OAuth is configured):**
- [ ] Without session, try accessing `/chat` directly — should redirect to `/login`
- [ ] Without session, try calling `POST /api/chat` directly via curl — should get 401 or redirect
- [ ] With `GTM_OS_API_TOKEN` set, try `curl -H "Authorization: Bearer <token>" localhost:3000/api/tables` — should work
- [ ] With `ALLOWED_EMAILS` empty, can any Google account log in? (Expected: yes — security risk if deployed publicly)

**General:**
- [ ] Check browser console for any React hydration errors on every page
- [ ] Check terminal for any unhandled promise rejections during normal use
- [ ] Try each page at mobile width (375px) — anything broken?
- [ ] Try with JavaScript disabled — what renders?

---

## Test 11: Data Integrity & Race Conditions

- [ ] Open two browser tabs on the same conversation. Send a message in tab 1. Does tab 2 see it without refresh?
- [ ] In the table view, approve a row in tab 1 while rejecting it in tab 2 simultaneously. Which wins?
- [ ] Run a workflow execution. While it's running, navigate away from chat. Come back — is the result there?
- [ ] Delete a table from `/tables` while viewing it in another tab. What happens in the detail view?
- [ ] Create multiple workflows rapidly in the same conversation — any DB constraint violations?

---

## Known Issues (Verify These)

These were identified in code review. Confirm they reproduce:

1. **Onboarding follow-up answers lost** — answers from step 4 are collected but never sent to the API
2. **Onboarding complete fails silently** — modal closes even if server save fails
3. **PDF knowledge not searchable** — uploaded as placeholder text only
4. **API key test is fake** — only validates encryption format, not real connectivity
5. **docx upload garbled** — binary file read as text produces garbage
6. **Learning extraction error not shown** — when fewer than 5 approved/rejected, the 400 response message is swallowed
7. **Bulk feedback partial failure** — if some of N parallel PATCH calls fail, UI shows all as updated
8. **SSE no cancel handler** — server continues processing after client disconnects
9. **Campaign conversationId hardcoded** — all campaigns created with `"default"` conversation reference
10. **N+1 query on /api/tables** — each table card triggers a separate DB query for row counts

---

## Deliverable

For each test, report:

```
## Test X: [Name]
### [Sub-test description]
- **Status:** Pass / Fail / Partial
- **Expected:** [what should happen]
- **Actual:** [what actually happened]
- **Console errors:** [any errors from browser or terminal]
- **Severity:** Critical / High / Medium / Low
- **Screenshot:** [if applicable]
```

Prioritize findings by severity:
- **Critical:** Data loss, security holes, complete flow blockers
- **High:** Major UX issues, silent failures, incorrect data
- **Medium:** Missing error messages, degraded experience, cosmetic issues
- **Low:** Minor polish, edge cases unlikely in normal use
