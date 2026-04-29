# YALC GTM-OS — Setup Procedure

This is the long-form runbook for the `/setup` skill. Walk the user through every step, in order. Each numbered step is a single conversational beat — confirm with the user before moving on when the step asks for input or approval.

Hard rules across the whole flow:
- **Never print or echo API keys, tokens, or secrets.** When you read `~/.gtm-os/.env` for any reason, mask values (e.g. `ANTHROPIC_API_KEY=sk-...redacted`). Never display raw key values back to the user. Never include them in any tool input either.
- **Never push to git.** This skill only runs local YALC commands.
- **Never assume command success.** Every CLI call below has an exit-code check — if it fails, stop and report the exact stderr to the user before continuing.
- **Use `--non-interactive` everywhere.** YALC will not prompt mid-flow. All values are passed as flags.

---

## Step 1 — Verify YALC is installed (and recent enough)

Run:
```bash
yalc-gtm --version 2>/dev/null || echo "NOT_INSTALLED"
```

Decision tree:
- Output is `NOT_INSTALLED` (or command is not found) → run `npm i -g yalc-gtm-os` (warn the user it may need `sudo` on system Node; if so, ask before re-running with sudo). Re-check version.
- Output is a version string `< 0.7.0` → run `npm i -g yalc-gtm-os@latest`. Re-check.
- Output is `0.7.0` or higher → continue.

Print the resolved version once: `YALC GTM-OS <version> ready.`

---

## Step 2 — Run scaffold + write template .env

Run:
```bash
yalc-gtm start --non-interactive
```

Exit code 0 expected. The command writes `~/.gtm-os/` (config, db, env template) and prints a banner. Do not parse the banner — just confirm exit 0.

If the directory already existed, the command will preserve user-filled keys and only delta-merge new placeholder lines. That's fine — proceed without warning the user.

---

## Step 3 — Hand off the .env to the user

Tell the user, verbatim or close to it:

> I created `~/.gtm-os/.env` with placeholder lines for every supported provider. Open it in your editor — `open ~/.gtm-os/.env` will open it in your default app — uncomment and fill in the keys you want to use. The template lists every built-in provider plus common MCP keys.
>
> Tell me **"keys done"** when you've saved the file and I'll continue.

Wait for the user to confirm. Do not progress until they say so.

While waiting, do not read the file's contents back into chat — the user does not need to see their own keys, and you must not display them.

---

## Step 4 — Collect capture inputs

Ask the user, one question at a time:

1. **Required** — "What is your company website URL?" (must start with `http://` or `https://`)
2. **Optional** — "Do you have a LinkedIn profile URL you'd like me to use for voice extraction? Skip if you'd rather not."
3. **Optional** — "Any docs you want me to ingest? Paste a URL or a local folder/file path. You can list more than one — I'll repeat the question if you have additional docs."

Do **not** ask for `--icp-summary` yet — only ask for it if Step 5 reports a thin fetch.

If the user can't or won't share a website, fall back to the legacy interactive interview by running `yalc-gtm start` (no `--non-interactive`) and let them answer the 10-question flow. Note this is rare; the website-driven path is the default.

---

## Step 5 — Run flag-driven capture

Construct the command from the inputs in Step 4:
```bash
yalc-gtm start --non-interactive \
  --website "<website>" \
  [--linkedin "<linkedin>"] \
  [--docs "<docs1>" --docs "<docs2>" ...]
```

Run it. Three outcomes:

**A — Exit 0 with a clean preview written.** Capture succeeded. Move to Step 6.

**B — Exit non-zero with `Insufficient source content` in stderr.** This is the synthesis-input-validation refusal (Phase 1 #3). Read the captured volumes from the message and ask the user for one of:
- A `--icp-summary "<one-liner>"` describing who they sell to, OR
- A different `--website` URL that has more content, OR
- An additional `--docs` source.

Re-run the command with the extra flag(s). Do **not** pass `--force-synthesis` unless the user explicitly says "ignore the bar and try anyway."

**C — Stdout contains a `<<<YALC_WEBFETCH_REQUEST:{...}>>>` marker.** YALC needs the parent harness (you) to fetch a URL it can't reach itself. Parse the JSON inside the marker — it has `url`, `save_to`, and `reason` fields. Then:

1. Use the WebFetch tool to fetch the URL.
2. Save the fetched markdown to the `save_to` path (create parent dirs if needed).
3. Re-run the same `yalc-gtm start` command. The cached content will now satisfy the fetch.

---

## Step 6 — Hand off to the SPA review surface

Capture finished by auto-opening `http://localhost:3847/setup/review` in the user's browser. The page lists every draft section as an editable card with a confidence badge — the user edits inline, saves per section, then clicks **Save & Commit** to promote everything to live.

Tell the user, verbatim or close to it:

> I've opened **http://localhost:3847/setup/review** in your browser. Edit each section as needed, hit **Save** on each card you change, then click **Save & Commit** to promote the preview to live. When you're done, tell me **"committed"** and I'll continue with doctor + framework recommendations.

Wait for the user to confirm "committed". Do not progress until they say so.

If the browser didn't open (headless box, CI, container) the CLI prints the URL — the user can copy it. If they have no browser at all, they can rerun with `--review-in-chat` for a terminal-driven walk that commits immediately:
```bash
yalc-gtm start --non-interactive --website "<website>" --review-in-chat
```

While waiting, do not read the preview files back into chat — the user is editing them in the browser and re-reading is just noise.

---

## Step 7 — Confirm commit

When the user says "committed", verify the sentinel:
```bash
test -f ~/.gtm-os/_handoffs/setup/review.committed && echo OK
```

The SPA's commit handler writes that file as soon as `/api/setup/commit` succeeds. If the file is missing the user may have closed the tab without clicking **Save & Commit** — gently ask them to revisit the page.

Confirm to the user: "Setup is now live at `~/.gtm-os/`. Running doctor next."

---

## Step 8 — Run doctor

Run:
```bash
yalc-gtm doctor
```

Read the output and summarize for the user:
- Total layers passed / warned / failed.
- Any **WARN** lines about missing keys or unfilled goals — pass these through.
- Any **FAIL** lines — flag them and ask the user if they want to fix now (likely a missing key) or continue.

Do not gate framework recommendation on doctor passing — many frameworks work with a subset of providers. But surface the failures clearly.

---

## Step 9 — Recommend frameworks

Run:
```bash
yalc-gtm framework:recommend
```

The command prints a ranked list of frameworks the user qualifies for, given the providers they configured and the company context they captured. Each row shows: name, one-line description, what it requires, where output will land (Notion if `NOTION_API_KEY` is set, dashboard otherwise).

For each recommended framework:
1. Read the description aloud (paraphrased).
2. Ask: "Want to install this one? (yes / skip)"
3. If yes — run the install wizard:
   ```bash
   yalc-gtm framework:install <name>
   ```
   The wizard prompts for inputs interactively. Walk the user through each prompt. When asked about output destination, default to `dashboard` if they don't have Notion configured.
4. After install, the seed run executes once. Print the output URL to the user.

If the user wants to install a recommended framework non-interactively (defaults are fine), use `--auto-confirm`:
```bash
yalc-gtm framework:install <name> --auto-confirm
```

Repeat for every framework the user accepts.

---

## Step 10 — Hand-off summary

Print a closing summary:

- **Installed providers:** read from `~/.gtm-os/config.yaml` (services with non-empty keys).
- **Active frameworks:** run `yalc-gtm framework:list` and report the ones with `status: active`.
- **Output destinations:** Notion parent page (if set) and `http://localhost:3847/frameworks` (dashboard).
- **What to check daily:** the dashboard URL or the Notion pages.
- **How to inspect a framework:** `yalc-gtm framework:status <name>` and `yalc-gtm framework:logs <name>`.
- **How to disable / remove:** `yalc-gtm framework:disable <name>` (keeps config) or `yalc-gtm framework:remove <name>` (deletes).

End with: "You're set. The frameworks will run on their own schedules. Come back anytime — `yalc-gtm framework:recommend` will surface new ones as you add providers or context."
