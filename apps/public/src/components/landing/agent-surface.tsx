import { ArrowRight } from "./icons";
import { H2, LEAD, PANEL, SectionShell } from "./primitives";

// Mirrors packages/api-contract operations (19 MCP tools).
const MCP_TOOL_COUNT = 19;

type Surface = {
  tag: string;
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
};

function surfaces(apiDocsUrl: string): Surface[] {
  return [
    {
      tag: "MCP",
      title: `${MCP_TOOL_COUNT} tools over one endpoint`,
      body: "Draft, preview, publish, restore, upload. Each tool sits behind a scope.",
    },
    {
      tag: "REST",
      title: "Typed /api/v1 with OpenAPI 3.1",
      body: "The same operations over plain HTTP.",
      href: apiDocsUrl,
      hrefLabel: "API docs",
    },
    {
      tag: "CLI",
      title: "@vibecms/cli",
      body: "Posts and media from any shell or CI job, with --json and --dry-run.",
    },
  ];
}

const TOOLS = [
  "posts.create",
  "posts.preview",
  "posts.publish",
  "posts.versions.restore",
  "assets.upload",
] as const;

export function AgentSurface({ apiDocsUrl }: { apiDocsUrl: string }) {
  const SURFACES = surfaces(apiDocsUrl);
  return (
    <section id="surface" aria-labelledby="surface-title">
      <SectionShell className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
        <div data-reveal className={`order-2 lg:order-1 ${PANEL}`}>
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-5 py-3.5">
            <span className="font-mono text-[11px] text-muted-foreground">
              terminal
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-brand-bright">
              <span className="size-1.5 rounded-full bg-brand-bright" aria-hidden="true" />
              mcp
            </span>
          </div>
          <div tabIndex={0} role="region" aria-label="Connect command" className="overflow-x-auto px-5 py-4 font-mono text-[11.5px] leading-[1.85] sm:text-[12.5px]">
            <div className="whitespace-nowrap text-muted-foreground">
              <span className="text-brand-bright">$</span> claude mcp add --transport http vibecms \
            </div>
            <div className="whitespace-nowrap pl-3 text-foreground/85">
              https://app.vibecms.dev/mcp \
            </div>
            <div className="whitespace-nowrap pl-3 text-muted-foreground">
              --header &quot;Authorization: Bearer{" "}
              <span className="text-foreground/85">vc_live_…</span>&quot;
            </div>
            <div className="mt-3 text-foreground">
              <span className="text-brand-bright">●</span> connected{" "}
              <span className="text-muted-foreground">· {MCP_TOOL_COUNT} tools</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
              {TOOLS.map((t) => (
                <span key={t}>{t}</span>
              ))}
              <span>+{MCP_TOOL_COUNT - TOOLS.length} more</span>
            </div>
          </div>
        </div>

        <div data-reveal data-d="1" className="order-1 min-w-0 lg:order-2">
          <h2 id="surface-title" className={H2}>
            Connect once.
            <br />
            Use any interface.
          </h2>
          <p className={`mt-4 max-w-[440px] ${LEAD}`}>
            MCP, REST, and the CLI run through the same core. Same scopes, same
            version checks, same activity log.
          </p>

          <dl className="mt-7 grid gap-4">
            {SURFACES.map((s) => (
              <div key={s.tag} className="flex gap-3.5">
                <dt className="mt-0.5 inline-flex h-[22px] w-12 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-medium text-foreground ring-1 ring-[color:var(--hairline)]">
                  {s.tag}
                </dt>
                <dd className="min-w-0">
                  <p className="text-[15px] font-medium text-foreground">{s.title}</p>
                  <p className="mt-0.5 text-sm leading-[1.5] text-muted-foreground">
                    {s.body}
                    {s.href ? (
                      <>
                        {" "}
                        <a
                          className="inline-flex items-center gap-0.5 font-medium text-brand-bright underline-offset-4 hover:underline"
                          href={s.href}
                        >
                          {s.hrefLabel}
                          <ArrowRight className="size-3.5" />
                        </a>
                      </>
                    ) : null}
                  </p>
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-7 max-w-[460px] text-sm leading-[1.6] text-muted-foreground">
            vibecms never writes for you. It checks formatting, previews, and
            warns; your agent does the writing.
          </p>
        </div>
      </SectionShell>
    </section>
  );
}
