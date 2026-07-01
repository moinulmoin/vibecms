import { ArrowRightIcon } from "@radix-ui/react-icons";
import { SectionShell } from "./primitives";

const panelChrome =
  "overflow-hidden rounded-[18px] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] shadow-[inset_0_1px_0_var(--hairline),0_40px_80px_-40px_oklch(0_0_0/0.95)] ring-1 ring-[color:var(--hairline)]";

type Surface = {
  tag: string;
  title: string;
  body: string;
  href?: string;
  hrefLabel?: string;
};

const SURFACES: Surface[] = [
  {
    tag: "MCP",
    title: "18 tools over POST /mcp",
    body: "Draft, publish, version, upload, read - JSON-RPC, each behind a scope.",
  },
  {
    tag: "REST",
    title: "17 typed operations · OpenAPI 3.1",
    body: "The same actions over plain HTTP, with live docs.",
    href: "/api/v1/docs",
    hrefLabel: "Open API docs",
  },
  {
    tag: "CLI",
    title: "@vibecms/cli",
    body: "Scriptable from any shell: posts, assets, schema. --json / --dry-run.",
  },
];

// A real slice of the tool surface (18 total) - shown to prove depth, not flood green.
const TOOLS = [
  "posts.create",
  "posts.publish",
  "posts.preview",
  "posts.versions.restore",
  "assets.upload",
] as const;

export function AgentSurface() {
  return (
    <section id="surface">
      <SectionShell className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
        {/* The connect moment + self-test - proof it just works */}
        <div data-reveal className={panelChrome}>
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-5 py-3.5">
            <span className="font-mono text-[11px] text-muted-foreground">
              connect · blog.acme.com
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-brand-bright">
              <span
                className="size-1.5 rounded-full bg-brand-bright animate-vc-pulse"
                aria-hidden="true"
              />
              mcp
            </span>
          </div>
          <div className="px-5 py-4 font-mono text-[12.5px] leading-[1.85]">
            <div className="text-muted-foreground">
              <span className="text-brand-bright">$</span> claude mcp add --transport http vibecms \
            </div>
            <div className="break-all pl-3 text-foreground/85">
              https://blog.acme.com/mcp \
            </div>
            <div className="break-all pl-3 text-muted-foreground">
              --header &quot;Authorization: Bearer{" "}
              <span className="text-foreground/85">vc_live_…</span>&quot;
            </div>
            <div className="mt-3 text-foreground">
              <span className="text-brand-bright">●</span> connected{" "}
              <span className="text-muted-foreground">
                · 18 tools available, scoped to publish
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
              {TOOLS.map((t) => (
                <span key={t}>{t}</span>
              ))}
              <span className="text-foreground/45">+13 more</span>
            </div>
          </div>
        </div>

        {/* Copy + the three surfaces + the anti-slop trust boundary */}
        <div data-reveal data-d="1" className="min-w-0">
          <h2 className="text-balance font-display text-[clamp(1.875rem,4vw,2.875rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
            Your agent drives
            <br />
            the whole blog.
          </h2>
          <p className="mt-4 max-w-[440px] text-[16.5px] leading-[1.62] text-muted-foreground">
            Connect once. Your agent gets MCP, a typed REST API, and a CLI - all
            behind one scoped token, all speaking the same actions.
          </p>

          <div className="mt-7 grid gap-3.5">
            {SURFACES.map((s) => (
              <div key={s.tag} className="flex gap-3.5">
                <span className="mt-0.5 inline-flex h-[22px] shrink-0 items-center rounded-md bg-brand-bright/10 px-2 font-mono text-[10.5px] font-medium text-brand-bright">
                  {s.tag}
                </span>
                <div className="min-w-0">
                  <p className="text-[14.5px] font-medium text-foreground">
                    {s.title}
                  </p>
                  <p className="mt-0.5 text-[13.5px] leading-[1.5] text-muted-foreground">
                    {s.body}
                    {s.href ? (
                      <>
                        {" "}
                        <a
                          className="inline-flex items-center gap-0.5 font-medium text-brand-bright underline-offset-4 hover:underline"
                          href={s.href}
                        >
                          {s.hrefLabel}
                          <ArrowRightIcon className="size-3.5" aria-hidden="true" />
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-7 border-t border-[color:var(--hairline)] pt-5 text-[14px] leading-[1.6] text-muted-foreground">
            <span className="text-foreground">The platform validates and guides</span>{" "}
            - format guides, preview, content warnings -{" "}
            <span className="text-foreground">but never writes for you.</span> Your
            agent is the intelligence; the audit trail is yours.
          </p>
        </div>
      </SectionShell>
    </section>
  );
}
