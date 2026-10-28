import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

function command(program: string, args: string[]): string {
  const result = spawnSync(program, args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error((result.stderr || result.error?.message || `${program} exited ${result.status}`).trim());
  }
  return result.stdout;
}

function git(...args: string[]): string {
  return command("git", args);
}

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function oneLine(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

let failures = 0;
async function check(name: string, fix: string, run: () => void | string | Promise<void | string>): Promise<void> {
  try {
    const detail = await run();
    console.log(`PASS ${name}${detail ? `: ${oneLine(detail)}` : ""}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}: ${oneLine(error instanceof Error ? error.message : String(error))}`);
    console.log(`  Fix: ${fix}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let base: string | undefined;
let changes: { status: string; path: string }[] | undefined;

await check("OpenAPI", "Run pnpm openapi:gen and stage the updated apps/api/openapi.json.", async () => {
  // Load inside the check so a broken generator is reported without skipping other checks.
  const { buildOpenApiDocument } = await import("../apps/api/src/server/api/routes.ts");
  const generated = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
  // openapi:check compares the generated file to the index, not HEAD.
  assert(generated === git("show", ":apps/api/openapi.json"), "generated OpenAPI differs from the index");
  assert(generated === read("apps/api/openapi.json"), "apps/api/openapi.json is stale in the working tree");
});

await check("Generated agent skills", "Run pnpm gen:agent-skills and commit the generated outputs.", () => {
  command(process.execPath, ["scripts/gen-agent-skills.mjs", "--check"]);
});

await check("Public release audit", "Resolve the public audit finding; run pnpm public:audit for details.", () => {
  command("bash", ["scripts/public-release-audit.sh"]);
});

await check("Comparison base", "Fetch origin/main or set CHECK_BASE to an available commit.", () => {
  const requested = process.env.CHECK_BASE?.trim();
  const candidate = requested || git("merge-base", "HEAD", "origin/main").trim();
  assert(candidate, "no comparison base was resolved");
  const commit = git("rev-parse", "--verify", "--end-of-options", `${candidate}^{commit}`).trim();
  // A three-dot diff compares HEAD with the merge base of the two commits.
  base = git("merge-base", "HEAD", commit).trim();
  assert(base, `no common ancestor for HEAD and ${candidate}`);
  const parts = git("diff", "--no-renames", "--name-status", "-z", `${base}...HEAD`, "--").split("\0");
  changes = [];
  for (let i = 0; i + 1 < parts.length && parts[i]; i += 2) {
    changes.push({ status: parts[i], path: parts[i + 1] });
  }
});

await check("Append-only migrations", "Restore existing migrations and add a new migration with a higher sequence number.", () => {
  assert(base && changes, "comparison base unavailable");
  const prefix = "packages/db/drizzle/";
  const migrationName = /^(\d{4})_[a-z0-9_]+\.sql$/;
  const oldFiles = git("ls-tree", "-r", "--name-only", base, "--", prefix).split("\n").filter(Boolean);
  const highest = Math.max(0, ...oldFiles.map((path) => Number(migrationName.exec(path.slice(prefix.length))?.[1] ?? 0)));
  const migrations = changes.filter(({ path }) => path.startsWith(prefix));
  const invalid = migrations.filter(({ status, path }) => {
    const match = migrationName.exec(path.slice(prefix.length));
    return status !== "A" || !match || Number(match[1]) <= highest;
  });
  assert(invalid.length === 0, `modified, removed, invalid, or out-of-order migrations: ${invalid.map(({ status, path }) => `${status} ${path}`).join(", ")}`);
  const counts = (paths: string[]) => {
    const result = new Map<string, number>();
    for (const path of paths) {
      const number = migrationName.exec(path.slice(prefix.length))?.[1];
      if (number) result.set(number, (result.get(number) ?? 0) + 1);
    }
    return result;
  };
  const inherited = counts(oldFiles);
  const current = counts(git("ls-tree", "-r", "--name-only", "HEAD", "--", prefix).split("\n").filter(Boolean));
  const duplicates = [...current].filter(([number, count]) => count > 1 && count > (inherited.get(number) ?? 0));
  assert(duplicates.length === 0, `new duplicate migration numbers: ${duplicates.map(([number, count]) => `${number} ×${count}`).join(", ")}`);
  const existingDuplicates = [...inherited].filter(([, count]) => count > 1).sort(([a], [b]) => a.localeCompare(b));
  if (existingDuplicates.length) return `inherited: ${existingDuplicates.map(([number, count]) => `${number} ×${count}`).join(", ")}`;
});

type Manifest = {
  name?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

function workspacePackages(): Map<string, { path: string; manifest: Manifest }> {
  const packages = new Map<string, { path: string; manifest: Manifest }>();
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      const path = `${parent}/${entry.name}`;
      const file = join(root, path, "package.json");
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
      if (manifest.name) packages.set(manifest.name, { path, manifest });
    }
  }
  return packages;
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return ["node_modules", "dist", "__tests__"].includes(entry.name) ? [] : sourceFiles(path);
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

function runtimeWorkspacePaths(): string[] {
  const packages = workspacePackages();
  const cli = packages.get("vibecms-cli");
  assert(cli, "CLI workspace package not found");
  const found = new Set<string>();
  const pending = ["vibecms-cli"];
  while (pending.length) {
    const name = pending.pop()!;
    if (found.has(name)) continue;
    const workspace = packages.get(name);
    if (!workspace) continue;
    found.add(name);
    // Type-only and test imports do not contribute to the published runtime.
    for (const file of sourceFiles(join(root, workspace.path, "src"))) {
      const source = readFileSync(file, "utf8");
      const imports = source.matchAll(/\b(?:import\s+(?!type\b)(?:[^;\n]*?\s+from\s+)?|export\s+(?!type\b)[^;\n]*?\s+from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/g);
      for (const match of imports) {
        const specifier = match[1];
        const imported = specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
        if (packages.has(imported)) pending.push(imported);
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(file), specifier);
          for (const [workspaceName, candidate] of packages) {
            if (target.startsWith(`${join(root, candidate.path)}/`)) pending.push(workspaceName);
          }
        }
      }
    }
    for (const dependency of Object.keys({ ...workspace.manifest.dependencies, ...workspace.manifest.optionalDependencies })) {
      if (packages.has(dependency)) pending.push(dependency);
    }
  }
  found.delete("vibecms-cli");
  return [...found].map((name) => packages.get(name)!.path).sort();
}

await check("CLI changeset", "Add a changeset for vibecms-cli describing the CLI change.", () => {
  assert(base && changes, "comparison base unavailable");
  const inputs = ["packages/cli/", ...runtimeWorkspacePaths().map((path) => `${path}/`)];
  const relevant = changes.some(({ status, path }) => {
    if (path === "packages/cli/CHANGELOG.md" || (path.startsWith("packages/cli/") && /\.test\./.test(path))) return false;
    if (path === "packages/cli/package.json" && status === "M") {
      const before = JSON.parse(git("show", `${base}:${path}`)) as Record<string, unknown>;
      const after = JSON.parse(git("show", `HEAD:${path}`)) as Record<string, unknown>;
      delete before.version;
      delete after.version;
      if (isDeepStrictEqual(before, after)) return false;
    }
    return inputs.some((prefix) => path.startsWith(prefix)) || path === "apps/api/openapi.json";
  });
  if (!relevant) return;
  const changesets = changes.filter(({ status, path }) => status === "A" && /^\.changeset\/[^/]+\.md$/.test(path) && path !== ".changeset/README.md");
  const hasCliChangeset = changesets.some(({ path }) => {
    const content = git("show", `HEAD:${path}`);
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
    return frontmatter?.split(/\r?\n/).some((line) => /^\s*(?:["']vibecms-cli["']|vibecms-cli)\s*:\s*(?:patch|minor|major)\s*(?:#.*)?$/.test(line));
  });
  assert(hasCliChangeset, "CLI or its published inputs changed without a new vibecms-cli changeset");
});

await check("Feature counts", "Update the MCP tool and OpenAPI operation/path counts in docs/FEATURES.md.", async () => {
  // Load inside the check so a broken registry is reported without skipping other checks.
  const { operations } = await import("../packages/api-contract/src/operations.ts");
  const document = JSON.parse(read("apps/api/openapi.json")) as { paths: Record<string, Record<string, unknown>> };
  assert(document.paths && typeof document.paths === "object", "OpenAPI paths are missing");
  const paths = Object.values(document.paths);
  const count = paths.reduce((sum, path) => sum + ["get", "post", "put", "patch", "delete"].filter((method) => Object.hasOwn(path, method)).length, 0);
  const features = read("docs/FEATURES.md");
  const mcp = /MCP server at `POST \/mcp` with (\d+) tools\b/.exec(features);
  const rest = /REST API `\/api\/v1` with (\d+) OpenAPI operations across (\d+) paths\b/.exec(features);
  assert(mcp && rest, "MCP or REST count sentence is missing");
  assert(Number(mcp[1]) === operations.length, `MCP count is ${mcp[1]}; actual ${operations.length}`);
  assert(Number(rest[1]) === count && Number(rest[2]) === paths.length, `REST counts are ${rest[1]} operations / ${rest[2]} paths; actual ${count} / ${paths.length}`);
});

await check("Skill directory listings", "Update the skill listings in docs/FEATURES.md and connect-an-agent.mdx to match skills/.", () => {
  const names = readdirSync(join(root, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const path of ["docs/FEATURES.md", "apps/public/src/content/docs/getting-started/connect-an-agent.mdx"]) {
    const content = read(path);
    const missing = names.filter((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return !new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).test(content);
    });
    assert(missing.length === 0, `${path} is missing skill names: ${missing.join(", ")}`);
  }
});

if (failures) process.exitCode = 1;
