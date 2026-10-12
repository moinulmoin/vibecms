/**
 * Shared agent classification (plans/023): one table both workers use.
 *
 * The public Worker writes an `agent_fetch` Analytics Engine point when a
 * request is clearly not a person — the UA matches this table, the client
 * asked for the Markdown representation, the path is an agent surface
 * (llms/feed/sitemap/robots), or a `Signature-Agent` header is present. The
 * API Worker aggregates the same table for rollups and referrer labelling.
 * Order matters: named entries precede the generic `other-bot` fallback, and
 * `Applebot-Extended` precedes `Applebot` (its UA contains both tokens).
 */
export type AgentCategory =
  | "ai-assistant"
  | "ai-search"
  | "ai-training"
  | "search-engine"
  | "other-bot"
  | "unknown-agent";

export type AgentEntry = {
  /** Stable id stored in `agent_fetch` blob4 and `agent` rollup dimensions. */
  id: string;
  /** Human-readable name shown in analytics UIs. */
  label: string;
  operator: string;
  category: AgentCategory;
  /** Regex source matched case-insensitively against the User-Agent string. */
  match: string;
};

export const AGENT_CATEGORY_LABELS: Record<AgentCategory, string> = {
  "ai-assistant": "AI assistant",
  "ai-search": "AI search",
  "ai-training": "AI crawler",
  "search-engine": "Search engine",
  "other-bot": "Other bot",
  "unknown-agent": "Unknown agent",
};

/** agentId used when signals (Markdown/llms/feed/signature) fire but no UA matches. */
export const UNKNOWN_AGENT_ID = "unknown";

export const AI_AGENTS: readonly AgentEntry[] = [
  // Assistants fetching on behalf of a person right now.
  { id: "ChatGPT-User", label: "ChatGPT", operator: "OpenAI", category: "ai-assistant", match: "ChatGPT-User" },
  { id: "Claude-User", label: "Claude", operator: "Anthropic", category: "ai-assistant", match: "Claude-User" },
  { id: "Perplexity-User", label: "Perplexity", operator: "Perplexity", category: "ai-assistant", match: "Perplexity-User" },
  { id: "MistralAI-User", label: "Le Chat", operator: "Mistral", category: "ai-assistant", match: "MistralAI-User" },
  { id: "DuckAssistBot", label: "DuckAssist", operator: "DuckDuckGo", category: "ai-assistant", match: "DuckAssistBot" },
  { id: "meta-externalfetcher", label: "Meta External Fetcher", operator: "Meta", category: "ai-assistant", match: "meta-externalfetcher" },
  // AI search indexes.
  { id: "OAI-SearchBot", label: "OpenAI Search", operator: "OpenAI", category: "ai-search", match: "OAI-SearchBot" },
  { id: "Claude-SearchBot", label: "Claude Search", operator: "Anthropic", category: "ai-search", match: "Claude-SearchBot" },
  { id: "PerplexityBot", label: "Perplexity", operator: "Perplexity", category: "ai-search", match: "PerplexityBot" },
  // Training/corpus crawlers.
  { id: "GPTBot", label: "GPTBot", operator: "OpenAI", category: "ai-training", match: "GPTBot" },
  { id: "ClaudeBot", label: "ClaudeBot", operator: "Anthropic", category: "ai-training", match: "ClaudeBot" },
  { id: "CCBot", label: "Common Crawl", operator: "Common Crawl", category: "ai-training", match: "CCBot" },
  { id: "Bytespider", label: "Bytespider", operator: "ByteDance", category: "ai-training", match: "Bytespider" },
  { id: "meta-externalagent", label: "Meta External Agent", operator: "Meta", category: "ai-training", match: "meta-externalagent" },
  { id: "FacebookBot", label: "FacebookBot", operator: "Meta", category: "ai-training", match: "FacebookBot" },
  { id: "Google-CloudVertexBot", label: "Vertex AI", operator: "Google", category: "ai-training", match: "Google-CloudVertexBot" },
  { id: "Amazonbot", label: "Amazonbot", operator: "Amazon", category: "ai-training", match: "Amazonbot" },
  // Order: the Extended UA also contains "Applebot", so it must match first.
  { id: "Applebot-Extended", label: "Applebot Extended", operator: "Apple", category: "ai-training", match: "Applebot-Extended" },
  // Classic search engines.
  { id: "Googlebot", label: "Googlebot", operator: "Google", category: "search-engine", match: "Googlebot" },
  { id: "Bingbot", label: "Bingbot", operator: "Microsoft", category: "search-engine", match: "bingbot" },
  { id: "Applebot", label: "Applebot", operator: "Apple", category: "search-engine", match: "Applebot" },
  { id: "DuckDuckBot", label: "DuckDuckBot", operator: "DuckDuckGo", category: "search-engine", match: "DuckDuckBot" },
  { id: "YandexBot", label: "YandexBot", operator: "Yandex", category: "search-engine", match: "YandexBot" },
  { id: "Baiduspider", label: "Baiduspider", operator: "Baidu", category: "search-engine", match: "Baiduspider" },
  // Generic HTTP clients and catch-all bot tokens (last: named entries win).
  { id: "curl", label: "curl", operator: "curl", category: "other-bot", match: "curl/" },
  { id: "python-requests", label: "python-requests", operator: "Python", category: "other-bot", match: "python-requests" },
  { id: "go-http-client", label: "Go HTTP Client", operator: "Go", category: "other-bot", match: "Go-http-client" },
  { id: "generic-bot", label: "Bot", operator: "Unknown", category: "other-bot", match: "bot|crawler|spider|fetch" },
];

const COMPILED_AGENTS: ReadonlyArray<{ entry: AgentEntry; pattern: RegExp }> = AI_AGENTS.map(
  (entry) => ({ entry, pattern: new RegExp(entry.match, "i") }),
);
/** First matching table entry, or null for ordinary browsers and unknown UAs. */
export function agentForUserAgent(userAgent: string | null | undefined): AgentEntry | null {
  if (!userAgent) return null;
  for (const { entry, pattern } of COMPILED_AGENTS) {
    if (pattern.test(userAgent)) return entry;
  }
  return null;
}

export const AI_REFERRERS = [
  { operator: "OpenAI", domains: ["openai.com", "chatgpt.com"] },
  { operator: "Anthropic", domains: ["anthropic.com", "claude.ai"] },
  { operator: "Perplexity", domains: ["perplexity.ai"] },
  { operator: "Google", domains: ["google.com", "youtube.com"] },
  { operator: "Microsoft", domains: ["bing.com", "msn.com", "microsoft.com"] },
  { operator: "Meta", domains: ["facebook.com", "instagram.com", "whatsapp.com", "meta.com"] },
  { operator: "DuckDuckGo", domains: ["duckduckgo.com", "duck.com"] },
  { operator: "ByteDance", domains: ["bytedance.com", "tiktok.com"] },
  { operator: "Apple", domains: ["apple.com", "icloud.com"] },
  { operator: "Amazon", domains: ["amazon.com", "alexa.com"] },
] as const;

/** Exact or sub-domain match against the AI referrer table. */
export function aiReferrer(domain: string): { ai: boolean; operator: string | null } {
  const normalized = domain.toLowerCase();
  for (const entry of AI_REFERRERS) {
    if (entry.domains.some((candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`))) {
      return { ai: true, operator: entry.operator };
    }
  }
  return { ai: false, operator: null };
}
