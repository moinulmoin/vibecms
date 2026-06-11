import { Button } from "@vc/ui";
import {
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CodeIcon,
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
import { BRAND, PRICING, ENTITLEMENTS, MEDIA } from "@vc/config";

const navItems = [
  ["Features", "#features"],
  ["Agents", "#agents"],
  ["Pricing", "#pricing"],
] as const;

const essentials = [
  {
    glyph: "edit",
    title: "Markdown editor",
    body: "Write posts in Markdown with preview before publishing.",
    className: "lg:col-span-2 lg:row-span-2",
  },
  {
    glyph: "shield",
    title: "Scoped MCP",
    body: "Let agents draft, update, publish, archive, upload, and read only what you allow.",
    className: "lg:col-span-2",
  },
  {
    glyph: "history",
    title: "Version history",
    body: "Every meaningful edit creates a version you can trace.",
    className: "lg:col-span-1",
  },
  {
    glyph: "filetext",
    title: "Activity log",
    body: "See human and agent actions in one audit trail.",
    className: "lg:col-span-1",
  },
  {
    glyph: "upload",
    title: "Media library",
    body: `Upload images up to ${MEDIA.maxImageLabel}. Store them in R2.`,
    className: "lg:col-span-2",
  },
  {
    glyph: "rss",
    title: "Public output",
    body: "RSS, sitemap, robots, meta tags, and public blog pages are built in.",
    className: "lg:col-span-2",
  },
  {
    glyph: "download",
    title: "Export anytime",
    body: "Download posts as JSON. No lock-in.",
    className: "lg:col-span-2",
  },
] as const;

const agentPermissions: [string, boolean][] = [
  ["Create drafts", true],
  ["Update posts", true],
  ["Publish posts", true],
  ["Upload media", true],
  ["Change billing", false],
  ["Change ownership", false],
];

const publishingPath = [
  ["Write", "Draft in the dashboard or through MCP."],
  ["Review", "Preview Markdown, attach media, and inspect versions."],
  ["Publish", "Go live from the UI or a scoped agent call."],
  ["Trace", "Keep the activity trail for every important change."],
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
    <main className="dark min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <nav className="sticky top-0 z-30 border-b border-border bg-background/88 backdrop-blur-xl">
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

      <header className="relative mx-auto grid min-h-[calc(100dvh-64px)] max-w-7xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-8">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-primary/10 blur-3xl" aria-hidden="true" />
        <div className="relative z-10 max-w-2xl">
          <p className="mb-5 inline-flex rounded-full border border-border bg-card/70 px-3 py-1 font-mono text-xs text-muted-foreground">
            Markdown CMS plus scoped MCP
          </p>
          <h1 className="text-balance text-5xl font-medium leading-[0.94] tracking-[-0.06em] sm:text-6xl lg:text-7xl">
            {BRAND.tagline}
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-lg leading-8 text-muted-foreground">
            {BRAND.description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="rounded-lg active:translate-y-px" size="lg"><a href="/login">Start free trial</a></Button>
            <Button asChild className="rounded-lg active:translate-y-px" size="lg" variant="outline"><a href="#self-host">Self-host</a></Button>
          </div>
        </div>

        <div className="relative z-10">
          <div className="rounded-2xl border border-border bg-card/65 p-2 shadow-2xl shadow-primary/10">
            <img
              alt="VibeCMS product artwork showing Markdown, media, versions, and agent nodes"
              className="aspect-[16/11] w-full rounded-xl object-cover"
              decoding="async"
              fetchPriority="high"
              src="/brand/landing-hero.webp"
            />
          </div>
          <div className="mx-4 -mt-6 grid gap-3 rounded-xl border border-border bg-background/92 p-4 shadow-2xl shadow-background/50 backdrop-blur sm:mx-8 sm:grid-cols-3">
            {[
              ["draft", "agent can write"],
              ["publish", "owner can allow"],
              ["versions", "history stays"],
            ].map(([title, body]) => (
              <div key={title}>
                <p className="font-mono text-xs text-primary">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      <section className="border-y border-border bg-card/35">
        <div className="mx-auto grid max-w-7xl gap-px px-5 py-4 sm:px-8 lg:grid-cols-3">
          {[
            ["Markdown-first", "A calm writing surface for posts."],
            ["Agent-scoped", "MCP tokens limit what assistants can touch."],
            ["Versioned", "Posts, activity, and history stay connected."],
          ].map(([title, body]) => (
            <article className="rounded-xl bg-background/70 p-5" key={title}>
              <p className="text-xl font-medium tracking-[-0.03em]">{title}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8" id="features">
        <div className="max-w-2xl">
          <h2 className="text-balance text-4xl font-medium leading-tight tracking-[-0.05em] sm:text-6xl">
            The essentials for one serious blog.
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
            One clean publication surface with the CMS pieces that matter: writing, media, history, public output, and export.
          </p>
        </div>
        <div className="mt-12 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {essentials.map((f, index) => (
            <article className={`rounded-2xl border border-border p-5 ${index === 0 ? "bg-primary text-primary-foreground" : index % 3 === 0 ? "bg-accent/60" : "bg-card"} ${f.className}`} key={f.title}>
              <div className={`flex size-10 items-center justify-center rounded-lg ${index === 0 ? "bg-primary-foreground/15 text-primary-foreground" : "bg-primary/10 text-primary"}`}>
                <Glyph kind={f.glyph} />
              </div>
              <h3 className="mt-5 text-xl font-medium tracking-[-0.03em]">{f.title}</h3>
              <p className={`mt-3 max-w-sm text-sm leading-6 ${index === 0 ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card/35 py-24" id="agents">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <h2 className="max-w-3xl text-balance text-4xl font-medium leading-tight tracking-[-0.05em] sm:text-6xl">
              Let agents publish without giving them your login.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
              Give assistants only the scopes they need. Draft, update, publish, archive, upload media, or inspect activity.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {agentPermissions.map(([action, allowed]) => (
                <div className="flex items-center justify-between rounded-xl border border-border bg-background/70 px-4 py-3 text-sm" key={action}>
                  <span>{action}</span>
                  {allowed ? (
                    <span className="flex items-center gap-1.5 font-mono text-xs text-primary">
                      <Glyph kind="check" /> Allowed
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 font-mono text-xs text-destructive">
                      <Glyph kind="x" /> Blocked
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4">
            <div className="rounded-2xl border border-border bg-background p-5">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">remote MCP endpoint</p>
                  <p className="mt-1 font-mono text-sm"><span className="text-primary">POST</span> /mcp</p>
                </div>
                <span className="rounded-full border border-primary/25 bg-accent px-3 py-1 font-mono text-xs text-primary">Bearer vc_...</span>
              </div>
              <div className="mt-5 rounded-xl bg-card p-4 font-mono text-xs leading-6 text-muted-foreground">
                <p>{`tools/call -> posts.create`}</p>
                <p>{`tools/call -> posts.publish`}</p>
                <p>{`tools/call -> media.upload`}</p>
              </div>
            </div>
            <img
              alt="VibeCMS poster artwork with agent-aware publishing motifs"
              className="hidden rounded-2xl border border-border object-cover shadow-2xl shadow-primary/10 md:block"
              decoding="async"
              loading="lazy"
              src="/brand/launch-poster.png"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          <div>
            <h2 className="text-balance text-4xl font-medium leading-tight tracking-[-0.05em] sm:text-6xl">
              From draft to published, with the trail intact.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
              Humans and agents use different doors into the same command layer, so the blog stays coherent.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {publishingPath.map(([title, body]) => (
              <article className="rounded-2xl border border-border bg-card p-6" key={title}>
                <p className="font-mono text-sm text-primary">{title}</p>
                <p className="mt-4 text-lg leading-7">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card/35 py-24" id="self-host">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <h2 className="max-w-3xl text-balance text-4xl font-medium leading-tight tracking-[-0.05em] sm:text-6xl">
            Hosted when you want speed. Self-hosted when you want control.
          </h2>
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <article className="rounded-2xl border border-border bg-background p-7">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Glyph kind="globe" /></div>
              <h3 className="mt-5 text-2xl font-medium tracking-[-0.03em]">{PRICING.planName}</h3>
              <p className="mt-3 leading-7 text-muted-foreground">Managed Workers hosting, billing, updates, and storage so you can focus on the publication.</p>
            </article>
            <article className="rounded-2xl border border-border bg-background p-7">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Glyph kind="server" /></div>
              <h3 className="mt-5 text-2xl font-medium tracking-[-0.03em]">Open source</h3>
              <p className="mt-3 leading-7 text-muted-foreground">Deploy to Workers with D1 and R2, inspect the code, and keep the same agent-aware publishing model.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8" id="pricing">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <h2 className="max-w-2xl text-balance text-4xl font-medium leading-tight tracking-[-0.05em] sm:text-6xl">
              One plan for a serious single blog.
            </h2>
            <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
              Simple enough to start today, complete enough to run a real publication with agent help through MCP.
            </p>
          </div>
          <article className="rounded-2xl border border-primary/30 bg-primary p-7 text-primary-foreground shadow-2xl shadow-primary/10">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-medium tracking-[-0.03em]">{PRICING.planName}</h3>
                <p className="mt-2 text-sm text-primary-foreground/75">{PRICING.trialLabel}</p>
              </div>
              <div className="text-right">
                <p className="text-6xl font-medium tracking-[-0.05em]">${PRICING.monthlyUsd}</p>
                <p className="text-sm text-primary-foreground/75">{PRICING.monthlyLabel}, or {PRICING.annualLabel}</p>
              </div>
            </div>
            <Button asChild className="mt-7 w-full rounded-lg" size="lg" variant="secondary"><a href="/login">Start free trial</a></Button>
            <ul className="mt-7 grid gap-x-6 gap-y-3 border-y border-primary-foreground/20 py-6 sm:grid-cols-2">
              {pricingFeatures.map((item) => (
                <li className="flex gap-3 text-sm leading-6" key={item}>
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary-foreground" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm leading-6 text-primary-foreground/75">
              Fair-use hosting included. Native video hosting and generic file storage are not included.
            </p>
          </article>
        </div>
      </section>

      <section className="border-y border-border bg-card/35 py-24">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 sm:px-8 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <h2 className="text-balance text-4xl font-medium leading-tight tracking-[-0.05em] sm:text-6xl">
              Questions before launch.
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

      <section className="px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-2xl border border-border bg-card">
          <div className="grid gap-8 p-8 sm:p-12 lg:grid-cols-[1fr_0.8fr] lg:items-center">
            <div>
              <h2 className="max-w-2xl text-balance text-4xl font-medium leading-tight tracking-[-0.05em] sm:text-6xl">
                Start simple. Add agents when you are ready.
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
                Write in Markdown, keep versions, and let trusted agents publish through scoped MCP.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button asChild className="rounded-lg active:translate-y-px" size="lg"><a href="/login">Start free trial</a></Button>
                <Button asChild className="rounded-lg active:translate-y-px" size="lg" variant="outline"><a href="#self-host">Self-host</a></Button>
              </div>
            </div>
            <img
              alt="VibeCMS social preview artwork"
              className="rounded-xl border border-border object-cover"
              decoding="async"
              loading="lazy"
              src="/brand/social-banner.png"
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-border bg-card/35 py-12">
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
