import { AGENT_TOOL_COUNT } from "@vc/config";
import { ArrowRight } from "./icons";
import { H2, LEAD, PANEL, SectionShell } from "./primitives";

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
      title: `${AGENT_TOOL_COUNT} tools over one endpoint`,
      body: "Draft, preview, schedule, publish, restore, upload, and run the site. Each tool sits behind a scope.",
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

const APP = "https://app.vibecms.dev";

// Shown with a placeholder key; the copied text uses YOUR_KEY.
const CONNECT = [
  {
    id: "mcp",
    label: "MCP",
    lines: ["claude mcp add --transport http vibecms \\", `${APP}/mcp \\`, '--header "Authorization: Bearer vc_live_…"'],
    copy: `claude mcp add --transport http vibecms ${APP}/mcp --header "Authorization: Bearer YOUR_KEY"`,
    note: "",
  },
  {
    id: "rest",
    label: "REST",
    lines: [`curl ${APP}/api/v1/posts \\`, '-H "Authorization: Bearer vc_live_…"'],
    copy: `curl ${APP}/api/v1/posts -H "Authorization: Bearer YOUR_KEY"`,
    note: "Every tool is an HTTP endpoint, described in OpenAPI 3.1.",
  },
  {
    id: "cli",
    label: "CLI",
    lines: ["npx @vibecms/cli login --token vc_live_…", "npx @vibecms/cli posts list"],
    copy: "npx @vibecms/cli login --token YOUR_KEY && npx @vibecms/cli posts list",
    note: "Add --json for scripts and CI, or --dry-run to check a change first.",
  },
] as const;

const TOOLS = [
  "posts.create",
  "posts.preview",
  "posts.schedule",
  "posts.publish",
  "posts.versions.restore",
  "sites.theme.update",
] as const;

export function AgentSurface({ apiDocsUrl }: { apiDocsUrl: string }) {
  const SURFACES = surfaces(apiDocsUrl);
  return (
    <section id="surface" aria-labelledby="surface-title">
      <SectionShell className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
        <div data-reveal className={`order-2 lg:order-1 ${PANEL}`} data-connect-tabs>
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-3 py-2">
            <div role="tablist" aria-label="Connect with" className="flex gap-1">
              {CONNECT.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  id={`connect-tab-${c.id}`}
                  aria-controls={`connect-panel-${c.id}`}
                  aria-selected={i === 0 ? "true" : "false"}
                  data-connect-tab={c.id}
                  className="min-h-[34px] rounded-lg px-3 font-mono text-[11.5px] text-muted-foreground transition-colors duration-200 hover:text-foreground aria-selected:text-foreground aria-selected:[background:var(--surface-glass-strong)] aria-selected:ring-1 aria-selected:ring-[color:var(--hairline)]"
                >
                  {c.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              data-copy={CONNECT[0]!.copy}
              data-connect-copy
              className="min-h-[34px] rounded-lg px-3 font-mono text-[11px] text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              <span data-copy-label>copy</span>
            </button>
          </div>
          {CONNECT.map((c, i) => (
            <div
              key={c.id}
              role="tabpanel"
              id={`connect-panel-${c.id}`}
              aria-labelledby={`connect-tab-${c.id}`}
              data-connect-panel={c.id}
              data-copy-text={c.copy}
              hidden={i !== 0}
              tabIndex={0}
              className="min-h-[196px] overflow-x-auto px-5 py-4 font-mono text-[11.5px] leading-[1.85] sm:text-[12.5px]"
            >
              {c.lines.map((line, j) => (
                <div
                  key={j}
                  className={`whitespace-nowrap text-muted-foreground ${j > 0 && c.lines[j - 1]!.endsWith("\\") ? "pl-3" : ""}`}
                >
                  {j === 0 || !c.lines[j - 1]!.endsWith("\\") ? <span className="text-brand-bright">$ </span> : null}
                  {line}
                </div>
              ))}
              {c.id === "mcp" ? (
                <>
                  <div className="mt-3 text-foreground">
                    <span className="text-brand-bright">●</span> connected{" "}
                    <span className="text-muted-foreground">· {AGENT_TOOL_COUNT} tools</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                    {TOOLS.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                    <span>+{AGENT_TOOL_COUNT - TOOLS.length} more</span>
                  </div>
                </>
              ) : (
                <p className="mt-3 whitespace-normal text-muted-foreground">{c.note}</p>
              )}
            </div>
          ))}
        </div>

        <div data-reveal data-d="1" className="order-1 min-w-0 lg:order-2">
          <h2 id="surface-title" className={H2}>
            Works with the agent
            <br />
            you already use.
          </h2>
          <p className={`mt-4 max-w-[440px] ${LEAD}`}>
            Claude, Codex, Cursor, or a script: connect over MCP, REST, or the
            CLI. Same rules and the same history everywhere.
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
