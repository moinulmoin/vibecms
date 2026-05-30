import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from "@vc/ui";

const navItems = [
  ["Dashboard", "/app", "⌁"],
  ["Posts", "/app/posts", "¶"],
  ["Media", "/app/media", "▧"],
  ["Activity", "/app/activity", "↺"],
  ["Settings", "/app/settings", "⚙"],
] as const;

export function AppShell({ children, current = "/app", siteName = "VibeCMS", userEmail }: { children: React.ReactNode; current?: string; siteName?: string; userEmail?: string }) {
  return (
    <main className="min-h-screen bg-[#f4f1e8] text-foreground md:grid md:grid-cols-[15.5rem_1fr]">
      <aside className="sticky top-0 z-20 border-b border-[#d2cab3] bg-[#faf8f1]/95 p-3 backdrop-blur md:h-screen md:border-b-0 md:border-r">
        <div className="flex h-full flex-col md:p-1">
          <a href="/app" className="flex items-center gap-3 rounded-xl border border-[#d2cab3] bg-card p-3 text-foreground no-underline hover:border-primary/40">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-mono text-xs font-semibold text-primary-foreground">v</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-[-0.01em]">{siteName}</span>
              <span className="block truncate font-mono text-[11px] uppercase tracking-[0.12em] text-[#5a6359]">VibeCMS</span>
            </span>
          </a>
          <div className="my-4 h-px bg-[#e2dcc9]" />
          <div className="px-3 pb-2 font-mono text-[0.68rem] font-medium uppercase tracking-[0.16em] text-[#5a6359]">Workspace</div>
          <nav className="grid gap-1">
            {navItems.map(([label, href, icon]) => {
              const active = current === href || (href !== "/app" && current.startsWith(href));
              return (
                <a key={href} href={href} data-active={active} className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium text-[#5a6359] no-underline transition-colors hover:border-[#e2dcc9] hover:bg-card hover:text-foreground data-[active=true]:border-[#c8bea4] data-[active=true]:bg-card data-[active=true]:text-foreground">
                  <span className="grid size-6 place-items-center rounded-md bg-[#ece7d6] font-mono text-[13px] text-[#5a6359] group-data-[active=true]:bg-primary group-data-[active=true]:text-primary-foreground">{icon}</span>
                  <span>{label}</span>
                </a>
              );
            })}
          </nav>
          <div className="mt-auto hidden p-3 md:block">
            <div className="rounded-xl border border-[#d2cab3] bg-card p-3 pb-4">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#5a6359]">Launch path</p>
              <div className="mt-3 grid gap-2 text-sm leading-5">
                <span>Create first post</span>
                <span>Upload cover image</span>
                <span>Connect agent token</span>
              </div>
            </div>
            {userEmail ? <p className="mt-3 px-1 font-mono text-[11px] leading-5 text-[#5a6359]">Signed in</p> : null}
          </div>
        </div>
      </aside>
      <section className="min-w-0 p-4 md:p-6 lg:p-8">
        <div className="mx-auto grid max-w-7xl gap-4">{children}</div>
      </section>
    </main>
  );
}

export function PageHeader({ kicker, title, description, action }: { kicker: string; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <header className="rounded-2xl border border-[#d2cab3] bg-card p-5 md:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-[#5a6359]">{kicker}</p>
          <h1 className="max-w-4xl text-balance text-2xl font-medium tracking-[-0.035em] md:text-3xl">{title}</h1>
          {description ? <p className="mt-3 max-w-2xl text-pretty text-sm leading-6 text-[#5a6359]">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2 sm:pt-1">{action}</div> : null}
      </div>
    </header>
  );
}

export function StatCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <Card className="rounded-2xl border-[#d2cab3] shadow-none">
      <CardHeader className="p-4 pb-2"><CardTitle className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#5a6359]">{label}</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0"><p className="text-2xl font-medium tracking-[-0.035em]">{value}</p>{detail ? <p className="mt-2 break-all font-mono text-xs leading-5 text-[#5a6359]">{detail}</p> : null}</CardContent>
    </Card>
  );
}

export function Panel({ title, meta, children, className }: { title: string; meta?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("overflow-hidden rounded-2xl border-[#d2cab3] shadow-none", className)}>
      <CardHeader className="flex-row items-center justify-between gap-4 space-y-0 border-b border-[#e2dcc9] bg-[#fbf9f2] px-4 py-3 md:px-5">
        <CardTitle className="text-base font-medium tracking-[-0.01em]">{title}</CardTitle>
        {meta ? <div className="flex items-center font-mono text-xs leading-none text-[#5a6359]">{meta}</div> : null}
      </CardHeader>
      <CardContent className="p-4 md:p-6">{children}</CardContent>
    </Card>
  );
}

export function DataRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid items-center gap-3 border-b border-[#ece7d6] px-3 py-3.5 text-sm text-[#5a6359] last:border-b-0 odd:bg-[#fffdfa]", className)}>{children}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#d2cab3] bg-[#faf8f1] p-6 text-center">
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#5a6359]">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export { Button };
