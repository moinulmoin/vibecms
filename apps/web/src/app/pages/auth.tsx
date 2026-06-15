import { CardContent, CardDescription, CardHeader } from "@vc/ui";
import { AuthForm } from "./auth-form";
import { PRICING, BRAND, MEDIA } from "@vc/config";
import { DotGrid, Glow, GreenCard, GlassCard, MonoEyebrow } from "./landing/primitives";

export const AuthPage = ({ ctx }: { ctx: { authUrl?: string; googleEnabled?: boolean } }) => {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-background px-4 py-6 text-foreground sm:px-6 lg:p-8">
      <DotGrid className="pointer-events-none fixed inset-0 z-0 opacity-70" />
      <Glow className="pointer-events-none fixed -top-[24%] left-1/2 z-0 size-[min(880px,110vw)] -translate-x-1/2 opacity-60" />
      <div className="relative z-10 mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg ring-1 ring-[color:var(--hairline)] lg:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between">
          <GreenCard className="flex min-h-full flex-col justify-between rounded-none p-10">
            <div className="relative z-10">
              <a
                href="/"
                className="inline-flex items-center rounded-full px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-brand-bright-foreground/90 no-underline ring-1 ring-brand-bright-foreground/25 [background:oklch(0.1823_0.0294_157.92/0.2)]"
              >
                {BRAND.name}
              </a>
              <MonoEyebrow className="mt-10 text-brand-bright-foreground/80" label="Sign in" />
              <h1 className="mt-4 max-w-xl text-balance font-display text-5xl font-semibold leading-[0.95] tracking-[-0.04em] text-brand-bright-foreground">
                Run a blog yourself. Let trusted agents help safely.
              </h1>
              <p className="mt-6 max-w-lg text-pretty font-sans text-lg leading-8 text-brand-bright-foreground/70">
                {BRAND.tagline} {BRAND.description}
              </p>
            </div>
            <GlassCard className="relative z-10 grid gap-3 rounded-xl p-5 text-sm text-brand-bright-foreground/80">
              <div className="flex items-center justify-between border-b border-brand-bright-foreground/15 pb-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em]">Launch plan</span>
                <strong className="font-display text-base text-brand-bright-foreground">{PRICING.monthlyLabel}</strong>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg p-4 ring-1 ring-brand-bright-foreground/15 [background:oklch(0.1823_0.0294_157.92/0.25)]">
                  <strong className="block font-display text-2xl text-brand-bright-foreground">{MEDIA.paidStorageLabel}</strong>
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-brand-bright-foreground/70">paid media storage</span>
                </div>
                <div className="rounded-lg p-4 ring-1 ring-brand-bright-foreground/15 [background:oklch(0.1823_0.0294_157.92/0.25)]">
                  <strong className="block font-display text-2xl text-brand-bright-foreground">MCP</strong>
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-brand-bright-foreground/70">agent access tokens</span>
                </div>
              </div>
            </GlassCard>
          </GreenCard>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10 lg:p-14 [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
          <div className="w-full max-w-md">
            <a href="/" className="mb-10 inline-flex font-display text-sm font-semibold tracking-[-0.03em] text-foreground no-underline lg:hidden">
              {BRAND.name}
            </a>
            <CardHeader className="p-0">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-brand-bright">Account</p>
              <CardDescription className="mt-3 text-pretty font-sans text-sm leading-6 text-muted-foreground">
                Sign in to publish posts, upload images, and issue scoped agent tokens for trusted assistants.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <AuthForm authUrl={ctx.authUrl ?? "/"} googleEnabled={ctx.googleEnabled ?? false} />
              <p className="mt-8 font-mono text-[11px] leading-5 text-muted-foreground">
                Publishing and media uploads require an active subscription. Self-host is free.
              </p>
            </CardContent>
          </div>
        </section>
      </div>
    </main>
  );
};