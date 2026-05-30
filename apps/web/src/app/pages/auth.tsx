import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@vc/ui";
import { AuthForm } from "./auth-form";

export const AuthPage = ({ ctx }: { ctx: { authUrl?: string } }) => {
  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,oklch(0.92_0.02_150),transparent_32rem),linear-gradient(135deg,oklch(0.985_0.006_95),oklch(0.96_0.012_95))] px-4 py-6 text-foreground sm:px-6 lg:p-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl overflow-hidden rounded-[2rem] border bg-card shadow-2xl shadow-black/10 lg:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(oklch(1_0_0/.22)_1px,transparent_1px),linear-gradient(90deg,oklch(1_0_0/.22)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="relative z-10">
            <a href="/" className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm font-black tracking-[-0.04em] text-white no-underline backdrop-blur">VibeCMS</a>
            <h1 className="mt-16 max-w-xl text-balance text-6xl font-black leading-[0.94] tracking-[-0.055em]">Run a blog yourself. Let trusted agents help safely.</h1>
            <p className="mt-6 max-w-lg text-pretty text-lg leading-8 text-white/72">A hosted blog CMS with scoped MCP/API access, activity history, and post versions built into every content change.</p>
          </div>
          <Card className="relative z-10 grid gap-3 rounded-3xl border-white/15 bg-white/10 p-5 text-sm text-white/78 shadow-none backdrop-blur">
            <div className="flex items-center justify-between border-b border-white/10 pb-3"><span>Launch plan</span><strong className="text-white">$9/month · 7-day trial</strong></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-black/15 p-4"><strong className="block text-2xl text-white">5GB</strong><span>paid media storage</span></div>
              <div className="rounded-2xl bg-black/15 p-4"><strong className="block text-2xl text-white">MCP</strong><span>agent access tokens</span></div>
            </div>
          </Card>
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10 lg:p-14">
          <Card className="w-full max-w-md border-0 bg-transparent shadow-none">
            <a href="/" className="mb-10 inline-flex text-sm font-black tracking-[-0.04em] text-foreground no-underline lg:hidden">VibeCMS</a>
            <CardHeader className="p-0">
              <CardDescription className="text-xs font-black uppercase tracking-[0.22em] text-primary">Workspace access</CardDescription>
              <CardTitle className="text-balance text-4xl font-black leading-none tracking-[-0.045em] sm:text-5xl">Welcome back.</CardTitle>
              <CardDescription className="text-pretty text-sm leading-6">Sign in to publish posts, upload images, and issue scoped MCP/API tokens for trusted agents.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <AuthForm authUrl={ctx.authUrl ?? "http://localhost:5173"} />
              <p className="mt-8 text-xs leading-5 text-muted-foreground">Trial sites are noindexed. Publishing and media uploads require an active trial or subscription.</p>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
};
