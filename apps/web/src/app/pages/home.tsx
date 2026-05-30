import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@vc/ui";

const posts = [
  ["Launch notes for the new agent workflow", "In review", "agent", "copy-bot", "v14", "2m ago"],
  ["Scoped API keys for trusted assistants", "Published", "human", "mira", "v3", "1h ago"],
  ["How we moved the blog to Cloudflare", "Draft", "human", "jonas", "v8", "3h ago"],
  ["Why every agent-assisted CMS needs history", "Published", "agent", "seo-bot", "v22", "Yesterday"],
  ["Image alt text and media rules", "Draft", "agent", "alt-bot", "v1", "3 days"],
];

const proofStats = [
  ["1", "hosted blog per subscription"],
  ["5GB", "paid media storage"],
  ["vc_*", "scoped API tokens"],
  ["D1/R2", "self-hostable on Cloudflare"],
];

const problemCards = [
  {
    kicker: "01 — Agents",
    title: "Agents need safe write access, not your admin login.",
    body: "A trusted assistant should draft, update, and inspect content without being able to delete a site or publish garbage forever.",
    rows: [["token", "vc_copybot"], ["allowed", "posts:write"], ["blocked", "billing · settings"]],
  },
  {
    kicker: "02 — History",
    title: "A blog needs a memory, especially when bots help edit it.",
    body: "Every change should leave a trail: who touched it, what version exists now, and how to understand a bad write quickly.",
    rows: [["post", "launch-notes"], ["version", "v14"], ["actor", "copy-bot"]],
  },
  {
    kicker: "03 — Hosting",
    title: "You want a blog, not a second infrastructure project.",
    body: "Hosted public pages, image uploads, API access, and billing should be boring enough that you can ship the writing.",
    rows: [["blog", "hosted"], ["media", "5GB paid"], ["trial", "noindex"]],
  },
];

const featureBlocks = [
  {
    tag: "Control plane",
    title: "A human dashboard and an agent API, backed by the same rules.",
    body: "VibeCMS is not an AI writer. It is the publishing control plane agents can safely operate: posts, status changes, media, activity, and versions all flow through the same backend commands.",
    points: ["Markdown-style body editing with title, slug, excerpt, cover image, and status", "Public hosted blog pages from the content you approve", "No generation layer hiding what changed"],
  },
  {
    tag: "MCP / API access",
    title: "Give assistants a scoped key and a real content surface.",
    body: "Create API keys with vc_* tokens, connect the MCP endpoint, and let trusted tools manage posts without sharing your personal session.",
    points: ["API and MCP actions use the same content permissions", "Activity history records the actor behind each important mutation", "Keys can be revoked from settings when a workflow changes"],
  },
  {
    tag: "Versions and audit trail",
    title: "When a post changes, VibeCMS remembers the path.",
    body: "Post version history and site activity make agent-assisted publishing safer: you can inspect what changed instead of guessing from a final blob of text.",
    points: ["Post versions for editorial rollback and review", "Activity feed for human and API-driven actions", "Billing gate protects publishing and public hosting from free abuse"],
  },
];

const faqs = [
  ["Is VibeCMS an AI writer?", "No. VibeCMS is the CMS that humans and trusted agents write into. Bring Claude, Cursor, scripts, or your own agent; VibeCMS handles content, permissions, publishing, media, activity, and history."],
  ["Why card-required trial?", "Because VibeCMS includes public hosting, media uploads, and MCP/API access. A 7-day card-required trial keeps serious users moving while reducing spam blogs and free file-hosting abuse."],
  ["What is included in the $9 plan?", "One hosted blog, unlimited posts, 5GB paid media storage, MCP/API access, activity history, post version history, fair-use hosting, and all single-blog features."],
  ["Can trial sites publish publicly?", "Yes during an active trial, after email verification and checkout setup. Trial sites are noindex and limited to 500MB media; paid blogs get 5GB media."],
  ["What is not included?", "Native video hosting, generic file hosting, teams, multi-site subscriptions, and manual migration support are intentionally outside the simple $9 plan."],
];

const MiniRows = ({ rows }: { rows: string[][] }) => (
  <div className="mt-5 space-y-2 border-t border-dashed border-[#d2cab3] pt-4 font-mono text-[11px]">
    {rows.map(([key, value]) => (
      <div className="flex items-center gap-2" key={key}>
        <span className="text-muted-foreground">{key}</span>
        <span className="rounded border border-border bg-[#fbf9f2] px-1.5 py-0.5 text-foreground">{value}</span>
      </div>
    ))}
  </div>
);

const Check = () => (
  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-[#e6ede6] text-primary">✓</span>
);

export const Home = () => {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <nav className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <a className="flex items-center gap-3 text-sm font-semibold tracking-[-0.01em]" href="/">
            <span className="grid size-7 place-items-center rounded-lg bg-primary font-mono text-xs text-primary-foreground shadow-[0_10px_25px_-14px_rgba(15,26,20,0.7)]">v</span>
            VibeCMS
          </a>
          <div className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a className="hover:text-foreground" href="#product">Product</a>
            <a className="hover:text-foreground" href="#agents">For agents</a>
            <a className="hover:text-foreground" href="#self-host">Self-host</a>
            <a className="hover:text-foreground" href="#workflow">Workflow</a>
            <a className="hover:text-foreground" href="#pricing">Pricing</a>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost"><a href="/login">Sign in</a></Button>
            <Button asChild size="sm"><a href="/app">Start trial →</a></Button>
          </div>
        </div>
      </nav>

      <header className="relative mx-auto max-w-7xl px-5 pb-8 pt-16 sm:px-8 lg:pt-24">
        <div className="pointer-events-none absolute -right-24 top-12 hidden size-[34rem] rounded-full bg-[radial-gradient(circle,oklch(0.88_0.04_150/.8),transparent_62%)] blur-2xl lg:block" />
        <Badge variant="outline" className="relative rounded-full border-[#d2cab3] bg-[#faf8f1] px-3 py-1 font-mono font-normal text-[#2e3a30]">
          <span className="mr-1 size-1.5 rounded-full bg-primary" /> Open source · hosted for $9/month
        </Badge>
        <h1 className="relative mt-6 max-w-5xl text-balance text-5xl font-medium leading-[0.96] tracking-[-0.055em] sm:text-6xl lg:text-8xl">
          The blog control plane for humans and AI agents.
        </h1>
        <p className="relative mt-6 max-w-2xl text-pretty text-lg leading-8 text-[#2e3a30]">
          Publish from a clean dashboard. Let trusted agents draft, update, and inspect content through MCP/API access. Keep every write visible with activity history and post versions.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[15px] font-medium leading-none text-primary-foreground no-underline transition-colors hover:bg-[#122a1e]" href="/app">Start the 7-day trial →</a>
          <a className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-[#9f957d] bg-[#fbf9f2] px-5 text-[15px] font-medium leading-none text-foreground no-underline transition-colors hover:border-primary hover:bg-card hover:text-primary" href="#self-host">Self-host on Cloudflare</a>
        </div>
        <p className="mt-5 font-mono text-xs text-[#5a6359]"><b className="font-medium text-foreground">7-day free trial</b> · card required · then $9/month or $99/year · no free forever plan</p>

        <div className="mt-10 grid gap-3 border-y border-[#d2cab3] py-4 sm:grid-cols-2 lg:grid-cols-4">
          {proofStats.map(([value, label]) => (
            <div className="grid grid-cols-[auto_1fr] items-center gap-3" key={value}>
              <span className="font-mono text-xl text-primary">{value}</span>
              <span className="text-sm leading-5 text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        <section className="relative mt-14 overflow-hidden rounded-2xl border border-[#d2cab3] bg-card shadow-[0_34px_85px_-48px_rgba(15,26,20,0.45),0_1px_0_rgba(255,255,255,0.7)_inset]">
          <div className="flex items-center gap-3 border-b bg-[#fbf9f2] px-4 py-3">
            <div className="flex gap-1.5"><span className="size-3 rounded-full bg-border" /><span className="size-3 rounded-full bg-border" /><span className="size-3 rounded-full bg-border" /></div>
            <div className="hidden max-w-sm flex-1 items-center gap-2 rounded-md border bg-background px-3 py-1.5 font-mono text-xs text-[#5a6359] sm:flex">▣ app.vibecms.dev/journal/posts</div>
            <span className="ml-auto hidden rounded-full border border-green-200 bg-green-50 px-2 py-1 font-mono text-[11px] text-green-700 sm:inline-flex">trialing · noindex</span>
          </div>
          <div className="grid min-h-[520px] lg:grid-cols-[210px_minmax(0,1fr)_290px]">
            <aside className="hidden border-r bg-[#faf8f1] p-4 lg:block">
              <div className="mb-5 flex items-center gap-2 rounded-lg border bg-card p-2 text-sm font-medium"><span className="grid size-6 place-items-center rounded-md bg-primary font-mono text-[10px] text-primary-foreground">J</span> Journal <span className="ml-auto text-muted-foreground">⌄</span></div>
              {[["Content", ["Posts 142", "Drafts 7", "Scheduled 3", "Media 418"]], ["Settings", ["Public blog", "Activity", "Tokens", "Billing"]]].map(([label, items]) => (
                <div className="mb-5" key={label as string}>
                  <h6 className="mb-2 px-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#5a6359]">{label as string}</h6>
                  {(items as string[]).map((item, index) => <div className={`rounded-md px-3 py-1.5 text-sm ${index === 0 && label === "Content" ? "border bg-card font-medium" : "text-[#2e3a30]"}`} key={item}>{item}</div>)}
                </div>
              ))}
            </aside>

            <div className="min-w-0 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold tracking-[-0.01em]">Posts</h2>
                <div className="flex flex-wrap items-center gap-2 self-center">
                  <div className="hidden rounded-lg border bg-[#faf8f1] p-1 text-xs text-[#5a6359] sm:flex"><span className="rounded-md border bg-card px-2 py-1 text-foreground">All 142</span><span className="px-2 py-1">Published 119</span><span className="px-2 py-1">Drafts 7</span></div>
                  <Button size="sm">New post</Button>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border bg-card">
                <div className="grid grid-cols-[minmax(0,1fr)_92px_90px] items-center gap-4 border-b bg-[#faf8f1] px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-[#5a6359] sm:grid-cols-[minmax(0,1fr)_104px_126px_72px_82px]">
                  <span>Title</span><span>Status</span><span className="hidden sm:block">Actor</span><span className="hidden sm:block">Rev</span><span className="text-right">Updated</span>
                </div>
                {posts.map(([title, status, actorType, actor, rev, updated]) => (
                  <div className="grid grid-cols-[minmax(0,1fr)_92px_90px] items-center gap-4 border-b px-5 py-3 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_104px_126px_72px_82px]" key={title}>
                    <div className="min-w-0 truncate">▱ {title}</div>
                    <span className={`w-fit rounded-full border px-2 py-0.5 font-mono text-[10px] ${status === "Published" ? "border-green-200 bg-green-50 text-green-700" : status === "Draft" ? "border-amber-200 bg-amber-50 text-amber-700" : "bg-[#faf8f1] text-[#2e3a30]"}`}>{status}</span>
                    <span className="hidden items-center gap-1.5 font-mono text-xs text-[#2e3a30] sm:flex"><span className={`grid size-5 place-items-center rounded-full text-[9px] ${actorType === "agent" ? "border bg-[#ece7d6] text-primary" : "bg-primary text-primary-foreground"}`}>{actorType === "agent" ? "AI" : actor.slice(0, 2).toUpperCase()}</span>{actor}</span>
                    <span className="hidden font-mono text-xs text-[#5a6359] sm:block">{rev}</span>
                    <span className="text-right font-mono text-xs text-[#5a6359]">{updated}</span>
                  </div>
                ))}
              </div>
            </div>

            <aside className="hidden border-l bg-[#faf8f1] p-4 lg:block">
              <RailPanel title="Active keys">
                {["vc_copybot_prod", "vc_seo_assistant", "vc_site_reader"].map((key, index) => (
                  <div className="border-b px-3 py-3 last:border-b-0" key={key}>
                    <div className="flex items-center justify-between gap-3 font-mono text-[13px]"><span><span className="text-primary">vc_</span>{key.replace("vc_", "")}</span><span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] text-green-700">live</span></div>
                    <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px]"><span className="rounded border border-green-200 bg-green-50 px-1.5 text-green-700">posts:{index === 2 ? "read" : "write"}</span><span className="rounded border bg-[#faf8f1] px-1.5 text-[#5a6359]">MCP enabled</span></div>
                  </div>
                ))}
              </RailPanel>
              <RailPanel title="Activity">
                {["copy-bot updated intro", "mira published v3", "seo-bot updated meta", "jonas uploaded cover"].map((event, index) => (
                  <div className="grid grid-cols-[22px_1fr_auto] gap-2 border-b px-3 py-2.5 text-[13px] last:border-b-0" key={event}><span className="grid size-5 place-items-center rounded-full border bg-[#ece7d6] font-mono text-[9px] text-primary">{index === 1 || index === 3 ? "HU" : "AI"}</span><span>{event}</span><span className="font-mono text-[11px] text-[#5a6359]">{index + 1}h</span></div>
                ))}
              </RailPanel>
            </aside>
          </div>
        </section>
      </header>

      <Section id="product" eyebrow="The problem" title={<><span>Every simple blog CMS was built for </span><em className="font-serif font-normal italic text-primary">one human cursor</em><span>. Yours has agents now.</span></>} lede="The dashboard still matters. But the API boundary matters just as much when assistants create drafts, update metadata, and operate your blog while you sleep.">
        <div className="grid gap-4 md:grid-cols-3">
          {problemCards.map((card) => (
            <Card className="rounded-2xl shadow-none" key={card.title}>
              <CardHeader><p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">{card.kicker}</p><CardTitle className="text-xl font-medium leading-6 tracking-[-0.015em]">{card.title}</CardTitle></CardHeader>
              <CardContent className="text-sm leading-6 text-muted-foreground"><p>{card.body}</p><MiniRows rows={card.rows} /></CardContent>
            </Card>
          ))}
        </div>
      </Section>

      <Section id="self-host" eyebrow="Open source" title="Use VibeCMS Cloud, or bring your own Cloudflare account." lede="The codebase supports both modes. Hosted sells convenience; self-hosting gives developers trust, inspection, and control.">
        <div className="grid overflow-hidden rounded-2xl border bg-card lg:grid-cols-2">
          <div className="border-b p-7 lg:border-b-0 lg:border-r lg:p-9">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">VibeCMS Cloud</p>
            <h3 className="mt-4 text-balance text-3xl font-medium tracking-[-0.03em]">Managed hosting for people who just want the blog live.</h3>
            <p className="mt-4 leading-7 text-muted-foreground">No Cloudflare setup, no Wrangler commands, no migration chores, no billing wiring. Sign up, create the blog, publish.</p>
            <div className="mt-6 rounded-xl border bg-[#faf8f1] p-4 font-mono text-xs leading-6">
              <p>mode = hosted</p>
              <p>billing = Polar trial/subscription</p>
              <p>media = 500MB trial → 5GB paid</p>
            </div>
          </div>
          <div className="bg-[#faf8f1] p-7 lg:p-9">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">Self-host</p>
            <h3 className="mt-4 text-balance text-3xl font-medium tracking-[-0.03em]">Deploy the same single-blog product to your own Worker.</h3>
            <p className="mt-4 leading-7 text-muted-foreground">Root deploy config, D1 migrations, R2 media, and <code className="rounded border bg-card px-1.5 py-0.5 font-mono text-xs">SELF_HOSTED=true</code>. Polar is not required.</p>
            <div className="mt-6 rounded-xl border bg-card p-4 font-mono text-xs leading-6">
              <p>pnpm build:self-host</p>
              <p>wrangler d1 migrations apply DB --remote</p>
              <p>wrangler deploy</p>
            </div>
          </div>
        </div>
      </Section>

      <Section id="agents" eyebrow="Product" title="Three primitives. The rest stays intentionally boring." lede="VibeCMS is small on purpose: one hosted blog, controlled write access, and history you can trust.">
        <div className="overflow-hidden rounded-2xl border bg-card">
          {featureBlocks.map((feature, index) => (
            <div className="grid gap-8 border-b p-6 last:border-b-0 md:grid-cols-[0.9fr_1.1fr] md:p-9" key={feature.title}>
              <div className={index % 2 ? "md:order-2" : ""}>
                <p className="mb-4 font-mono text-xs uppercase tracking-[0.12em] text-primary">{feature.tag}</p>
                <h3 className="text-balance text-3xl font-medium leading-tight tracking-[-0.025em]">{feature.title}</h3>
                <p className="mt-4 leading-7 text-muted-foreground">{feature.body}</p>
                <ul className="mt-5 space-y-3">
                  {feature.points.map((point) => <li className="flex gap-3 text-sm leading-6 text-[#2e3a30]" key={point}><Check />{point}</li>)}
                </ul>
              </div>
              <FeatureMock index={index} />
            </div>
          ))}
        </div>
      </Section>

      <Section id="workflow" eyebrow="Workflow" title={<><span>From prompt to published, with a </span><em className="font-serif font-normal italic text-primary">human checkpoint</em><span>.</span></>} lede="A serious user can understand VibeCMS in one session: sign up, create a blog, publish a post, upload an image, connect MCP/API, and inspect the activity trail.">
        <div className="grid overflow-hidden rounded-2xl border bg-card lg:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b lg:border-b-0 lg:border-r">
            {["Create blog during onboarding", "Start card-required 7-day trial", "Draft or let an agent draft", "Review activity + versions", "Publish to hosted blog"].map((step, index) => (
              <div className={`grid grid-cols-[32px_1fr] gap-4 border-b p-5 last:border-b-0 ${index < 3 ? "bg-[#fbf9f2]" : ""}`} key={step}>
                <span className={`grid size-7 place-items-center rounded-full border font-mono text-xs ${index < 3 ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}>{index + 1}</span>
                <div><h3 className="font-medium tracking-[-0.01em]">{step}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{workflowDescription(index)}</p></div>
              </div>
            ))}
          </div>
          <div className="bg-[#faf8f1] p-6">
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b bg-[#fbf9f2] px-4 py-3 font-mono text-xs text-muted-foreground"><span>activity · launch-post</span><span>+82 / -34</span></div>
              <div className="p-5 text-sm leading-7">
                <h3 className="mb-2 text-lg font-medium tracking-[-0.01em]">Launch notes</h3>
                <p className="text-muted-foreground">A post moves from draft to published with every important action recorded.</p>
                <div className="mt-5 rounded-lg border bg-[#faf8f1] p-4 font-mono text-xs leading-6">
                  <p><span className="text-red-700">−</span> <span className="rounded bg-red-50 px-1 text-red-700 line-through">The product is an AI writing tool.</span></p>
                  <p><span className="text-green-700">+</span> <span className="rounded bg-green-50 px-1 text-green-700">The product is a CMS agents can safely operate.</span></p>
                </div>
                <div className="mt-5 space-y-2 font-mono text-xs">
                  {[["09:14", "copy-bot created draft v9"], ["09:16", "seo-bot updated excerpt"], ["10:02", "mira reviewed v14"], ["10:18", "mira published post"]].map(([time, event]) => <div className="grid grid-cols-[58px_1fr] border-b border-dashed pb-2 last:border-0" key={event}><span className="text-muted-foreground">{time}</span><span>{event}</span></div>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section id="pricing" eyebrow="Pricing" title="One plan. Everything a single-blog product needs." lede="No usage-limit anxiety on the public page. Abuse controls stay internal; users get a simple promise.">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Card className="overflow-hidden rounded-2xl shadow-none">
            <div className="h-1 bg-primary" />
            <CardHeader>
              <div className="flex items-center justify-between"><p className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">VibeCMS</p><Badge className="rounded-full bg-[#e6ede6] text-primary" variant="outline">7-day trial</Badge></div>
              <div className="flex items-end gap-3 pt-3"><span className="text-6xl font-medium tracking-[-0.04em]">$9</span><span className="pb-2 text-muted-foreground">/ month</span></div>
              <p className="font-mono text-sm text-muted-foreground">or $99/year · card required · cancel anytime</p>
            </CardHeader>
            <CardContent>
              <Button asChild className="h-11 w-full rounded-xl text-[15px] font-medium shadow-none" size="lg"><a href="/app">Start free trial →</a></Button>
              <ul className="mt-6 grid gap-3 border-t pt-6 text-sm text-[#2e3a30] sm:grid-cols-2">
                {["1 hosted blog", "Unlimited posts", "5GB media storage after subscription", "500MB trial media", "MCP/API access", "Activity history", "Post version history", "Fair-use hosting"].map((item) => <li className="flex gap-2" key={item}><Check />{item}</li>)}
              </ul>
              <div className="mt-6 space-y-2 border-t border-dashed pt-5 font-mono text-xs text-muted-foreground"><p>Fair-use hosting included.</p><p>No native video hosting or generic file hosting.</p><p>Trial blogs are noindex until paid.</p></div>
            </CardContent>
          </Card>
          <div>
            <h3 className="text-balance text-3xl font-medium tracking-[-0.025em]">Why this is the sweet spot.</h3>
            <p className="mt-4 leading-7 text-muted-foreground">$9 keeps the product impulse-buy simple. 5GB media feels fair for a real blog without inviting file-storage abuse. A 7-day card-required trial is enough because users can reach value in one session.</p>
            <div className="mt-6 grid gap-3">
              {[["Allowed media", "jpg, jpeg, png, webp, gif"], ["Max image size", "10MB"], ["Paid storage", "5GB per blog"], ["Excluded", "video hosting, zip/exe/dmg, generic files"]].map(([key, value]) => <div className="grid grid-cols-[130px_1fr] border-b pb-3 text-sm" key={key}><span className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">{key}</span><span>{value}</span></div>)}
            </div>
          </div>
        </div>
      </Section>

      <Section id="faq" eyebrow="FAQ" title="The honest FAQ.">
        <div className="border-t">
          {faqs.map(([question, answer], index) => <details className="border-b py-5" key={question} open={index === 0}><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium tracking-[-0.01em] marker:hidden">{question}<span className="grid size-6 place-items-center rounded-full border font-mono text-sm text-muted-foreground">+</span></summary><p className="mt-3 max-w-3xl leading-7 text-muted-foreground">{answer}</p></details>)}
        </div>
      </Section>

      <section className="bg-primary py-20 text-primary-foreground">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <h2 className="max-w-3xl text-balance text-4xl font-medium leading-tight tracking-[-0.035em] sm:text-5xl">Stop fighting your CMS. <em className="font-serif font-normal italic text-[#c9d9c0]">Start vibing.</em></h2>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-primary-foreground/75">Create a blog, publish the first post, and give a trusted agent a scoped way to help.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Button asChild className="h-11 rounded-xl px-5 text-[15px] font-medium shadow-none" size="lg" variant="secondary"><a href="/app">Start trial →</a></Button><Button asChild className="h-11 rounded-xl border-primary-foreground/35 bg-transparent px-5 text-[15px] font-medium text-primary-foreground shadow-none hover:bg-primary-foreground/10" size="lg" variant="outline"><a href="/login">Sign in</a></Button></div>
        </div>
      </section>

      <footer className="border-t bg-[#faf8f1] py-12">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 text-sm sm:px-8 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div><a className="mb-4 flex items-center gap-3 font-semibold" href="/"><span className="grid size-7 place-items-center rounded-lg bg-primary font-mono text-xs text-primary-foreground">v</span>VibeCMS</a><p className="max-w-xs leading-6 text-muted-foreground">A minimal hosted blog CMS for humans and AI agents.</p></div>
          {["Product", "Developers", "Company"].map((group) => <div key={group}><h3 className="mb-3 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">{group}</h3><div className="space-y-2 text-[#2e3a30]"><a className="block" href="#product">Product</a><a className="block" href="#agents">MCP/API</a><a className="block" href="#pricing">Pricing</a></div></div>)}
        </div>
      </footer>
    </main>
  );
};

const Section = ({ id, eyebrow, title, lede, children }: { id: string; eyebrow: string; title: React.ReactNode; lede?: string; children: React.ReactNode }) => (
  <section className="border-t py-20" id={id}>
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <p className="mb-5 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground before:h-px before:w-5 before:bg-muted-foreground">{eyebrow}</p>
      <h2 className="max-w-3xl text-balance text-3xl font-medium leading-tight tracking-[-0.03em] sm:text-5xl">{title}</h2>
      {lede ? <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">{lede}</p> : null}
      <div className="mt-12">{children}</div>
    </div>
  </section>
);

const RailPanel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mb-4 overflow-hidden rounded-xl border bg-card">
    <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-medium"><span>{title}</span><span className="font-mono text-[11px] text-[#5a6359]">manage →</span></div>
    {children}
  </div>
);

const FeatureMock = ({ index }: { index: number }) => {
  const header = ["editor · launch-post.md", "tokens · vc_copybot_prod", "history · launch-post"][index];
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-[0_18px_35px_-30px_rgba(15,26,20,0.25)]">
      <div className="flex items-center gap-2 border-b bg-[#fbf9f2] px-4 py-3 font-mono text-xs text-muted-foreground"><span className="flex gap-1"><i className="size-2 rounded-full bg-border" /><i className="size-2 rounded-full bg-border" /><i className="size-2 rounded-full bg-border" /></span>{header}</div>
      {index === 0 ? <EditorMock /> : index === 1 ? <TokenMock /> : <HistoryMock />}
    </div>
  );
};

const EditorMock = () => <div className="grid min-h-80 grid-cols-[44px_1fr] font-mono text-xs leading-7"><div className="border-r py-4 text-right text-muted-foreground">{Array.from({ length: 10 }, (_, i) => <div className="px-3" key={i}>{i + 1}</div>)}</div><div className="p-4"><p className="font-semibold text-primary"># Launch notes</p><p className="text-muted-foreground">&lt;!-- updated by vc_copybot, reviewed by mira --&gt;</p><br /><p className="font-semibold">## A CMS agents can safely operate</p><p>VibeCMS keeps the blog simple while exposing a controlled MCP/API surface.</p><br /><p className="inline-flex rounded border bg-[#faf8f1] px-2 text-muted-foreground">cover.webp · 10MB max</p><p>Humans publish. Agents help. History stays readable.</p></div></div>;

const TokenMock = () => <div className="space-y-3 p-5 font-mono text-xs"><div className="flex justify-between text-muted-foreground"><span>scope · /journal</span><span>last used 2m ago</span></div><div className="rounded-xl border bg-[#faf8f1] p-4"><div className="mb-3 flex justify-between"><span><span className="text-primary">vc_</span>copybot_prod</span><span className="text-green-700">● live</span></div>{["posts:create", "posts:update", "media:read", "billing:write", "settings:write"].map((scope, index) => <div className="mb-2 flex items-center justify-between rounded-md border bg-card px-3 py-2 last:mb-0" key={scope}><span>{scope}</span><span className={`h-4 w-8 rounded-full ${index < 3 ? "bg-primary" : "bg-border"}`} /></div>)}</div><div className="flex justify-between text-muted-foreground"><span>rate · fair-use</span><span>revokable instantly</span></div></div>;

const HistoryMock = () => <div className="space-y-1 p-4 text-sm">{[["v14", "AI", "copy-bot updated intro", "+82 / -34"], ["v13", "MR", "mira fixed lede", "+12 / -8"], ["v12", "AI", "seo-bot updated meta", "frontmatter"], ["v11", "JO", "jonas added cover", "+1 image"], ["v10", "AI", "copy-bot first draft", "+940"]].map(([version, actor, event, diff], index) => <div className={`grid grid-cols-[46px_1fr_auto] items-center gap-3 rounded-md border-b px-2 py-3 last:border-b-0 ${index === 0 ? "bg-[#e6ede6]" : ""}`} key={version}><span className="rounded border bg-card px-2 py-1 font-mono text-xs text-primary">{version}</span><span className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full border bg-[#ece7d6] font-mono text-[9px] text-primary">{actor}</span>{event}</span><span className="font-mono text-xs text-muted-foreground">{diff}</span></div>)}</div>;

const workflowDescription = (index: number) => [
  "New users are guided into the minimum setup needed to organize the hosted blog.",
  "Checkout creates the real Polar trial; unpaid accounts do not bypass into the app.",
  "Humans use the dashboard, agents use scoped MCP/API access.",
  "Activity and post versions show what changed and who changed it.",
  "Paid or active trial users can publish; trial sites stay noindex.",
][index];
