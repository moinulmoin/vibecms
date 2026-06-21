import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_API_URL, resolveConfig, saveConfigFile, type ResolvedConfig } from "./config.js";
import { EXIT, exitCodeForStatus, fail, printData, type OutputFormat } from "./output.js";

const VERSION = "0.1.0";

const HELP = `vibecms - command-line client for the VibeCMS API (built for AI agents)

Usage: vibecms <command> [options]

Commands:
  login --token <tok> [--api-url <url>]    Save credentials to ~/.vibecms/config.json
  whoami                                    Verify the token (GET /site)
  site                                      Show the current site
  posts list [--status --search --limit --offset]
  posts get <postId>
  posts create --title <t> --slug <s> (--content <md> | --content-file <path>) [--excerpt <e> --tags a,b]
  posts update <postId> [--title --slug --content --content-file --excerpt --tags]
  posts publish <postId>
  posts archive <postId>
  assets list
  assets get <assetId>
  assets upload <file> [--alt <text>]
  assets delete <assetId>
  schema [operationId]                      Print the API operations as JSON (for agent introspection)

Global options:
  --api-url <url>   API base URL (default ${DEFAULT_API_URL})
  --token <tok>     Bearer token (vc_...)
  --json            Compact JSON to stdout
  --ndjson          Newline-delimited JSON for list output
  --dry-run         For mutations: print the request, send nothing, exit 0
  -h, --help        Show this help
  --version         Show version

Environment (precedence: flag > env var > ~/.vibecms/config.json > default):
  VIBECMS_API_URL   API base URL
  VIBECMS_TOKEN     Bearer token

Exit codes:
  0 ok   1 error   2 usage   3 auth (401/403)   4 not-found (404)   5 conflict (409)   6 rate-limit (429)
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
} as const;

type Values = { [K in keyof typeof OPTIONS]?: string | boolean };

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
  if (!v) return undefined;
  const tags = v.split(",").map((t) => t.trim()).filter(Boolean);
  return tags.length ? tags : undefined;
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
  emit(await apiRequest(cfg, method, path, { body }), fmt);
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
    case "get":
      return emit(await apiRequest(cfg, "GET", `/api/v1/posts/${encodeURIComponent(need(rest[0], "<postId>"))}`), fmt);
    case "create":
      return mutate(
        cfg,
        "POST",
        "/api/v1/posts",
        dropUndefined({
          title: need(str(v.title), "--title"),
          slug: need(str(v.slug), "--slug"),
          contentMarkdown: await readContent(v, true),
          excerpt: str(v.excerpt),
          tags: splitTags(str(v.tags)),
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
          title: str(v.title),
          slug: str(v.slug),
          contentMarkdown: await readContent(v, false),
          excerpt: str(v.excerpt),
          tags: splitTags(str(v.tags)),
        }),
        v,
        fmt,
      );
    }
    case "publish":
      return mutate(cfg, "POST", `/api/v1/posts/${encodeURIComponent(need(rest[0], "<postId>"))}/publish`, undefined, v, fmt);
    case "archive":
      return mutate(cfg, "POST", `/api/v1/posts/${encodeURIComponent(need(rest[0], "<postId>"))}/archive`, undefined, v, fmt);
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
      const result = await apiRequest(cfg, "DELETE", `/api/v1/assets/${encodeURIComponent(assetId)}`);
      if (result.res.status === 409) {
        fail(
          result.json ?? { error: { code: "CONFLICT", message: "Asset is in use as a post cover image and cannot be deleted." } },
          EXIT.CONFLICT,
        );
      }
      return emit(result, fmt);
    }
    default:
      fail(`Unknown assets subcommand: ${action ?? "(none)"}. Run 'vibecms --help'.`, EXIT.USAGE);
  }
}

async function schemaCommand(operationId: string | undefined, fmt: OutputFormat): Promise<void> {
  const specPath = fileURLToPath(new URL("./openapi.json", import.meta.url));
  const spec = JSON.parse(await readFile(specPath, "utf8")) as {
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
        responses: Object.keys((op.responses as Record<string, unknown>) ?? {}),
      });
    }
  }
  printData(operationId ? ops.filter((o) => o.operationId === operationId) : ops, fmt);
}

async function main(): Promise<void> {
  let parsed: { values: Values; positionals: string[] };
  try {
    parsed = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true, options: OPTIONS }) as {
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
  if (v.help || pos.length === 0) {
    process.stdout.write(HELP);
    return;
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
      return emit(await apiRequest(cfg, "GET", "/api/v1/activity", { query: { limit: str(v.limit) } }), fmt);
    case "schema":
      return schemaCommand(action, fmt);
    case "posts":
      return postsCommand(action, pos.slice(2), v, cfg, fmt);
    case "assets":
      return assetsCommand(action, pos.slice(2), v, cfg, fmt);
    default:
      fail(`Unknown command: ${group}. Run 'vibecms --help'.`, EXIT.USAGE);
  }
}

main().catch((err) => fail((err as Error).message ?? String(err), EXIT.OTHER));
