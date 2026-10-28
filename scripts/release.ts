import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const compareUrl = "https://github.com/moinulmoin/vibecms/compare/main...dev";
const deployWorkflow = "deploy-production.yml";

type Run = {
  databaseId: number;
  headSha: string;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
};

type CommandResult = { status: number | null; stdout: string; stderr: string; error?: Error };

function command(program: string, args: string[], inherit = false, env = process.env): CommandResult {
  return spawnSync(program, args, {
    cwd: root,
    encoding: "utf8",
    env,
    stdio: inherit ? "inherit" : "pipe",
  });
}

function required(program: string, args: string[], inherit = false, env = process.env): string {
  const result = command(program, args, inherit, env);
  if (result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `exit status ${result.status}`;
    throw new Error(`${program} ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

function git(...args: string[]): string {
  return required("git", args);
}

function ghJson<T>(args: string[]): T {
  return JSON.parse(required("gh", args)) as T;
}

function runs(workflow: string, extra: string[] = []): Run[] {
  return ghJson<Run[]>([
    "run", "list", "--workflow", workflow, ...extra, "--limit", "100",
    "--json", "databaseId,headSha,status,conclusion,url,createdAt",
  ]);
}

function ciRun(sha: string): Run | undefined {
  return runs("ci.yml", ["--branch", "dev", "--event", "push", "--commit", sha])[0];
}

function describeRun(run: Run | undefined): string {
  if (!run) return "none found";
  return `${run.status === "completed" ? run.conclusion ?? "completed (no conclusion)" : run.status} — ${run.url}`;
}

function changesetCount(): number {
  return readdirSync(join(root, ".changeset"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md").length;
}

function versionPr(): string | undefined {
  const prs = ghJson<{ url: string }[]>([
    "pr", "list", "--state", "open", "--head", "changeset-release/main", "--json", "url", "--limit", "1",
  ]);
  return prs[0]?.url;
}

function showRef(label: string, ref: string): void {
  const result = command("git", ["log", "-1", "--format=%h %s", `${ref}^{commit}`]);
  console.log(`${label}: ${result.status === 0 ? result.stdout.trim() : "not found"}`);
}

function showStatus(): void {
  console.log("\nRelease status (local refs; run git fetch origin --tags to refresh):");
  showRef("origin/dev", "refs/remotes/origin/dev");
  showRef("origin/main", "refs/remotes/origin/main");
  showRef("staging", "refs/tags/staging");
  showRef("production", "refs/tags/production");
  console.log("\nCommits on dev not on main:");
  const log = command("git", ["log", "--oneline", "origin/main..origin/dev"]);
  console.log(log.status === 0 ? log.stdout.trim() || "  (none)" : `  unavailable: ${log.stderr.trim()}`);
  console.log(`Compare: ${compareUrl}`);
  try {
    const sha = git("rev-parse", "refs/remotes/origin/dev^{commit}");
    console.log(`CI for dev HEAD: ${describeRun(ciRun(sha))}`);
  } catch (error) {
    console.log(`CI for dev HEAD: unavailable (${message(error)})`);
  }
  try {
    console.log(`Pending changesets: ${changesetCount()}`);
  } catch (error) {
    console.log(`Pending changesets: unavailable (${message(error)})`);
  }
  try {
    console.log(`Open version PR: ${versionPr() ?? "none"}`);
  } catch (error) {
    console.log(`Open version PR: unavailable (${message(error)})`);
  }
  try {
    console.log(`Last deploy-production run: ${describeRun(runs(deployWorkflow)[0])}`);
  } catch (error) {
    console.log(`Last deploy-production run: unavailable (${message(error)})`);
  }
}

function releaseNotice(): void {
  try {
    const count = changesetCount();
    if (count === 0) return;
    let pr: string;
    try {
      pr = versionPr() ?? "not open yet; the Release workflow creates it after promotion";
    } catch (error) {
      pr = `unavailable (${message(error)})`;
    }
    console.log(`\nCLI release notice: ${count} pending changeset(s). Version PR: ${pr}`);
  } catch (error) {
    console.error(`Could not determine pending changesets: ${message(error)}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function remoteStagingObject(): string | undefined {
  const output = git("ls-remote", "--tags", "origin", "refs/tags/staging");
  return output ? output.split(/\s+/)[0] : undefined;
}

function markStaging(): void {
  if (git("status", "--porcelain", "--untracked-files=normal") !== "") {
    console.error("Warning: staging runs uncommitted changes; removing the staging marker so promotion will refuse.");
    if (remoteStagingObject()) {
      // Invalidation must not be blocked by pre-push checks on the dirty checkout.
      required("git", ["push", "origin", ":refs/tags/staging"], false, { ...process.env, LEFTHOOK: "0" });
    }
    if (command("git", ["show-ref", "--verify", "--quiet", "refs/tags/staging"]).status === 0) {
      git("tag", "-d", "staging");
    }
    return;
  }
  git("tag", "-f", "staging", "HEAD");
  // A tag push carries no new code to check; the pre-push gates already ran on the dev push.
  required("git", ["push", "-f", "origin", "refs/tags/staging"], true, { ...process.env, LEFTHOOK: "0" });
  console.log(`Staging marked at ${git("rev-parse", "--short", "HEAD")}.`);
  const pushed = command("git", ["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/dev"]);
  if (pushed.status !== 0) console.error("Warning: this commit is not on origin/dev yet. Push dev before promoting: git push origin dev");
}

function watch(run: Run, label: string): void {
  console.log(`Watching ${label}: ${run.url}`);
  const result = command("gh", ["run", "watch", String(run.databaseId), "--exit-status"], true);
  if (result.status !== 0) {
    throw new Error(`${label} did not succeed (or could not be watched): ${run.url}. Inspect it with gh run view ${run.databaseId}${result.error ? ` (${result.error.message})` : ""}`);
  }
  console.log(`${label} succeeded: ${run.url}`);
}

async function dispatchDeploy(sha: string): Promise<void> {
  const before = new Set(runs(deployWorkflow, ["--branch", "main", "--event", "workflow_dispatch"]).map((run) => run.databaseId));
  const output = required("gh", ["workflow", "run", deployWorkflow, "--ref", "main", "-f", `release_sha=${sha}`, "-f", "smoke_mode=authenticated"]);
  const directId = output.match(/\/actions\/runs\/(\d+)/)?.[1];
  let run: Run | undefined;
  for (let attempt = 0; attempt < 30; attempt++) {
    const candidates = runs(deployWorkflow, ["--branch", "main", "--event", "workflow_dispatch"])
      .filter((item) => directId ? String(item.databaseId) === directId : !before.has(item.databaseId) && item.headSha === sha);
    if (candidates.length > 1) {
      throw new Error("Multiple new production runs found; cannot identify the dispatched run safely. Inspect the Actions page.");
    }
    if (candidates.length === 1) {
      run = candidates[0];
      break;
    }
    await delay(2000);
  }
  if (!run) throw new Error(`Production workflow was dispatched, but its run could not be found. Inspect GitHub Actions.${output ? ` ${output}` : ""}`);
  watch(run, "Production deployment");
}

async function promote(deploy: boolean, dryRun: boolean): Promise<void> {
  required("git", ["fetch", "--force", "--tags", "origin", "+refs/heads/dev:refs/remotes/origin/dev", "+refs/heads/main:refs/remotes/origin/main"], true);
  if (git("branch", "--show-current") !== "dev") throw new Error("Promotion requires the dev branch. Run: git switch dev");
  if (git("status", "--porcelain", "--untracked-files=normal") !== "") {
    throw new Error("Promotion requires a clean working tree, including untracked files. Run git status, then commit your changes or run git stash push -u before promoting again.");
  }
  const head = git("rev-parse", "HEAD^{commit}");
  const dev = git("rev-parse", "refs/remotes/origin/dev^{commit}");
  if (head !== dev) {
    const remoteAncestor = command("git", ["merge-base", "--is-ancestor", dev, head]);
    const localAncestor = command("git", ["merge-base", "--is-ancestor", head, dev]);
    if (remoteAncestor.status === 0) throw new Error("HEAD is ahead of origin/dev. Run: git push origin dev");
    if (localAncestor.status === 0) throw new Error("HEAD is behind origin/dev. Run: git pull --ff-only origin dev");
    if (remoteAncestor.status !== 1 || localAncestor.status !== 1) throw new Error("Could not compare HEAD and origin/dev; inspect their history with git log --oneline --left-right origin/dev...HEAD");
    throw new Error("HEAD and origin/dev have diverged. Run: git merge origin/dev && git push origin dev");
  }
  const ancestor = command("git", ["merge-base", "--is-ancestor", "origin/main", head]);
  if (ancestor.status !== 0) {
    if (ancestor.status !== 1) throw new Error(`Could not check main ancestry: ${ancestor.stderr.trim() || ancestor.error?.message || "git failed"}`);
    throw new Error("origin/main is not an ancestor of dev. Run: git merge origin/main && git push origin dev\nWait for CI, then promote again.");
  }
  if (head === git("rev-parse", "refs/remotes/origin/main^{commit}")) {
    console.log("nothing to release");
    return;
  }
  console.log("Commits to release:");
  console.log(git("log", "--oneline", "origin/main..HEAD"));
  const ci = ciRun(head);
  if (!ci) throw new Error("No CI push run found for dev HEAD. Inspect runs with gh run list --workflow ci.yml --branch dev; push a new commit to dev if no run exists.");
  if (ci.status !== "completed") watch(ci, "CI");
  else if (ci.conclusion !== "success") throw new Error(`CI did not succeed (${ci.conclusion ?? "no conclusion"}): ${ci.url}. Inspect it with gh run view ${ci.databaseId}, fix the failure, and push dev again with git push origin dev.`);
  else console.log(`CI succeeded: ${ci.url}`);
  const remoteTag = remoteStagingObject();
  const localTag = command("git", ["rev-parse", "--verify", "refs/tags/staging"]);
  const stagedCommit = command("git", ["rev-parse", "--verify", "refs/tags/staging^{commit}"]);
  if (!remoteTag || localTag.status !== 0 || remoteTag !== localTag.stdout.trim() || stagedCommit.status !== 0 || stagedCommit.stdout.trim() !== head) {
    throw new Error("deploy this commit to staging first: pnpm deploy:dev");
  }
  if (dryRun) {
    console.log("Dry run: would run git push origin HEAD:main");
    if (deploy) console.log(`Dry run: would run gh workflow run ${deployWorkflow} --ref main -f release_sha=${head} -f smoke_mode=authenticated and watch the run`);
    return;
  }
  required("git", ["push", "origin", "HEAD:main"], true);
  if (deploy) await dispatchDeploy(head);
}

async function main(): Promise<void> {
  const [action, ...options] = process.argv.slice(2);
  if (action === "status" && options.length === 0) {
    showStatus();
  } else if (action === "mark-staging" && options.length === 0) {
    markStaging();
  } else if (action === "promote" && options.every((option) => option === "--deploy" || option === "--dry-run")) {
    try {
      await promote(options.includes("--deploy"), options.includes("--dry-run"));
    } catch (error) {
      console.error(message(error));
      process.exitCode = 1;
    } finally {
      releaseNotice();
      showStatus();
    }
  } else {
    throw new Error("Usage: tsx scripts/release.ts status | promote [--deploy] [--dry-run] | mark-staging");
  }
}

main().catch((error: unknown) => {
  console.error(message(error));
  process.exitCode = 1;
});
