import { execSync, spawnSync } from "child_process";

const IS_WIN = process.platform === "win32";

/**
 * Fetch a GitHub PR's diff + metadata, then ask Claude Code to write a
 * plain-English CHANGES.md that non-technical stakeholders can read.
 *
 * Called automatically by the publish command, or directly:
 *   yalc-gtm describe-change <pr-url>
 */
export async function runDescribeChange(prUrl: string) {
  await ensureClaude();
  ensureClaudeAuth();

  console.log("[describe-change] Asking Claude to describe the PR...");

  const prompt =
    `You have been given a GitHub Pull Request URL: ${prUrl}\n\n` +
    `Your job:\n` +
    `1. Use the gh CLI to fetch the PR title, body, and file diff:\n` +
    `     gh pr view "${prUrl}" --json title,body,files\n` +
    `     gh pr diff "${prUrl}"\n` +
    `2. Write a file called CHANGES.md in the current working directory.\n` +
    `3. The file must be written in plain English for non-technical readers — ` +
    `no code, no jargon. Cover:\n` +
    `   - What this change is about (1-2 sentences)\n` +
    `   - What users or the business will notice or benefit from\n` +
    `   - Which parts of the product changed and why\n` +
    `4. Keep it short (under 200 words), friendly, and positive.\n\n` +
    `Write the CHANGES.md file now. Do not ask for confirmation.`;

  const result = spawnSync("claude", ["-p", prompt, "--dangerously-skip-permissions"], { stdio: "inherit", shell: IS_WIN });

  if (result.status !== 0) {
    console.error("[describe-change] Claude exited with an error. CHANGES.md may be incomplete.");
    process.exit(1);
  }

  console.log("[describe-change] CHANGES.md written.");
}

// ── helpers ───────────────────────────────────────────────────────────────────

function claudeInstalled(): boolean {
  try {
    execSync("claude --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function ensureClaude() {
  if (claudeInstalled()) return;

  console.log("[describe-change] Claude CLI not found. Installing via npm...");
  const res = spawnSync("npm", ["install", "-g", "@anthropic-ai/claude-code"], {
    stdio: "inherit",
    shell: IS_WIN,
  });

  if (res.status !== 0 || !claudeInstalled()) {
    console.error("[describe-change] Could not install Claude CLI automatically.");
    console.error("  Install manually: npm install -g @anthropic-ai/claude-code");
    console.error("  Then re-run: yalc-gtm describe-change <pr-url>");
    process.exit(1);
  }

  console.log("[describe-change] Claude CLI installed.");
}

function ensureClaudeAuth() {
  try {
    execSync('claude -p "ping" --dangerously-skip-permissions 2>&1', {
      stdio: "pipe",
      timeout: 15_000,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuthError = /api.?key|authenticate|login|unauthorized|401/i.test(msg);

    if (isAuthError) {
      console.log("\n[describe-change] You need to log in to Claude.");
      console.log("         Follow the prompts below to authenticate.\n");
      const login = spawnSync("claude", ["auth", "login"], {
        stdio: "inherit",
        shell: IS_WIN,
      });
      if (login.status !== 0) {
        console.error("[describe-change] Claude login failed or was cancelled.");
        process.exit(1);
      }
    }
    // Non-auth errors (e.g. timeout on slow machines) — let the main run proceed
  }
}
