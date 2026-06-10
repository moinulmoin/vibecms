import { Card, CardContent, CardHeader, CardDescription } from "@vc/ui";
import { AuthForm } from "./auth-form";
import { PRICING, BRAND, MEDIA } from "@vc/config";

export const AuthPage = ({ ctx }: { ctx: { authUrl?: string } }) => {
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg lg:grid-cols-[1.05fr_.95fr]">
        {/* Left marketing panel */}
        <section className="relative hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
          <div className="relative z-10">
            <a href="/" className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm font-semibold tracking-[-0.03em] no-underline backdrop-blur">
              {BRAND.name}
            </a>
            <h1 className="mt-16 max-w-xl text-balance text-5xl font-semibold leading-[0.95] tracking-[-0.04em]">
              Run a blog yourself. Let trusted agents help safely.
            </h1>
            <p className="mt-6 max-w-lg text-pretty text-lg leading-8 text-primary-foreground/70">
              A hosted blog CMS with scoped MCP writes, REST reads, activity history, and post versions built into every content change.
            </p>
          </div>
          <Card className="relative z-10 grid gap-3 rounded-xl border-white/15 bg-white/10 p-5 text-sm text-white/80 shadow-none backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <span>Launch plan</span>
              <strong className="text-white">{PRICING.monthlyLabel} &middot; {PRICING.trialDays}-day trial</strong>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-black/15 p-4">
                <strong className="block text-2xl text-white">{MEDIA.paidStorageLabel}</strong>
                <span>paid media storage</span>
              </div>
              <div className="rounded-lg bg-black/15 p-4">
                <strong className="block text-2xl text-white">MCP</strong>
                <span>agent access tokens</span>
              </div>
            </div>
          </Card>
        </section>

        {/* Right auth form */}
        <section className="flex items-center justify-center p-6 sm:p-10 lg:p-14">
          <Card className="w-full max-w-md border-0 bg-transparent shadow-none">
            <a href="/" className="mb-10 inline-flex text-sm font-semibold tracking-[-0.03em] no-underline lg:hidden">
              {BRAND.name}
            </a>
            <CardHeader className="p-0">
              <CardDescription className="text-pretty text-sm leading-6">
                Sign in to publish posts, upload images, and issue scoped agent tokens for trusted assistants.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <AuthForm authUrl={ctx.authUrl ?? "/"} />
              <p className="mt-8 text-xs leading-5 text-muted-foreground">
                Trial sites are noindexed. Publishing and media uploads require an active trial or subscription.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
};
