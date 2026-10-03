import { Bot, Check, Lock, Minus } from "./icons";

export type KeyLevel = "draft" | "publish" | "manage";

// Mirrors AGENT_TOKEN_PRESETS in packages/core (a test keeps them in sync).
export const KEY_LEVELS: { id: KeyLevel; label: string; short: string; note: string; scopes: string[] }[] = [
  {
    id: "draft",
    label: "Write drafts",
    short: "Drafts",
    note: "The default. Your agent writes; you publish.",
    scopes: ["sites:read", "posts:read", "posts:create", "posts:update", "assets:write", "activity:read"],
  },
  {
    id: "publish",
    label: "Write and publish",
    short: "Publish",
    note: "For the agent you trust to ship after you say yes.",
    scopes: ["sites:read", "posts:read", "posts:create", "posts:update", "posts:publish", "assets:write", "activity:read"],
  },
  {
    id: "manage",
    label: "Manage",
    short: "Manage",
    note: "Your agent runs the blog. You keep the account.",
    scopes: [
      "sites:read", "posts:read", "posts:create", "posts:update", "posts:publish", "posts:archive",
      "assets:write", "activity:read", "site:write", "analytics:read",
    ],
  },
];

export const CAPABILITIES: { label: string; min: KeyLevel }[] = [
  { label: "Write and edit drafts, upload images", min: "draft" },
  { label: "Send you private preview links", min: "draft" },
  { label: "Publish and schedule posts", min: "publish" },
  { label: "Change the theme, settings, links, and voice", min: "manage" },
  { label: "Read analytics", min: "manage" },
];

export const DEFAULT_LEVEL: KeyLevel = "draft";

/** Level picker; marketing-interactions.js switches data-level. States are CSS-driven (landing.css). */
export function KeyLevelsDemo() {
  return (
    <div data-key-demo data-level={DEFAULT_LEVEL}>
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-foreground/[0.06] text-foreground/80">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">blog-writer</div>
            <div className="font-mono text-[11px] text-muted-foreground">last used 2 min ago</div>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-brand-bright">
          <span className="size-1.5 rounded-full bg-brand-bright" aria-hidden="true" />
          connected
        </span>
      </div>

      <div className="px-5 pt-5">
        <div
          className="grid grid-cols-3 gap-1 rounded-xl bg-foreground/[0.04] p-1 ring-1 ring-[color:var(--hairline)]"
          role="group"
          aria-label="Key level"
        >
          {KEY_LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              data-key-level={level.id}
              aria-pressed={level.id === DEFAULT_LEVEL ? "true" : "false"}
              className="min-h-[40px] rounded-[9px] px-2 text-[13px] font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground aria-pressed:bg-foreground/[0.09] aria-pressed:text-foreground aria-pressed:shadow-[inset_0_1px_0_var(--hairline)]"
            >
              <span className="sm:hidden">{level.short}</span>
              <span className="hidden sm:inline">{level.label}</span>
            </button>
          ))}
        </div>
        {KEY_LEVELS.map((level) => (
          <p key={level.id} data-for={level.id} className="mt-3 text-[13px] leading-5 text-muted-foreground">
            {level.note}
          </p>
        ))}
      </div>

      <ul className="px-5 pb-2 pt-3">
        {CAPABILITIES.map((cap) => (
          <li key={cap.label} data-cap={cap.min} className="flex items-center gap-3 py-2.5 transition-opacity duration-200">
            <Check data-cap-on className="size-4 shrink-0 text-brand-bright" />
            <Minus data-cap-off className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm text-foreground/90">
              <span data-cap-off className="sr-only">Not included: </span>
              {cap.label}
            </span>
          </li>
        ))}
      </ul>

      <div className="mx-5 flex items-center gap-3 border-t border-[color:var(--hairline)] py-3.5">
        <Lock className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm text-foreground/90">Billing, keys, and deleting the blog</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">always yours</span>
      </div>

      <div className="border-t border-[color:var(--hairline)] bg-black/20 px-5 py-3.5">
        {KEY_LEVELS.map((level) => (
          <p key={level.id} data-for={level.id} className="break-words font-mono text-[11px] leading-[1.7] text-muted-foreground">
            <span className="text-foreground/70">scopes </span>
            {level.scopes.join("  ")}
          </p>
        ))}
      </div>
    </div>
  );
}
