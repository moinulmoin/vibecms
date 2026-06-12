import { BRAND } from "@vc/config";
import type { FormStatus } from "@vc/config";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, cn } from "@vc/ui";
import type { ReactNode } from "react";
import { ActivityLogIcon, DashboardIcon, FileTextIcon, GearIcon, ImageIcon } from "@radix-ui/react-icons";

type MaxWidth = "md" | "lg" | "xl" | "dashboard";

type NavItem = {
  label: string;
  href: string;
  Icon: typeof DashboardIcon;
};

const navItems: NavItem[] = [
  { label: "Overview", href: "/app", Icon: DashboardIcon },
  { label: "Posts", href: "/app/posts", Icon: FileTextIcon },
  { label: "Media", href: "/app/media", Icon: ImageIcon },
  { label: "Activity", href: "/app/activity", Icon: ActivityLogIcon },
  { label: "Settings", href: "/app/settings", Icon: GearIcon },
];

const maxWidths: Record<MaxWidth, string> = {
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  dashboard: "max-w-7xl",
};

const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export function formatDate(value: number | string | Date) {
  return dateFormatter.format(toDate(value));
}

export function formatDateTime(value: number | string | Date) {
  return dateTimeFormatter.format(toDate(value));
}

function toDate(value: number | string | Date) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value * 1000);
  return new Date(value);
}

export function labelAction(action: string) {
  return action.replaceAll(".", " ").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function StatusAlert({ status }: { status: FormStatus | null }) {
  if (!status) return null;
  return (
    <Alert variant={status.variant} title={status.title}>
      {status.message}
    </Alert>
  );
}

export function AppFrame({ children, maxWidth = "dashboard" }: { children: ReactNode; maxWidth?: MaxWidth }) {
  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-64 bg-primary/5 blur-3xl" aria-hidden="true" />
      <a className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg" href="#main">
        Skip to main content
      </a>
      <main id="main" tabIndex={-1} className="relative min-h-dvh scroll-mt-4 focus:outline-none">
        <div className={cn("mx-auto w-full px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8", maxWidths[maxWidth])}>
          {children}
        </div>
      </main>
    </div>
  );
}

function BrandLockup({ siteName, compact = false }: { siteName?: string; compact?: boolean }) {
  return (
    <a href="/app" className={cn("flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-foreground no-underline transition-colors hover:border-primary/40 hover:bg-accent", compact && "p-2.5")}>
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-mono text-xs font-semibold text-primary-foreground">vc</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold tracking-[-0.01em]">{siteName ?? BRAND.name}</span>
        <span className="block truncate font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{BRAND.name}</span>
      </span>
    </a>
  );
}

function NavLinks({ current }: { current: string }) {
  return (
    <nav className="grid gap-1" aria-label="Dashboard navigation">
      {navItems.map(({ label, href, Icon }) => {
        const active = current === href || (href !== "/app" && current.startsWith(href));
        return (
          <a
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            data-active={active}
            className="group flex min-h-11 items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground no-underline transition-colors hover:border-border hover:bg-accent hover:text-accent-foreground data-[active=true]:border-border data-[active=true]:bg-card data-[active=true]:text-foreground"
          >
            <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground group-data-[active=true]:bg-primary group-data-[active=true]:text-primary-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span>{label}</span>
          </a>
        );
      })}
    </nav>
  );
}

export function DashboardShell({ children, current = "/app", siteName, userEmail }: { children: ReactNode; current?: string; siteName?: string; userEmail?: string }) {
  return (
    <AppFrame maxWidth="dashboard">
      <div className="grid gap-4 md:grid-cols-[15.5rem_minmax(0,1fr)] md:gap-6">
        <aside className="md:sticky md:top-4 md:h-[calc(100dvh-2rem)]">
          <div className="hidden h-full flex-col rounded-2xl border border-border bg-card p-3 shadow-sm md:flex">
            <BrandLockup siteName={siteName} />
            <SeparatorLine />
            <div className="px-3 pb-2 font-mono text-[0.68rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">Workspace</div>
            <NavLinks current={current} />
            <div className="mt-auto rounded-xl border border-border bg-background/80 p-3">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Markdown-first</p>
              <p className="mt-2 text-sm leading-5 text-foreground">Posts, media, versions, and scoped agent access stay in one calm workspace.</p>
            </div>
            {userEmail ? <p className="mt-3 truncate px-1 font-mono text-[11px] leading-5 text-muted-foreground">{userEmail}</p> : null}
          </div>
          <details className="rounded-2xl border border-border bg-card p-3 shadow-sm md:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <BrandLockup siteName={siteName} compact />
              <span className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground">Menu</span>
            </summary>
            <div className="mt-3 border-t border-border pt-3">
              <NavLinks current={current} />
              {userEmail ? <p className="mt-3 truncate px-3 font-mono text-[11px] leading-5 text-muted-foreground">{userEmail}</p> : null}
            </div>
          </details>
        </aside>
        <section className="min-w-0">
          <div className="grid gap-4">{children}</div>
        </section>
      </div>
    </AppFrame>
  );
}

export function AppShell(props: { children: ReactNode; current?: string; siteName?: string; userEmail?: string }) {
  return <DashboardShell {...props} />;
}

export function OnboardingFrame({ children, phase = "Setup" }: { children: ReactNode; phase?: string }) {
  return (
    <AppFrame maxWidth="xl">
      <div className="grid min-h-[calc(100dvh-2rem)] items-center gap-8 py-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="grid gap-6">
          <a href="/" className="w-fit text-sm font-semibold tracking-[-0.02em] text-foreground no-underline">{BRAND.name}</a>
          <Badge variant="outline" className="w-fit">{phase}</Badge>
          <div>
            <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{BRAND.tagline}</p>
            <h1 className="mt-4 max-w-xl text-balance text-4xl font-semibold tracking-[-0.05em] md:text-6xl">Set up a calm publishing system for humans and AI agents.</h1>
            <p className="mt-5 max-w-lg text-pretty text-sm leading-6 text-muted-foreground md:text-base">Configure the hosted blog, start the trial when needed, then manage posts, media, activity, and scoped agent access from one dashboard.</p>
          </div>
        </section>
        {children}
      </div>
    </AppFrame>
  );
}

function SeparatorLine() {
  return <div className="my-4 h-px bg-border" />;
}

export function PageHeader({ kicker, title, description, action }: { kicker: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="rounded-2xl border border-border bg-card/90 p-5 shadow-sm shadow-primary/5 md:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{kicker}</p>
          <h1 className="max-w-4xl text-balance text-2xl font-semibold tracking-[-0.035em] md:text-3xl">{title}</h1>
          {description ? <p className="mt-3 max-w-2xl text-pretty text-sm leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2 sm:pt-1">{action}</div> : null}
      </div>
    </header>
  );
}

export function StatCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="p-4 pb-2"><CardTitle className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0"><p className="text-2xl font-semibold tracking-[-0.035em]">{value}</p>{detail ? <p className="mt-2 break-all font-mono text-xs leading-5 text-muted-foreground">{detail}</p> : null}</CardContent>
    </Card>
  );
}

export function Panel({ title, meta, children, className }: { title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("overflow-hidden rounded-2xl border-border bg-card/90 shadow-sm shadow-primary/5", className)}>
      <CardHeader className="flex-col items-start justify-between gap-2 space-y-0 border-b border-border bg-muted/35 px-4 py-3 sm:flex-row sm:items-center md:px-5">
        <CardTitle className="text-base font-semibold tracking-[-0.01em]">{title}</CardTitle>
        {meta ? <div className="flex items-center font-mono text-xs leading-none text-muted-foreground">{meta}</div> : null}
      </CardHeader>
      <CardContent className="p-4 md:p-6">{children}</CardContent>
    </Card>
  );
}

export function DataRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-2 border-b border-border px-3 py-3.5 text-sm text-muted-foreground last:border-b-0 odd:bg-muted/25 md:items-center md:gap-3", className)}>{children}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export { Button };
