import { Bot } from "./icons";
import { H2, LEAD, PANEL, SectionShell } from "./primitives";
import { GeneratedScopeTokenBox, ScopeToggleDemo } from "./scope-toggle-demo";

export function AgentsDemo({ apiDocsUrl }: { apiDocsUrl: string }) {
  return (
    <section id="agents" aria-labelledby="agents-title">
      <SectionShell className="grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
        <div data-reveal className="min-w-0">
          <h2 id="agents-title" className={H2}>
            A token for your agent.
            <br />
            Never your login.
          </h2>
          <p className={`mt-4 mb-6 max-w-[440px] ${LEAD}`}>
            Pick what each agent may do. Give it drafts and publish yourself, or
            grant publishing to the one you trust. Tokens are shown once and
            stored as a hash.
          </p>
          <GeneratedScopeTokenBox />
          <p className="mt-5 max-w-[440px] text-sm leading-[1.6] text-muted-foreground">
            The same scopes cover the{" "}
            <a
              className="font-medium text-brand-bright underline-offset-4 hover:underline"
              href={apiDocsUrl}
            >
              REST API
            </a>{" "}
            and the CLI.
          </p>
        </div>
        <div data-reveal className={PANEL}>
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-brand-bright/10 text-brand-bright">
                <Bot className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  blog-writer
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  last used 2 min ago
                </div>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-brand-bright">
              <span className="size-1.5 rounded-full bg-brand-bright" aria-hidden="true" />
              connected
            </span>
          </div>
          <ScopeToggleDemo />
        </div>
      </SectionShell>
    </section>
  );
}
