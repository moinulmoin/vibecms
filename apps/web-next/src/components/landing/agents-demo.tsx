import { CodeIcon } from "@radix-ui/react-icons";
import { MonoEyebrow, Pill, SectionShell } from "./primitives";
import {
  AgentsScopeRoot,
  GeneratedScopeTokenBox,
  ScopeToggleDemo,
} from "./scope-toggle-demo";

const panelChrome =
  "overflow-hidden rounded-[18px] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] shadow-[inset_0_1px_0_var(--hairline),0_40px_80px_-40px_oklch(0_0_0/0.95)] ring-1 ring-[color:var(--hairline)]";

export function AgentsDemo() {
  return (
    <section id="agents">
      <SectionShell className="grid items-center gap-10 pt-[110px] lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
        <AgentsScopeRoot
          left={
            <div data-reveal className="min-w-0">
              <MonoEyebrow label="Scoped access" className="mb-4" />
              <h2 className="font-display text-[clamp(1.875rem,4vw,2.875rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
                Let agents publish
                <br />
                without your login.
              </h2>
              <p className="mt-4 mb-6 max-w-[420px] text-[16.5px] leading-[1.62] text-muted-foreground">
                Give each assistant only the scopes it needs. Flip a switch - the MCP
                token updates instantly. Nothing leaks to your account or billing.
              </p>
              <GeneratedScopeTokenBox />
            </div>
          }
          right={
            <div data-reveal className={panelChrome}>
              <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-brand-bright/15 text-brand-bright">
                    <CodeIcon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      blog-writer
                    </div>
                    <div className="font-mono text-[10.5px] text-muted-foreground">
                      agent · 1 blog
                    </div>
                  </div>
                </div>
                <Pill className="shrink-0 normal-case tracking-[0.1em] text-brand-bright">
                  connected
                </Pill>
              </div>
              <ScopeToggleDemo />
            </div>
          }
        />
      </SectionShell>
    </section>
  );
}