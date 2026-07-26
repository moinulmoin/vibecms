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

const switchOn =
  "relative h-[25px] w-11 shrink-0 rounded-full border-0 p-0 transition-[background,box-shadow] duration-250 ease-out before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] bg-gradient-to-b from-primary to-brand-bright shadow-[0_0_0_1px_oklch(0.8107_0.1705_152.72/0.45),0_8px_18px_-8px_oklch(0.8107_0.1705_152.72/0.7)]";
const switchOff =
  "relative h-[25px] w-11 shrink-0 rounded-full border-0 p-0 transition-[background,box-shadow] duration-250 ease-out before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] bg-white/10 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.09)]";
const knobOn =
  "absolute top-[3px] size-[19px] rounded-full shadow-[0_2px_5px_oklch(0_0_0/0.4)] transition-[left,background] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] left-[22px] bg-brand-bright-foreground";
const knobOff =
  "absolute top-[3px] size-[19px] rounded-full shadow-[0_2px_5px_oklch(0_0_0/0.4)] transition-[left,background] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] left-[3px] bg-muted-foreground/80";

export function GeneratedScopeTokenBox() {
  const scopeToken = formatScopeToken(INITIAL_SCOPES);
  return (
    <div className="rounded-[14px] bg-black/30 p-3.5 px-4 shadow-[inset_0_0_0_1px_var(--hairline)]">
      <div className="mb-2 font-mono text-[10.5px] text-muted-foreground">
        generated scope token
      </div>
      <div
        className="break-words font-mono text-[13px] leading-relaxed text-brand-bright"
        data-scope-token
      >
        {scopeToken}
      </div>
    </div>
  );
}

function ScopeSwitch({ on, label }: { on: boolean; label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span
        className={[
          "min-w-[52px] text-right font-mono text-[10.5px] transition-colors",
          on ? "text-brand-bright" : "text-muted-foreground",
        ].join(" ")}
        data-scope-state
      >
        {on ? "Allowed" : "Blocked"}
      </span>
      <button
        type="button"
        aria-pressed={on ? "true" : "false"}
        aria-label={`${on ? "Revoke" : "Allow"} ${label}`}
        className={on ? switchOn : switchOff}
        data-scope-switch
        data-on={on ? "true" : "false"}
      >
        <span className={on ? knobOn : knobOff} aria-hidden="true" data-scope-knob />
      </button>
    </div>
  );
}

/** Static scope rows; toggles + token text driven by marketing-interactions.js. */
export function ScopeToggleDemo() {
  return (
    <div className="px-3 pb-3.5 pt-2" data-scope-demo>
      {SCOPE_ROWS.map((row) => {
        const on = INITIAL_SCOPES[row.key];
        return (
          <div
            key={row.key}
            className="flex items-center justify-between gap-4 rounded-[11px] px-3 py-3"
            data-scope-row
            data-scope-key={row.key}
            data-scope-token-part={row.token}
            data-scope-label={row.label}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground/90">
                {row.label}
              </span>
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {row.token}
              </span>
            </div>
            <ScopeSwitch on={on} label={row.label} />
          </div>
        );
      })}
    </div>
  );
}
