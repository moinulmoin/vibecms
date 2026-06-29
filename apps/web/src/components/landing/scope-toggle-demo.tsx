"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const SCOPE_ROWS = [
  { key: "drafts", label: "Create drafts", token: "drafts:write" },
  { key: "update", label: "Update posts", token: "posts:update" },
  { key: "publish", label: "Publish posts", token: "posts:publish" },
  { key: "media", label: "Upload media", token: "media:write" },
  { key: "billing", label: "Change billing", token: "billing:write" },
  { key: "ownership", label: "Transfer ownership", token: "account:owner" },
] as const;

export type ScopeKey = (typeof SCOPE_ROWS)[number]["key"];

export const INITIAL_SCOPES: Record<ScopeKey, boolean> = {
  drafts: true,
  update: true,
  publish: true,
  media: true,
  billing: false,
  ownership: false,
};

export function formatScopeToken(scopes: Record<ScopeKey, boolean>): string {
  const enabled = SCOPE_ROWS.filter((row) => scopes[row.key]).map((row) => row.token);
  return enabled.length > 0 ? enabled.join("  ") : "- no scopes granted -";
}

type ScopeContextValue = {
  scopes: Record<ScopeKey, boolean>;
  toggle: (key: ScopeKey) => void;
  scopeToken: string;
};

const ScopeContext = createContext<ScopeContextValue | null>(null);

function useScopeContext(): ScopeContextValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) {
    throw new Error("ScopeToggleDemo must be used within AgentsScopeRoot");
  }
  return ctx;
}

type AgentsScopeRootProps = {
  left: ReactNode;
  right: ReactNode;
};

export function AgentsScopeRoot({ left, right }: AgentsScopeRootProps) {
  const [scopes, setScopes] = useState(INITIAL_SCOPES);

  const toggle = useCallback((key: ScopeKey) => {
    setScopes((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const scopeToken = useMemo(() => formatScopeToken(scopes), [scopes]);

  const value = useMemo(
    () => ({ scopes, toggle, scopeToken }),
    [scopes, toggle, scopeToken],
  );

  return (
    <ScopeContext.Provider value={value}>
      {left}
      {right}
    </ScopeContext.Provider>
  );
}

export function GeneratedScopeTokenBox() {
  const { scopeToken } = useScopeContext();
  return (
    <div className="rounded-[14px] bg-black/30 p-3.5 px-4 shadow-[inset_0_0_0_1px_var(--hairline)]">
      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
        generated scope token
      </div>
      <div className="break-words font-mono text-[13px] leading-relaxed text-brand-bright">
        {scopeToken}
      </div>
    </div>
  );
}

function ScopeSwitch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span
        className={[
          "min-w-[52px] text-right font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors",
          on ? "text-brand-bright" : "text-muted-foreground",
        ].join(" ")}
      >
        {on ? "Allowed" : "Blocked"}
      </span>
      <button
        type="button"
        aria-pressed={on}
        aria-label={`${on ? "Revoke" : "Allow"} ${label}`}
        onClick={onToggle}
        className={[
          "relative h-[25px] w-11 shrink-0 rounded-full border-0 p-0 transition-[background,box-shadow] duration-250 ease-out",
          // 44x44 invisible hit area for comfortable mobile tapping (visual track stays 25px)
          "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
          on
            ? "bg-gradient-to-b from-primary to-brand-bright shadow-[0_0_0_1px_oklch(0.8107_0.1705_152.72/0.45),0_8px_18px_-8px_oklch(0.8107_0.1705_152.72/0.7)]"
            : "bg-white/10 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.09)]",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-[3px] size-[19px] rounded-full shadow-[0_2px_5px_oklch(0_0_0/0.4)] transition-[left,background] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]",
            on ? "left-[22px] bg-brand-bright-foreground" : "left-[3px] bg-muted-foreground/80",
          ].join(" ")}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

export function ScopeToggleDemo() {
  const { scopes, toggle } = useScopeContext();

  return (
    <div className="px-3 pb-3.5 pt-2">
      {SCOPE_ROWS.map((row) => (
        <div
          key={row.key}
          className="flex items-center justify-between gap-4 rounded-[11px] px-3 py-3"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium text-foreground/90">
              {row.label}
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {row.token}
            </span>
          </div>
          <ScopeSwitch
            on={scopes[row.key]}
            onToggle={() => toggle(row.key)}
            label={row.label}
          />
        </div>
      ))}
    </div>
  );
}