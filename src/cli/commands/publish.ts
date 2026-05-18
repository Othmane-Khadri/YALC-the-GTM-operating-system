import { execSync, spawnSync } from "child_process";

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";

export async function runPublish() {
  const run = (cmd: string) => execSync(cmd, { encoding: "utf-8", stdio: "pipe" }).trim();

  // ── ensure gh is installed ─────────────────────────────────────────────────
  await ensureGh(run);

  // ── ensure gh is authenticated ─────────────────────────────────────────────
  ensureGhAuth();

  // ── resolve branch & commit message ───────────────────────────────────────
  let branch: string;
  try {
    branch = run("git rev-parse --abbrev-ref HEAD");
  } catch {
    console.error("[publish] Not inside a git repository.");
    process.exit(1);
  }

  if (branch! === "HEAD") {
    console.error("[publish] Detached HEAD — checkout a named branch first.");
    process.exit(1);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const commitMsg = `${branch!}/${timestamp}`;

  // ── git add . ──────────────────────────────────────────────────────────────
  console.log("[publish] Staging all changes...");
  try {
    run("git add .");
  } catch (err: unknown) {
    console.error("[publish] git add failed.");
    console.error(`  ${firstLine(err)}`);
    process.exit(1);
  }

  // ── git commit ─────────────────────────────────────────────────────────────
  const status = run("git status --porcelain");
  if (!status.length) {
    console.log("[publish] Nothing to commit — working tree is clean.");
  } else {
    console.log(`[publish] Committing as "${commitMsg}"...`);
    try {
      run(`git commit -m "${commitMsg}"`);
    } catch (err: unknown) {
      console.error("[publish] git commit failed.");
      console.error(`  ${firstLine(err)}`);
      process.exit(1);
    }
  }

  // ── git push ───────────────────────────────────────────────────────────────
  console.log(`[publish] Pushing ${branch!} to origin...`);
  const push = spawnSync("git", ["push", "origin", branch!], {
    stdio: "inherit",
    shell: IS_WIN,
  });
  if (push.status !== 0) {
    console.error("[publish] git push failed.");
    process.exit(1);
  }

  // ── resolve github repo slug (owner/repo) ─────────────────────────────────
  let repoSlug: string;
  try {
    const remoteUrl = run("git remote get-url origin");
    repoSlug = parseGithubSlug(remoteUrl);
  } catch {
    console.error("[publish] Could not determine GitHub repo from origin remote.");
    process.exit(1);
  }

  // ── gh pr create ───────────────────────────────────────────────────────────
  console.log("[publish] Creating pull request into main...");

  let prUrl: string | undefined;
  let prExists = false;
  try {
    const json = run(`gh pr view ${branch!} --repo ${repoSlug!} --json url,state`);
    const { url, state } = JSON.parse(json) as { url: string; state: string };
    if (state === "OPEN") {
      prExists = true;
      prUrl = url;
      console.log(`[publish] PR already open: ${url}`);
    }
    // MERGED or CLOSED → create a fresh PR
  } catch {
    // no existing PR — continue
  }

  if (!prExists) {
    const pr = spawnSync(
      "gh",
      ["pr", "create", "--repo", repoSlug!, "--base", "main", "--head", branch!, "--title", commitMsg, "--fill"],
      { stdio: ["inherit", "pipe", "inherit"], shell: IS_WIN, encoding: "utf-8" }
    );
    if (pr.status !== 0) {
      console.error("[publish] Could not create the pull request.");
      process.exit(1);
    }
    // gh pr create prints the PR URL as the last line of stdout
    prUrl = (pr.stdout as string).trim().split("\n").pop();
  }

  console.log(`\n[publish] Done. Branch "${branch!}" is up and a PR is open against main.`);

  if (prUrl) {
    const { runDescribeChange } = await import("./describe-change");
    await runDescribeChange(prUrl);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function ghInstalled(): boolean {
  try {
    execSync("gh --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

async function ensureGh(run: (cmd: string) => string) {
  if (ghInstalled()) return;

  console.log("[publish] GitHub CLI (gh) is not installed. Installing it now...");

  if (IS_MAC) {
    const hasBrew = (() => {
      try {
        run("brew --version");
        return true;
      } catch {
        return false;
      }
    })();

    if (hasBrew) {
      console.log("[publish] Installing via Homebrew...");
      const res = spawnSync("brew", ["install", "gh"], { stdio: "inherit", shell: false });
      if (res.status !== 0) {
        installFailed();
      }
    } else {
      // Homebrew itself is missing — install it first, then gh
      console.log("[publish] Homebrew not found. Installing Homebrew first (this may take a minute)...");
      const brewInstall = spawnSync(
        "/bin/bash",
        ["-c", "curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash"],
        { stdio: "inherit", shell: false }
      );
      if (brewInstall.status !== 0) {
        installFailed();
      }
      const res = spawnSync("brew", ["install", "gh"], { stdio: "inherit", shell: false });
      if (res.status !== 0) installFailed();
    }
  } else if (IS_LINUX) {
    // Try apt → yum → snap in order
    const apt = spawnSync("which", ["apt-get"], { stdio: "pipe" });
    if (apt.status === 0) {
      console.log("[publish] Installing via apt...");
      spawnSync(
        "bash",
        [
          "-c",
          "type -p curl >/dev/null || (apt-get update && apt-get install curl -y) && " +
            "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | " +
            "dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && " +
            "chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && " +
            'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | ' +
            "tee /etc/apt/sources.list.d/github-cli.list > /dev/null && " +
            "apt-get update && apt-get install gh -y",
        ],
        { stdio: "inherit" }
      );
    } else {
      const snap = spawnSync("which", ["snap"], { stdio: "pipe" });
      if (snap.status === 0) {
        console.log("[publish] Installing via snap...");
        spawnSync("snap", ["install", "gh"], { stdio: "inherit" });
      } else {
        installFailed();
      }
    }
  } else if (IS_WIN) {
    console.log("[publish] Installing via winget...");
    const res = spawnSync("winget", ["install", "--id", "GitHub.cli", "-e"], {
      stdio: "inherit",
      shell: true,
    });
    if (res.status !== 0) installFailed();
  } else {
    installFailed();
  }

  if (!ghInstalled()) {
    installFailed();
  }

  console.log("[publish] GitHub CLI installed successfully.");
}

function ensureGhAuth() {
  try {
    execSync("gh auth status", { stdio: "pipe" });
    // already authenticated
  } catch {
    console.log("\n[publish] You need to log in to GitHub.");
    console.log("         A browser window will open — follow the prompts to authenticate.\n");
    const login = spawnSync("gh", ["auth", "login", "--web"], {
      stdio: "inherit",
      shell: IS_WIN,
    });
    if (login.status !== 0) {
      console.error("[publish] GitHub login failed or was cancelled.");
      process.exit(1);
    }
  }
}

function parseGithubSlug(remoteUrl: string): string {
  // https://github.com/owner/repo.git  or  git@github.com:owner/repo.git
  const match = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!match) throw new Error(`Cannot parse GitHub slug from: ${remoteUrl}`);
  return match[1];
}

function installFailed(): never {
  console.error("\n[publish] Could not install the GitHub CLI automatically.");
  console.error("         Please install it manually from: https://cli.github.com");
  console.error("         Then re-run: yalc-gtm publish");
  process.exit(1);
}

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split("\n")[0];
}
