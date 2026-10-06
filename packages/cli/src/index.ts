import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_API_URL, resolveConfig, saveConfigFile, type ResolvedConfig } from "./config.js";
import { EXIT, exitCodeForStatus, fail, printData, setErrorFormat, type OutputFormat } from "./output.js";

// Mirrors PRESENTATION_LAYOUTS in @vc/config (private, so the published CLI
// cannot import it); index.test.mjs fails if the two drift.
export const PRESENTATION_LAYOUTS = ["standard", "essay", "feature", "wide"] as const;

const VERSION = "0.1.0";

const HELP = `vibecms - command-line client for the vibecms API (built for AI agents)

Usage: vibecms <command> [options]

Commands:
  login --token <tok> [--api-url <url>]    Save credentials to ~/.vibecms/config.json
  whoami                                    Verify the token (GET /site)
  site                                      Show the current site
  sites update --expected-updated-at <n> --data '<json>'   Change site fields (or --data-file)
  sites theme get                           Current look and allowed choices
  sites theme update --expected-updated-at <n> --data '<json>'  Change the look
  sites theme revert --expected-updated-at <n>  Undo the last theme change
  sites voice update --expected-updated-at <n> --data '<json>'  Save audience, tone, rules, exemplar posts
  sites signup-form get                     Current form and site updatedAt
  sites signup-form update --expected-updated-at <n> --data '<json>'  Change signup form fields
  tags list                                 Tags in use with post counts
  analytics get [--range 7|30|90|365|all] Aggregate paid-plan analytics
  activity [--limit <n> --offset <n>]       Changes by you and your agents
  posts list [--status --search --limit --offset]
  posts search <query> [--limit <n> --offset <n>]
  posts get <postId>
  posts get-by-slug <slug>
  posts create --title <t> --slug <s> (--content <md> | --content-file <path>) [post fields]
  posts update <postId> --expected-version <n> [--title --slug --content --content-file] [post fields]
  posts preview [<postId> | --content <md> | --content-file <path>] [--preset <id> --layout <l> --toc <bool>]
  posts format-guide [--preset <id>]         Markdown syntax this blog renders (callouts, code, TOC...)
  posts versions <postId>                   List versions (who changed what)
  posts version <postId> <versionNumber>    Show one version
  posts publish <postId> --expected-version <n>
  posts schedule <postId> --version-number <n> --at <ISO-8601 UTC time>  (--expected-version alias)
  posts unschedule <postId>
  posts rotate-preview <postId>              Revoke the old private preview link
  posts restore <postId> <versionNumber> --expected-version <n>
  posts archive <postId> [--expected-version <n>]
  posts unarchive <postId>

  Post fields: --excerpt <e> --tags a,b --cover <assetId|none> --layout ${PRESENTATION_LAYOUTS.join("|")}
               --toc true|false --seo-title <t> --seo-description <d> --canonical-url <url|none>
  assets list
  assets get <assetId>
  assets update <assetId> --alt <text>
  assets upload <file> [--alt <text>]
  assets delete <assetId>
  schema [operationId]                      Print the API operations as JSON (for agent introspection)

Global options:
  --api-url <url>   API base URL (default ${DEFAULT_API_URL})
  --token <tok>     Bearer token (vc_...)
  --json            Compact JSON to stdout
  --ndjson          Newline-delimited JSON for list output
  --dry-run         For mutations: print the request, send nothing, exit 0
  -h, --help        Show help for the selected command
  --version         Show version

Environment (precedence: flag > env var > ~/.vibecms/config.json > default):
  VIBECMS_API_URL   API base URL
  VIBECMS_TOKEN     Bearer token

Exit codes:
  0 ok   1 error   2 usage   3 auth (401/403)   4 not-found (404)   5 conflict (409)   6 rate-limit (429)
  With --json, errors are one {error:{code,message,details?,retryAfterSeconds?}} object on stderr.

publish, schedule, archive, and sites * changes affect the live site. Get the owner's explicit approval first.
`;

const OPTIONS = {
  "api-url": { type: "string" },
  token: { type: "string" },
  json: { type: "boolean" },
  ndjson: { type: "boolean" },
  "dry-run": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
  status: { type: "string" },
  search: { type: "string" },
  limit: { type: "string" },
  offset: { type: "string" },
  title: { type: "string" },
  slug: { type: "string" },
  excerpt: { type: "string" },
  content: { type: "string" },
  "content-file": { type: "string" },
  tags: { type: "string" },
  alt: { type: "string" },
  "expected-version": { type: "string" },
  "version-number": { type: "string" },
  "at": { type: "string" },
  cover: { type: "string" },
  layout: { type: "string" },
  toc: { type: "string" },
  "seo-title": { type: "string" },
  "seo-description": { type: "string" },
  "canonical-url": { type: "string" },
  preset: { type: "string" },
  data: { type: "string" },
  "data-file": { type: "string" },
  "expected-updated-at": { type: "string" },
  range: { type: "string" },
} as const;

type Values = { [K in keyof typeof OPTIONS]?: string | boolean };

const POST_FIELDS = ["excerpt", "tags", "cover", "layout", "toc", "seo-title", "seo-description", "canonical-url"];
const CONTENT = ["content", "content-file"];
const DATA = ["data", "data-file", "expected-updated-at"];
// Allowed values shown in per-command help; a test checks them against apps/api/openapi.json.
const VALUE_HINTS = {
  status: ["draft", "published", "archived"],
  template: ["minimal", "editorial", "technical (Notebook)", "product (Magazine)"],
  accent: ["teal", "blue", "indigo", "violet", "magenta", "crimson", "rust", "green", "graphite"],
  font: ["geist-sans (Geist)", "serif (Newsreader)", "grotesk (Space Grotesk)", "humanist (Hanken Grotesk)", "mono (Geist Mono)"],
  radius: ["none", "sm", "md", "lg"],
  width: ["narrow", "normal", "wide"],
  chrome: ["masthead", "centered", "sidebar"],
  index: ["list", "grid", "compact"],
  header: ["plain", "centered", "card"],
  mode: ["light", "dark", "system"],
  layout: ["standard", "essay", "feature", "wide"],
} as const;
const hint = (...keys: (keyof typeof VALUE_HINTS)[]) => keys.map((key) => `${key}: ${VALUE_HINTS[key].join(" | ")}`);

const COMMANDS: Record<string, { usage: string; flags?: string[]; fields?: Record<string, string>; revision?: string; values?: string[] }> = {
  login: { usage: "login --token <tok> [--api-url <url>]" },
  whoami: { usage: "whoami" }, site: { usage: "site" },
  activity: { usage: "activity [--limit <n> --offset <n>]", flags: ["limit", "offset"] },
  "sites update": { usage: "sites update --expected-updated-at <n> --data '<json>'", flags: DATA, revision: "--expected-updated-at: the updatedAt from `vibecms site`", fields: { name: "string", description: "string|null", bylineName: "string|null", showAgentCredit: "boolean", defaultSeoTitle: "string", defaultSeoDescription: "string|null", defaultSocialAssetId: "string|null", logoAssetId: "string|null", faviconAssetId: "string|null", navLinks: "array", socialLinks: "array" } },
  "sites theme get": { usage: "sites theme get" },
  "sites theme update": { usage: "sites theme update --expected-updated-at <n> --data '<json>'", flags: DATA, revision: "--expected-updated-at: the updatedAt from `vibecms site`", fields: { template: "string", keepLook: "boolean", accent: "string", font: "string", radius: "string|null", width: "string|null", chrome: "string|null", index: "string|null", header: "string|null", mode: "string" }, values: [...hint("template", "accent", "font", "radius", "width", "chrome", "index", "header", "mode"), "template and font also accept the display name (e.g. \"Magazine\", \"Newsreader\")"] },
  "sites theme revert": { usage: "sites theme revert --expected-updated-at <n>", flags: ["expected-updated-at"], revision: "--expected-updated-at: the updatedAt from `vibecms sites theme get`" },
  "sites voice update": { usage: "sites voice update --expected-updated-at <n> --data '<json>'", flags: DATA, revision: "--expected-updated-at: the voiceProfile.revision from `vibecms site` (0 if unconfigured)", fields: { audience: "string", tone: "string", doRules: "array", dontRules: "array", representativePostIds: "array" } },
  "sites signup-form get": { usage: "sites signup-form get" },
  "sites signup-form update": { usage: "sites signup-form update --expected-updated-at <n> --data '<json>'", flags: DATA, revision: "--expected-updated-at: the updatedAt from `vibecms sites signup-form get` or `vibecms site`", fields: { enabled: "boolean", heading: "string", description: "string", button: "string" } },
  "tags list": { usage: "tags list" },
  "analytics get": { usage: "analytics get [--range 7|30|90|365|all]", flags: ["range"] },
  "posts list": { usage: "posts list [--status --search --limit --offset]", flags: ["status", "search", "limit", "offset"], values: hint("status") },
  "posts search": { usage: "posts search <query> [--status --limit --offset]", flags: ["search", "status", "limit", "offset"], values: hint("status") },
  "posts get": { usage: "posts get <postId>" }, "posts get-by-slug": { usage: "posts get-by-slug <slug>" },
  "posts create": { usage: "posts create --title <t> --slug <s> (--content <md> | --content-file <path>) [post fields]", flags: ["title", "slug", ...CONTENT, ...POST_FIELDS] },
  "posts update": { usage: "posts update <postId> --expected-version <n> [--title --slug --content --content-file] [post fields]", flags: ["expected-version", "title", "slug", ...CONTENT, ...POST_FIELDS], revision: "--expected-version: currentVersionNumber from `vibecms posts get <postId>`" },
  "posts preview": { usage: "posts preview [<postId> | --content <md> | --content-file <path>] [--preset --layout --toc]", flags: [...CONTENT, "preset", "layout", "toc"], values: [...hint("layout"), "preset: minimal | editorial | technical | product"] },
  "posts format-guide": { usage: "posts format-guide [--preset <id>]", flags: ["preset"] },
  "posts versions": { usage: "posts versions <postId>" }, "posts version": { usage: "posts version <postId> <versionNumber>" },
  "posts publish": { usage: "posts publish <postId> --expected-version <n>", flags: ["expected-version"], revision: "--expected-version: approved currentVersionNumber from `vibecms posts get <postId>`" },
  "posts schedule": { usage: "posts schedule <postId> --version-number <n> --at <ISO-8601 UTC>", flags: ["version-number", "expected-version", "at"], revision: "--version-number: approved saved version from `vibecms posts versions <postId>`; --expected-version is an alias" },
  "posts unschedule": { usage: "posts unschedule <postId>" }, "posts rotate-preview": { usage: "posts rotate-preview <postId>" },
  "posts restore": { usage: "posts restore <postId> <versionNumber> --expected-version <n>", flags: ["expected-version"] },
  "posts archive": { usage: "posts archive <postId> [--expected-version <n>]", flags: ["expected-version"], revision: "--expected-version: approved currentVersionNumber from `vibecms posts get <postId>`. Archiving saves a new version; use the returned currentVersionNumber next." },
  "posts unarchive": { usage: "posts unarchive <postId>" },
  "assets list": { usage: "assets list" }, "assets get": { usage: "assets get <assetId>" },
  "assets update": { usage: "assets update <assetId> --alt <text>", flags: ["alt"] },
  "assets upload": { usage: "assets upload <file> [--alt <text>]", flags: ["alt"] },
  "assets delete": { usage: "assets delete <assetId>" },
  schema: { usage: "schema [operationId]" },
};
const GLOBAL_FLAGS = new Set(["api-url", "token", "json", "ndjson", "dry-run", "help", "version"]);

function commandKey(pos: string[]): string | undefined {
  return Object.keys(COMMANDS).sort((a, b) => b.length - a.length).find((key) => {
    const parts = key.split(" ");
    return parts.every((part, index) => pos[index] === part);
  });
}

function commandHelp(key: string): string {
  const cmd = COMMANDS[key];
  return `Usage: vibecms ${cmd.usage}\nFlags: ${(cmd.flags ?? []).map((flag) => `--${flag}`).join(", ") || "none"}\nGlobal flags: --api-url --token --json --ndjson --dry-run --help\n${cmd.fields ? `--data fields: ${Object.entries(cmd.fields).map(([name, type]) => `${name} (${type})`).join(", ")}\n` : ""}${cmd.revision ? `${cmd.revision}\n` : ""}${cmd.values?.length ? `Values:\n${cmd.values.map((line) => `  ${line}`).join("\n")}\n` : ""}`;
}

type ApiResult = { res: Response; json: unknown };

async function apiRequest(
  cfg: ResolvedConfig,
  method: string,
  path: string,
  opts: { query?: Record<string, unknown>; body?: unknown } = {},
): Promise<ApiResult> {
  const url = new URL(cfg.apiUrl + path);
  if (opts.query) {
    for (const [k, val] of Object.entries(opts.query)) {
      if (val !== undefined && val !== null) url.searchParams.set(k, String(val));
    }
  }
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    return { res, json };
  } catch (err) {
    fail({ error: { code: "NETWORK", message: `Cannot reach ${cfg.apiUrl}: ${(err as Error).message}` } }, EXIT.OTHER);
  }
}

function emit(result: ApiResult, fmt: OutputFormat): void {
  if (!result.res.ok) {
    fail(result.json ?? { error: { code: "HTTP", message: `HTTP ${result.res.status}` } }, exitCodeForStatus(result.res.status));
  }
  printData(result.json, fmt);
}

function need(value: string | undefined, name: string): string {
  if (!value) fail(`Missing required option: ${name}`, EXIT.USAGE);
  return value;
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function splitTags(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  const tags = v.split(",").map((t) => t.trim()).filter(Boolean);
  return tags;
}

function dropUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined));
}

async function readContent(v: Values, required: boolean): Promise<string | undefined> {
  const file = str(v["content-file"]);
  if (file) return readFile(file, "utf8");
  const inline = str(v.content);
  if (inline !== undefined) return inline;
  if (required) need(undefined, "--content or --content-file");
  return undefined;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function mutate(
  cfg: ResolvedConfig,
  method: string,
  path: string,
  body: unknown,
  v: Values,
  fmt: OutputFormat,
): Promise<void> {
  if (v["dry-run"]) {
    printData({ dryRun: true, method, url: cfg.apiUrl + path, body: body ?? null }, fmt);
    return;
  }
  const result = await apiRequest(cfg, method, path, { body });
  if (method === 'DELETE' && result.res.status === 409 && !result.json) {
    fail({ error: { code: 'CONFLICT', message: 'Asset is in use as a post cover or site social image and cannot be deleted.' } }, EXIT.CONFLICT);
  }
  emit(result, fmt);
}

async function readRequest(cfg: ResolvedConfig, path: string, v: Values, fmt: OutputFormat, query?: Record<string, unknown>) {
  const url = new URL(cfg.apiUrl + path)
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value))
  if (v['dry-run']) return printData({ dryRun: true, method: 'GET', url: url.toString(), body: null }, fmt)
  return emit(await apiRequest(cfg, 'GET', path, { query }), fmt)
}


/** "none" clears a nullable field; undefined leaves it unchanged. */
function nullable(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v === "none" ? null : v;
}

function presentation(v: Values): { layout?: string; toc?: boolean } | undefined {
  const layout = str(v.layout);
  const tocRaw = str(v.toc);
  if (layout !== undefined && !PRESENTATION_LAYOUTS.includes(layout as (typeof PRESENTATION_LAYOUTS)[number])) {
    fail(`--layout must be ${PRESENTATION_LAYOUTS.join(", ")}`, EXIT.USAGE);
  }
  if (tocRaw !== undefined && tocRaw !== "true" && tocRaw !== "false") fail("--toc must be true or false", EXIT.USAGE);
  if (layout === undefined && tocRaw === undefined) return undefined;
  return dropUndefined({ layout, toc: tocRaw === undefined ? undefined : tocRaw === "true" }) as { layout?: string; toc?: boolean };
}

function postFields(v: Values): Record<string, unknown> {
  return {
    excerpt: str(v.excerpt),
    tags: splitTags(str(v.tags)),
    coverAssetId: nullable(str(v.cover)),
    canonicalUrl: nullable(str(v["canonical-url"])),
    seoTitle: str(v["seo-title"]),
    seoDescription: str(v["seo-description"]),
    presentation: presentation(v),
  };
}

function versionArg(raw: string | undefined): number {
  const n = Number(need(raw, "<versionNumber>"));
  if (!Number.isInteger(n) || n < 1) fail("<versionNumber> must be a positive integer", EXIT.USAGE);
  return n;
}

function parseExpectedVersion(v: Values, required: boolean): number | undefined {
  const raw = str(v["expected-version"]);
  if (raw === undefined) {
    if (required) need(undefined, "--expected-version");
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) fail("--expected-version must be a positive integer", EXIT.USAGE);
  return n;
}

function expectedUpdatedAt(v: Values, allowZero = false): number {
  const value = Number(need(str(v['expected-updated-at']), '--expected-updated-at (see `vibecms site` for the current revision)'));
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) fail('--expected-updated-at must be a non-negative integer from `vibecms site`', EXIT.USAGE);
  return value;
}

async function jsonData(v: Values): Promise<Record<string, unknown>> {
  const inline = str(v.data);
  const file = str(v['data-file']);
  if (Boolean(inline) === Boolean(file)) fail('Provide exactly one of --data or --data-file', EXIT.USAGE);
  let value: unknown;
  try { value = JSON.parse(inline ?? await readFile(file!, 'utf8')); }
  catch { fail('Data must be valid JSON', EXIT.USAGE); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Data must be a JSON object', EXIT.USAGE);
  return value as Record<string, unknown>;
}

async function sitesCommand(action: string | undefined, rest: string[], v: Values, cfg: ResolvedConfig, fmt: OutputFormat) {
  if (action === 'update') return mutate(cfg, 'PATCH', '/api/v1/site',
    { ...await jsonData(v), expectedUpdatedAt: expectedUpdatedAt(v) }, v, fmt);
  if (action === 'theme') {
    if (rest[0] === 'get') return readRequest(cfg, '/api/v1/site/theme', v, fmt);
    if (rest[0] === 'update') return mutate(cfg, 'PATCH', '/api/v1/site/theme',
      { ...await jsonData(v), expectedUpdatedAt: expectedUpdatedAt(v) }, v, fmt);
    if (rest[0] === 'revert') return mutate(cfg, 'POST', '/api/v1/site/theme/revert',
      { expectedUpdatedAt: expectedUpdatedAt(v) }, v, fmt);
  }
  if (action === 'voice' && rest[0] === 'update')
    return mutate(cfg, 'PUT', '/api/v1/site/voice', { ...await jsonData(v), expectedUpdatedAt: expectedUpdatedAt(v, true) }, v, fmt);
  if (action === 'signup-form' && rest[0] === 'get') {
    if (v['dry-run']) return readRequest(cfg, '/api/v1/site', v, fmt);
    const result = await apiRequest(cfg, 'GET', '/api/v1/site');
    if (!result.res.ok) return emit(result, fmt);
    const site = result.json as { signupForm?: unknown; updatedAt?: unknown };
    return printData({ signupForm: site.signupForm, updatedAt: site.updatedAt }, fmt);
  }
  if (action === 'signup-form' && rest[0] === 'update')
    return mutate(cfg, 'PATCH', '/api/v1/site/signup-form',
      { ...await jsonData(v), expectedUpdatedAt: expectedUpdatedAt(v) }, v, fmt);
  fail(`Unknown sites subcommand: ${[action, ...rest].join(' ')}`, EXIT.USAGE);
}

async function postsCommand(
  action: string | undefined,
  rest: string[],
  v: Values,
  cfg: ResolvedConfig,
  fmt: OutputFormat,
): Promise<void> {
  switch (action) {
    case "list":
      return emit(
        await apiRequest(cfg, "GET", "/api/v1/posts", {
          query: { status: str(v.status), search: str(v.search), limit: str(v.limit), offset: str(v.offset) },
        }),
        fmt,
      );
    case "search":
      return emit(
        await apiRequest(cfg, "GET", "/api/v1/posts", {
          query: { search: need(rest.join(" ") || str(v.search), "<query>"), status: str(v.status), limit: str(v.limit), offset: str(v.offset) },
        }),
        fmt,
      );
    case "preview":
      return mutate(cfg, "POST", "/api/v1/posts/preview", dropUndefined({
        contentMarkdown: await readContent(v, !rest[0]),
        postId: rest[0],
        presetId: str(v.preset),
        presentation: presentation(v),
      }), v, fmt);
    case "format-guide":
      return emit(await apiRequest(cfg, "GET", "/api/v1/posts/format-guide", { query: { presetId: str(v.preset) } }), fmt);
    case "versions":
      return emit(await apiRequest(cfg, "GET", `/api/v1/posts/${encodeURIComponent(need(rest[0], "<postId>"))}/versions`), fmt);
    case "version":
      return emit(
        await apiRequest(
          cfg,
          "GET",
          `/api/v1/posts/${encodeURIComponent(need(rest[0], "<postId>"))}/versions/${versionArg(rest[1])}`,
        ),
        fmt,
      );
    case "get":
      return emit(await apiRequest(cfg, "GET", `/api/v1/posts/${encodeURIComponent(need(rest[0], "<postId>"))}`), fmt);
    case "get-by-slug":
      return emit(await apiRequest(cfg, "GET", `/api/v1/posts/by-slug/${encodeURIComponent(need(rest[0], "<slug>"))}`), fmt);
    case "create":
      return mutate(
        cfg,
        "POST",
        "/api/v1/posts",
        dropUndefined({
          title: need(str(v.title), "--title"),
          slug: need(str(v.slug), "--slug"),
          contentMarkdown: await readContent(v, true),
          ...postFields(v),
        }),
        v,
        fmt,
      );
    case "update": {
      const id = need(rest[0], "<postId>");
      return mutate(
        cfg,
        "PATCH",
        `/api/v1/posts/${encodeURIComponent(id)}`,
        dropUndefined({
          expectedVersionNumber: parseExpectedVersion(v, true),
          title: str(v.title),
          slug: str(v.slug),
          contentMarkdown: await readContent(v, false),
          ...postFields(v),
        }),
        v,
        fmt,
      );
    }
    case "publish": {
      const id = need(rest[0], "<postId>");
      const expectedVersionNumber = parseExpectedVersion(v, true);
      return mutate(
        cfg,
        "POST",
        `/api/v1/posts/${encodeURIComponent(id)}/publish`,
        { expectedVersionNumber },
        v,
        fmt,
      );
    }
    case "schedule": {
      const id = need(rest[0], "<postId>");
      if (v['version-number'] !== undefined && v['expected-version'] !== undefined) fail('Use either --version-number or --expected-version, not both', EXIT.USAGE);
      const versionNumber = versionArg(str(v['version-number']) ?? str(v['expected-version']));
      const at = need(str(v.at), "--at");
      const parsed = Date.parse(at);
      if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(at) || !Number.isFinite(parsed)) {
        fail("--at must be an ISO-8601 UTC time ending in Z", EXIT.USAGE);
      }
      return mutate(cfg, "POST", `/api/v1/posts/${encodeURIComponent(id)}/schedule`,
        { versionNumber, publishAt: at }, v, fmt);
    }
    case "unschedule":
      return mutate(cfg, "POST", `/api/v1/posts/${encodeURIComponent(need(rest[0], "<postId>"))}/unschedule`, undefined, v, fmt);
    case "rotate-preview":
      return mutate(cfg, "POST", `/api/v1/posts/${encodeURIComponent(need(rest[0], "<postId>"))}/preview/rotate`, undefined, v, fmt);
    case "restore": {
      const id = need(rest[0], "<postId>");
      const versionRaw = need(rest[1], "<versionNumber>");
      const versionNumber = Number(versionRaw);
      if (!Number.isInteger(versionNumber) || versionNumber < 1) {
        fail("<versionNumber> must be a positive integer", EXIT.USAGE);
      }
      return mutate(
        cfg,
        "POST",
        `/api/v1/posts/${encodeURIComponent(id)}/versions/${versionNumber}/restore`,
        { expectedVersionNumber: parseExpectedVersion(v, true) },
        v,
        fmt,
      );
    }
    case "archive":
      return mutate(cfg, "POST", `/api/v1/posts/${encodeURIComponent(need(rest[0], "<postId>"))}/archive`,
        dropUndefined({ expectedVersionNumber: parseExpectedVersion(v, false) }), v, fmt);
    case "unarchive":
      return mutate(cfg, "POST", `/api/v1/posts/${encodeURIComponent(need(rest[0], "<postId>"))}/unarchive`, undefined, v, fmt);
    default:
      fail(`Unknown posts subcommand: ${action ?? "(none)"}. Run 'vibecms --help'.`, EXIT.USAGE);
  }
}

async function assetsCommand(
  action: string | undefined,
  rest: string[],
  v: Values,
  cfg: ResolvedConfig,
  fmt: OutputFormat,
): Promise<void> {
  switch (action) {
    case "list":
      return emit(await apiRequest(cfg, "GET", "/api/v1/assets"), fmt);
    case "get":
      return emit(await apiRequest(cfg, "GET", `/api/v1/assets/${encodeURIComponent(need(rest[0], "<assetId>"))}`), fmt);
    case "update":
      return mutate(cfg, "PATCH", `/api/v1/assets/${encodeURIComponent(need(rest[0], "<assetId>"))}`, { altText: need(str(v.alt), "--alt") }, v, fmt);
    case "upload": {
      const file = need(rest[0], "<file>");
      const mimeType = MIME[extname(file).toLowerCase()];
      if (!mimeType) fail(`Unsupported image type: ${extname(file)} (png, jpg, webp, gif)`, EXIT.USAGE);
      const data = await readFile(file);
      return mutate(
        cfg,
        "POST",
        "/api/v1/assets",
        dropUndefined({ filename: basename(file), mimeType, dataBase64: data.toString("base64"), altText: str(v.alt) }),
        v,
        fmt,
      );
    }
    case "delete": {
      const assetId = need(rest[0], "<assetId>");
      return mutate(cfg, "DELETE", `/api/v1/assets/${encodeURIComponent(assetId)}`, undefined, v, fmt);
    }
    default:
      fail(`Unknown assets subcommand: ${action ?? "(none)"}. Run 'vibecms --help'.`, EXIT.USAGE);
  }
}

async function schemaCommand(operationId: string | undefined, cfg: ResolvedConfig, fmt: OutputFormat): Promise<void> {
  const specPath = fileURLToPath(new URL("./openapi.json", import.meta.url));
  let remote: unknown;
  try {
    const headers: Record<string, string> = cfg.token ? { authorization: `Bearer ${cfg.token}` } : {};
    const res = await fetch(`${cfg.apiUrl}/api/v1/openapi.json`, { headers });
    if (res.ok) remote = await res.json();
  } catch { /* The bundled schema is available offline in the published CLI. */ }
  let bundled: unknown;
  if (!remote || typeof remote !== "object" || !("paths" in remote)) {
    try { bundled = JSON.parse(await readFile(specPath, "utf8")); }
    catch { fail(`API schema unavailable from ${cfg.apiUrl}/api/v1/openapi.json and no bundled openapi.json was found`, EXIT.OTHER); }
  }
  const spec = (bundled ?? remote) as {
    security?: unknown;
    paths?: Record<string, Record<string, Record<string, unknown>>>;
  };
  const ops: Array<Record<string, unknown>> = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      ops.push({
        operationId: op.operationId,
        method: method.toUpperCase(),
        path,
        summary: op.summary,
        description: op.description,
        security: op.security ?? spec.security,
        parameters: op.parameters,
        requestBody: op.requestBody,
        responses: operationId ? op.responses : Object.keys((op.responses as Record<string, unknown>) ?? {}),
      });
    }
  }
  if (operationId) {
    const operation = ops.find((op) => op.operationId === operationId);
    if (!operation) fail(`Unknown operationId: ${operationId}`, EXIT.USAGE);
    return printData(operation, fmt);
  }
  printData(ops, fmt);
}

async function main(): Promise<void> {
  setErrorFormat(process.argv.slice(2).includes('--json'));
  let parsed: { values: Values; positionals: string[] };
  try {
    const args = process.argv.slice(2);
    parsed = parseArgs({ args, allowPositionals: true, strict: true, options: OPTIONS }) as {
      values: Values;
      positionals: string[];
    };
  } catch (err) {
    fail((err as Error).message, EXIT.USAGE);
  }
  const v = parsed.values;
  const pos = parsed.positionals;

  if (v.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (pos.length === 0) {
    process.stdout.write(HELP);
    return;
  }

  const helpPos = pos[0] === 'help' ? pos.slice(1) : pos;
  const key = commandKey(helpPos);
  if (v.help || pos[0] === 'help') {
    if (!key) fail(`Unknown command: ${helpPos.join(' ')}`, EXIT.USAGE);
    process.stdout.write(commandHelp(key));
    return;
  }
  if (!key) fail(`Unknown command: ${pos.join(' ')}`, EXIT.USAGE);
  for (const flag of Object.keys(v)) {
    if (!GLOBAL_FLAGS.has(flag) && !COMMANDS[key].flags?.includes(flag)) fail(`Unsupported flag --${flag} for ${key}`, EXIT.USAGE);
  }

  const fmt: OutputFormat = { json: Boolean(v.json), ndjson: Boolean(v.ndjson) };
  const cfg = resolveConfig({ apiUrl: str(v["api-url"]), token: str(v.token) });
  const [group, action] = pos;

  switch (group) {
    case "login": {
      const token = need(str(v.token), "--token");
      const saved = saveConfigFile({ apiUrl: str(v["api-url"]) ?? cfg.apiUrl, token });
      printData({ saved, apiUrl: cfg.apiUrl }, fmt);
      return;
    }
    case "whoami":
    case "site":
      return emit(await apiRequest(cfg, "GET", "/api/v1/site"), fmt);
    case "activity":
      return emit(await apiRequest(cfg, "GET", "/api/v1/activity", { query: { limit: str(v.limit), offset: str(v.offset) } }), fmt);
    case 'sites':
      return sitesCommand(action, pos.slice(2), v, cfg, fmt);
    case 'tags':
      if (action !== 'list') fail('Use tags list', EXIT.USAGE);
      return readRequest(cfg, '/api/v1/tags', v, fmt);
    case 'analytics':
      if (action !== 'get') fail('Use analytics get', EXIT.USAGE);
      return readRequest(cfg, '/api/v1/analytics', v, fmt, { range: str(v.range) });
    case "schema":
      return schemaCommand(action, cfg, fmt);
    case "posts":
      return postsCommand(action, pos.slice(2), v, cfg, fmt);
    case "assets":
      return assetsCommand(action, pos.slice(2), v, cfg, fmt);
    default:
      fail(`Unknown command: ${group}. Run 'vibecms --help'.`, EXIT.USAGE);
  }
}

main().catch((err) => fail((err as Error).message ?? String(err), EXIT.OTHER));
