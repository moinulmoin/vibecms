import { Button } from "@vc/ui";
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CodeIcon,
  ColorWheelIcon,
  CounterClockwiseClockIcon,
  Cross2Icon,
  CubeIcon,
  DownloadIcon,
  FileTextIcon,
  GlobeIcon,
  LockClosedIcon,
  Pencil2Icon,
  PersonIcon,
  ReaderIcon,
  StackIcon,
  UploadIcon,
} from "@radix-ui/react-icons";
import { BRAND, PRICING, ENTITLEMENTS, MEDIA, THEMES } from "@vc/config";

const navItems = [
  ["Features", "#features"],
  ["Agents", "#agents"],
  ["Pricing", "#pricing"],
] as const;

const features = [
  {
    glyph: "edit",
    title: "Markdown editor",
    body: "Write clean posts in Markdown.",
  },
  {
    glyph: "upload",
    title: "Media uploads",
    body: `Drag in images up to ${MEDIA.maxImageLabel}. Stored in R2.`,
  },
  {
    glyph: "history",
    title: "Version history",
    body: "Every meaningful edit creates a version you can trace.",
  },
  {
    glyph: "filetext",
    title: "Activity log",
    body: "See who did what and when, including agent actions.",
  },
  {
    glyph: "shield",
    title: "Scoped tokens",
    body: "Let agents write, draft, and publish through scoped MCP.",
  },
  {
    glyph: "palette",
    title: "Public presets",
    body: "Curated public blog looks for a simple publication.",
  },
  {
    glyph: "rss",
    title: "RSS and SEO",
    body: "Automatic feeds and meta tags so readers find you.",
  },
  {
    glyph: "download",
    title: "One-click export",
    body: "Download every post as JSON anytime. No lock-in.",
  },
];

const agentPermissions: [string, boolean][] = [
  ["Create a draft", true],
  ["Update metadata", true],
  ["Upload blog images", true],
  ["Change billing", false],
  ["Change site ownership", false],
];

const workflowSteps = [
  ["Start", "Create the blog and set the basic publication details."],
  ["Write", "Publish from the dashboard or let an agent prepare a draft."],
  ["Review", "Check the version trail before important posts go live."],
  ["Publish", "Serve the public blog from a managed Cloudflare stack."],
] as const;

const pricingFeatures = [
  ...ENTITLEMENTS,
  `Up to ${MEDIA.paidStorageLabel} media storage`,
  "Fair-use hosting",
];

const faqs = [
  [
    "Is VibeCMS an AI writer?",
    "No. It is the CMS that humans and trusted agents write into. Bring your own agent, script, or editor.",
  ],
  [
    "Who is this for?",
    "Technical founders, indie hackers, and small teams that want a simple blog with programmable publishing access.",
  ],
  [
    "Can I self-host it?",
    "Yes. VibeCMS is open source and built for Cloudflare Workers, D1, and R2.",
  ],
  [
    "What is not included?",
    "Native video hosting, generic file hosting, teams, and multi-site plans are outside the first version.",
  ],
] as const;

const glyphIcons = {
  edit: Pencil2Icon,
  shield: LockClosedIcon,
  clock: ClockIcon,
  globe: GlobeIcon,
  server: StackIcon,
  terminal: CodeIcon,
  check: CheckIcon,
  x: Cross2Icon,
  chevron: ChevronDownIcon,
  upload: UploadIcon,
  history: CounterClockwiseClockIcon,
  filetext: FileTextIcon,
  palette: ColorWheelIcon,
  rss: ReaderIcon,
  download: DownloadIcon,
  user: PersonIcon,
  bot: CubeIcon,
} as const;

function Glyph({ kind }: { kind: string }) {
  const Icon = glyphIcons[kind as keyof typeof glyphIcons] ?? CodeIcon;
  return <Icon className="size-4" aria-hidden="true" />;
}

export const Home = () => {
  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      {/* Nav */}
      <nav className="sticky top-0 z-30 border-b border-border bg-background/92 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <a className="flex items-center gap-2.5 text-sm font-semibold no-underline" href="/">
            <span className="grid size-7 place-items-center rounded-lg bg-primary font-mono text-[10px] text-primary-foreground" aria-hidden="true">vc</span>
            {BRAND.name}
          </a>
          <div className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            {navItems.map(([label, href]) => (
              <a className="no-underline transition-colors hover:text-foreground" href={href} key={href}>{label}</a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost"><a href="/login">Sign in</a></Button>
            <Button asChild size="sm"><a href="/login">Start free trial</a></Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-20 sm:px-8 md:pt-24 lg:min-h-[calc(100dvh-64px)] lg:grid-cols-[1fr_1.1fr] lg:items-center lg:pt-8">
        <div className="relative z-10">
          <h1 className="max-w-2xl text-balance text-5xl font-medium leading-[0.95] tracking-[-0.05em] sm:text-6xl lg:text-[3.75rem]">
            {BRAND.tagline}
          </h1>
          <p className="mt-5 max-w-lg text-pretty text-lg leading-8 text-muted-foreground">
            {BRAND.description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="rounded-lg active:translate-y-px" size="lg"><a href="/login">Start free trial</a></Button>
            <Button asChild className="rounded-lg active:translate-y-px" size="lg" variant="outline"><a href="#self-host">Self-host</a></Button>
          </div>
        </div>

        {/* MCP tool call + REST API examples */}
        <div className="grid gap-4">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
              <span className="text-primary"><Glyph kind="terminal" /></span>
              <span className="font-mono text-xs text-muted-foreground">MCP tool call</span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-foreground">
              <code>{`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "posts.create",
    "arguments": {
      "title": "Shipping week 23",
      "slug": "shipping-week-23",
      "contentMarkdown": "## What shipped..."
    }
  }
}`}</code>
            </pre>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
              <span className="text-primary"><Glyph kind="terminal" /></span>
              <span className="font-mono text-xs text-muted-foreground">REST API (read-only)</span>
            </div>
            <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-foreground">
              <code>{`curl -H "Authorization: Bearer vc_..." \\
  https://your-blog.example/api/posts`}</code>
            </pre>
          </div>
        </div>
      </header>

      {/* Proof strip */}
      <section className="border-y border-border bg-muted/40">
        <div className="mx-auto grid max-w-7xl gap-0 px-5 py-0 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
          {[
            ["Hosted blog", "One clean publication with posts, images, public pages, and a dashboard that stays out of the way."],
            ["Agent-ready", "Scoped MCP lets trusted assistants write, draft, publish, update, and inspect content without sharing your login."],
            ["Versioned", "Every important edit can be traced through activity history and post versions."],
            ["Self-hostable", "Run the open-source app on Cloudflare, or use VibeCMS Cloud when you want it managed."],
          ].map(([value, label]) => (
            <div className="border-b border-border py-7 sm:px-5 lg:border-b-0 lg:border-r lg:last:border-r-0" key={value}>
              <p className="text-2xl font-medium tracking-[-0.03em] text-primary">{value}</p>
              <p className="mt-3 max-w-[19rem] text-sm leading-6 text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8" id="features">
        <h2 className="max-w-xl text-balance text-4xl font-medium leading-tight tracking-[-0.04em] sm:text-5xl">
          The essentials for one serious blog.
        </h2>
        <p className="mt-4 max-w-md text-lg leading-8 text-muted-foreground">
          {BRAND.description}
        </p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <article className="rounded-xl border border-border bg-card p-5" key={f.title}>
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Glyph kind={f.glyph} />
              </div>
              <h3 className="mt-4 text-base font-medium tracking-[-0.01em]">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* How it works - human vs agent */}
      <section className="border-y border-border bg-card py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <h2 className="max-w-2xl text-balance text-4xl font-medium leading-tight tracking-[-0.04em] sm:text-5xl">
            Two ways in, one blog.
          </h2>
          <p className="mt-4 max-w-xl text-lg leading-8 text-muted-foreground">
            Write Markdown in the dashboard, let agents publish through MCP, and keep REST for safe reads.
          </p>
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <article className="rounded-xl border border-border bg-background p-6">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Glyph kind="user" />
                </div>
                <h3 className="text-xl font-medium tracking-[-0.02em]">For humans</h3>
              </div>
              <ol className="mt-6 space-y-4 border-t border-border pt-5">
                {[
                  "Open the dashboard and write in a clean Markdown editor.",
                  "Upload images directly. They are stored in R2 and served fast.",
                  "Review the version trail before publishing.",
                  "Pick a curated public preset.",
                  "Export all posts as JSON. Yours to keep.",
                ].map((step, i) => (
                  <li className="flex gap-3 text-sm leading-6" key={step}>
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </article>
            <article className="rounded-xl border border-border bg-background p-6">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Glyph kind="bot" />
                </div>
                <h3 className="text-xl font-medium tracking-[-0.02em]">For agents</h3>
              </div>
              <ol className="mt-6 space-y-4 border-t border-border pt-5">
                {[
                  "Connect trusted assistants through scoped MCP.",
                  "Create drafts, update posts, publish, archive, and upload media.",
                  "Every action appears in the activity log for audit.",
                  "Scoped tokens keep billing and ownership out of reach.",
                ].map((step, i) => (
                  <li className="flex gap-3 text-sm leading-6" key={step}>
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </article>
          </div>
        </div>
      </section>

      {/* Curated themes */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8" id="themes">
        <h2 className="max-w-xl text-balance text-4xl font-medium leading-tight tracking-[-0.04em] sm:text-5xl">
          Curated public presets.
        </h2>
        <p className="mt-4 max-w-md text-lg leading-8 text-muted-foreground">
          Pick a curated look for your public blog. Minimal by default, easy to swap later.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {THEMES.map((theme) => (
            <article className="rounded-xl border border-border bg-card p-6" key={theme.id}>
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Glyph kind="palette" />
              </div>
              <h3 className="mt-5 text-xl font-medium tracking-[-0.02em]">{theme.label}</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{theme.description}</p>
              <span className="mt-4 inline-block rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground">
                {theme.colorMode === "dark" ? "Dark" : "Light"}
              </span>
            </article>
          ))}
        </div>
      </section>

      {/* Agents - 2 column split */}
      <section className="border-y border-border bg-card py-20" id="agents">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[1fr_0.95fr] lg:items-center">
          <div>
            <h2 className="max-w-2xl text-balance text-4xl font-medium leading-tight tracking-[-0.04em] sm:text-5xl">
              Let agents publish through MCP without giving them your login.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
              Give assistants only the scopes they need: draft, update, publish, archive, upload media, or read activity.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-background p-5">
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">agent token</p>
                  <p className="mt-1 font-mono text-sm"><span className="text-primary">vc_</span>blog_writer</p>
                </div>
                <span className="rounded-full border border-primary/25 bg-accent px-3 py-1 font-mono text-xs text-primary">active</span>
              </div>
              <div className="mt-5 grid gap-2">
                {agentPermissions.map(([action, allowed]) => (
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm" key={action}>
                    <span>{action}</span>
                    {allowed ? (
                      <span className="flex items-center gap-1.5 font-mono text-xs text-primary">
                        <Glyph kind="check" /> Allowed
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 font-mono text-xs text-destructive">
                        <Glyph kind="x" /> Not allowed
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Workflow - split list + visual */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="max-w-2xl text-balance text-4xl font-medium leading-tight tracking-[-0.04em] sm:text-5xl">
              From idea to published post without losing the trail.
            </h2>
            <div className="mt-8 divide-y divide-border border-y border-border">
              {workflowSteps.map(([title, body]) => (
                <div className="grid gap-3 py-5 sm:grid-cols-[120px_1fr]" key={title}>
                  <h3 className="font-mono text-sm text-primary">{title}</h3>
                  <p className="leading-7 text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-muted/40 p-6">
            <div className="grid gap-4">
              {[
                { label: "new blog", glyph: "globe" },
                { label: "clean editor", glyph: "edit" },
                { label: "scoped agent key", glyph: "shield" },
                { label: "published with history", glyph: "clock" },
              ].map(({ label, glyph }) => (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3" key={label}>
                  <span className="text-primary"><Glyph kind={glyph} /></span>
                  <span className="text-sm font-medium">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Self-host vs Cloud - 2 column cards */}
      <section className="border-y border-border bg-muted/40 py-20" id="self-host">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <h2 className="max-w-3xl text-balance text-4xl font-medium leading-tight tracking-[-0.04em] sm:text-5xl">
            Use the hosted version, or bring your own Cloudflare account.
          </h2>
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <article className="rounded-xl border border-border bg-card p-7">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Glyph kind="globe" /></div>
              <h3 className="mt-5 text-2xl font-medium tracking-[-0.03em]">{PRICING.planName}</h3>
              <p className="mt-3 leading-7 text-muted-foreground">Managed hosting, billing, updates, and storage so you can focus on the publication.</p>
              <div className="mt-6 rounded-lg border border-border bg-background p-4 font-mono text-sm leading-7 text-foreground">
                <p>Managed Workers hosting</p>
                <p>D1 database</p>
                <p>R2 media storage</p>
                <p>Scoped MCP publishing</p>
              </div>
            </article>
            <article className="rounded-xl border border-border bg-card p-7">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Glyph kind="server" /></div>
              <h3 className="mt-5 text-2xl font-medium tracking-[-0.03em]">Open source</h3>
              <p className="mt-3 leading-7 text-muted-foreground">Deploy to Workers with D1 and R2, inspect the code, and keep the same agent-aware publishing model.</p>
              <div className="mt-6 rounded-lg border border-border bg-background p-4 font-mono text-sm leading-7 text-foreground">
                <p>Cloudflare Workers</p>
                <p>D1 database</p>
                <p>R2 media bucket</p>
                <p>Scoped MCP publishing</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8" id="pricing">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <h2 className="max-w-2xl text-balance text-4xl font-medium leading-tight tracking-[-0.04em] sm:text-5xl">
              One plan for a serious single blog.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
              Simple enough to start today, complete enough to run a real publication with agent help through MCP.
            </p>
          </div>
          <article className="rounded-xl border border-border bg-card p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-medium tracking-[-0.03em]">{PRICING.planName}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{PRICING.trialLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-6xl font-medium tracking-[-0.05em]">${PRICING.monthlyUsd}</p>
                <p className="text-sm text-muted-foreground">{PRICING.monthlyLabel}, or {PRICING.annualLabel}</p>
              </div>
            </div>
            <Button asChild className="mt-7 w-full rounded-lg" size="lg"><a href="/login">Start free trial</a></Button>
            <ul className="mt-7 grid gap-x-6 gap-y-3 border-y border-border py-6 sm:grid-cols-2">
              {pricingFeatures.map((item) => (
                <li className="flex gap-3 text-sm leading-6" key={item}>
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm leading-6 text-muted-foreground">
              Fair-use hosting included. Native video hosting and generic file storage are not included.
            </p>
          </article>
        </div>
      </section>

      {/* FAQ - accordion */}
      <section className="border-y border-border bg-muted/40 py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <h2 className="text-balance text-4xl font-medium leading-tight tracking-[-0.04em] sm:text-5xl">
              Frequently asked questions
            </h2>
          </div>
          <div className="border-t border-border">
            {faqs.map(([question, answer], index) => (
              <details className="border-b border-border py-5" key={question} open={index === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium tracking-[-0.01em] marker:hidden">
                  {question}
                  <span className="grid size-7 place-items-center rounded-full border border-border text-muted-foreground">
                    <Glyph kind="chevron" />
                  </span>
                </summary>
                <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="bg-accent/30 px-5 py-20 sm:px-8">
        <div className="mx-auto max-w-7xl rounded-xl border border-border bg-card p-8 sm:p-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-balance text-4xl font-medium leading-tight tracking-[-0.04em] sm:text-5xl">
              Start simple. Add agents when you are ready.
            </h2>
            <p className="mt-4 text-lg leading-8 text-muted-foreground">
              Write in Markdown, keep versions, and let trusted agents publish through scoped MCP.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button asChild className="rounded-lg active:translate-y-px" size="lg"><a href="/login">Start free trial</a></Button>
              <Button asChild className="rounded-lg active:translate-y-px" size="lg" variant="outline"><a href="#self-host">Self-host</a></Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-muted/30 py-12">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 text-sm sm:px-8 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <a className="mb-4 flex items-center gap-2.5 font-semibold no-underline" href="/">
              <span className="grid size-7 place-items-center rounded-lg bg-primary font-mono text-[10px] text-primary-foreground" aria-hidden="true">vc</span>
              {BRAND.name}
            </a>
            <p className="max-w-xs leading-6 text-muted-foreground">{BRAND.description}</p>
          </div>
          <div>
            <h3 className="mb-3 font-medium">Product</h3>
            <div className="space-y-2 text-muted-foreground">
              <a className="block no-underline hover:text-foreground" href="#features">Features</a>
              <a className="block no-underline hover:text-foreground" href="#agents">Agents</a>
              <a className="block no-underline hover:text-foreground" href="#pricing">Pricing</a>
            </div>
          </div>
          <div>
            <h3 className="mb-3 font-medium">Deploy</h3>
            <div className="space-y-2 text-muted-foreground">
              <a className="block no-underline hover:text-foreground" href="#self-host">Self-host</a>
              <a className="block no-underline hover:text-foreground" href="/login">Sign in</a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
};
