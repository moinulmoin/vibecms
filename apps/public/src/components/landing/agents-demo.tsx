import { KeyLevelsDemo } from "./key-levels";
import { H2, LEAD, PANEL, SectionLight, SectionShell } from "./primitives";

export function AgentsDemo({ apiDocsUrl }: { apiDocsUrl: string }) {
  return (
    <section id="agents" aria-labelledby="agents-title">
      <SectionShell className="isolate grid items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
        <SectionLight x="72%" y="50%" alpha={0.14} />
        <div data-reveal className="min-w-0">
          <h2 id="agents-title" className={H2}>
            A key for each agent.
            <br />
            Never your password.
          </h2>
          <p className={`mt-4 max-w-[440px] ${LEAD}`}>
            Give each agent its own key and decide how far it can go. Keys are
            shown once, stored as a hash, and revoked in one click.
          </p>
          <p className="mt-5 max-w-[440px] text-sm leading-[1.6] text-muted-foreground">
            New keys can only write drafts. The same keys work over MCP, the{" "}
            <a
              className="font-medium text-brand-bright underline-offset-4 hover:underline"
              href={apiDocsUrl}
            >
              REST API
            </a>
            , and the CLI.
          </p>
        </div>
        <div data-reveal data-d="1" className={PANEL}>
          <KeyLevelsDemo />
        </div>
      </SectionShell>
    </section>
  );
}
