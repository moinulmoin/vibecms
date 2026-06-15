import { BRAND } from '@vc/config'
import type { FormStatus } from '@vc/config'
import { ActivityLogIcon, DashboardIcon, FileTextIcon, GearIcon, ImageIcon } from '@radix-ui/react-icons'
import { Alert, Button, cn } from '@vc/ui'
import { Link, useRouterState } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { DotGrid, Glow } from '~/components/dashboard/DashboardPrimitives'
import { LogoutButton } from '~/components/dashboard/LogoutButton'

type MaxWidth = 'md' | 'lg' | 'xl' | 'dashboard'

type NavItem = { label: string; to: string; Icon: typeof DashboardIcon }

const navItems: NavItem[] = [
  { label: 'Overview', to: '/app', Icon: DashboardIcon },
  { label: 'Posts', to: '/app/posts', Icon: FileTextIcon },
  { label: 'Media', to: '/app/media', Icon: ImageIcon },
  { label: 'Activity', to: '/app/activity', Icon: ActivityLogIcon },
  { label: 'Settings', to: '/app/settings', Icon: GearIcon },
]

const maxWidths: Record<MaxWidth, string> = {
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
  dashboard: 'max-w-7xl',
}

const dateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
const dateTimeFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function toDate(value: number | string | Date) {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value * 1000)
  return new Date(value)
}

export function formatDate(value: number | string | Date) {
  return dateFormatter.format(toDate(value))
}

export function formatDateTime(value: number | string | Date) {
  return dateTimeFormatter.format(toDate(value))
}

export function labelAction(action: string) {
  return action.replaceAll('.', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function StatusAlert({ status }: { status: FormStatus | null }) {
  if (!status) return null
  return (
    <Alert variant={status.variant} title={status.title}>
      {status.message}
    </Alert>
  )
}

function AppFrame({ children, maxWidth = 'dashboard' }: { children: ReactNode; maxWidth?: MaxWidth }) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden bg-background text-foreground">
      <DotGrid className="fixed inset-0 z-0" />
      <Glow className="fixed z-0 opacity-70" />
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:ring-2 focus:ring-ring"
        href="#main"
      >
        Skip to main content
      </a>
      <main
        id="main"
        tabIndex={-1}
        className="relative z-10 min-h-dvh scroll-mt-4 focus:outline-none"
      >
        <div
          className={cn(
            'mx-auto w-full px-4 py-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 lg:px-8',
            maxWidths[maxWidth],
          )}
        >
          {children}
        </div>
      </main>
    </div>
  )
}

function BrandLockup({ siteName, compact = false }: { siteName?: string; compact?: boolean }) {
  return (
    <Link
      to="/app"
      className={cn(
        'flex items-center gap-3 rounded-xl p-3 text-foreground no-underline ring-1 ring-[color:var(--hairline)] transition-colors [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] hover:ring-primary/30',
        compact && 'p-2.5',
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-mono text-xs font-semibold text-primary-foreground shadow-sm">
        vc
      </span>
      <span className="min-w-0">
        <span className="block truncate font-display text-sm font-semibold tracking-[-0.01em]">
          {siteName ?? BRAND.name}
        </span>
        <span className="block truncate font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {BRAND.name}
        </span>
      </span>
    </Link>
  )
}

function NavLinks({ current }: { current: string }) {
  return (
    <nav className="grid gap-1" aria-label="Dashboard navigation">
      {navItems.map(({ label, to, Icon }) => {
        const active = current === to || (to !== '/app' && current.startsWith(to))
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            data-active={active}
            className="group flex min-h-11 items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-sm font-medium text-muted-foreground no-underline transition-colors hover:border-border hover:bg-accent hover:text-accent-foreground data-[active=true]:border-border data-[active=true]:text-foreground data-[active=true]:[background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] data-[active=true]:ring-1 data-[active=true]:ring-[color:var(--hairline)]"
          >
            <span className="grid size-7 place-items-center rounded-md bg-muted text-muted-foreground group-data-[active=true]:bg-brand-bright group-data-[active=true]:text-brand-bright-foreground">
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function SeparatorLine() {
  return <div className="my-4 h-px bg-[color:var(--hairline)]" />
}

export function AppShell({
  children,
  current: currentProp,
  siteName,
  userEmail,
  authUrl,
}: {
  children: ReactNode
  current?: string
  siteName?: string
  userEmail?: string
  authUrl: string
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = currentProp ?? pathname

  return (
    <AppFrame maxWidth="dashboard">
      <div className="grid gap-4 md:grid-cols-[15.5rem_minmax(0,1fr)] md:gap-6">
        <aside className="md:sticky md:top-4 md:h-[calc(100dvh-2rem)]">
          <div className="hidden h-full flex-col rounded-2xl p-3 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] md:flex">
            <BrandLockup siteName={siteName} />
            <SeparatorLine />
            <div className="px-3 pb-2 font-mono text-[0.68rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Workspace
            </div>
            <NavLinks current={current} />
            <div className="mt-auto rounded-xl p-3 ring-1 ring-[color:var(--hairline)] bg-background/80">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Markdown-first
              </p>
              <p className="mt-2 text-sm leading-5 text-foreground">
                Posts, media, versions, and scoped agent access stay in one calm workspace.
              </p>
            </div>
            <div className="mt-3 flex flex-col gap-2 px-1">
              {userEmail ? (
                <p className="truncate font-mono text-[11px] leading-5 text-muted-foreground">{userEmail}</p>
              ) : null}
              <LogoutButton authUrl={authUrl} />
            </div>
          </div>
          <details className="rounded-2xl p-3 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))] md:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
              <BrandLockup siteName={siteName} compact />
              <span className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground">
                Menu
              </span>
            </summary>
            <div className="mt-3 border-t border-border pt-3">
              <NavLinks current={current} />
              {userEmail ? (
                <p className="mt-3 truncate px-3 font-mono text-[11px] leading-5 text-muted-foreground">{userEmail}</p>
              ) : null}
              <div className="mt-2 px-3">
                <LogoutButton authUrl={authUrl} />
              </div>
            </div>
          </details>
        </aside>
        <section className="min-w-0">
          <div className="grid gap-4">{children}</div>
        </section>
      </div>
    </AppFrame>
  )
}

export function PageHeader({
  kicker,
  title,
  description,
  action,
}: {
  kicker: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-brand-bright">{kicker}</p>
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">{title}</h1>
        {description ? <p className="max-w-2xl text-pretty font-sans text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  )
}

export function StatCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <div className="rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {detail ? <p className="mt-1 font-sans text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

export function Panel({
  title,
  meta,
  children,
  className,
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-2xl p-4 shadow-sm ring-1 ring-[color:var(--hairline)] [background:linear-gradient(180deg,var(--surface-panel-from),var(--surface-panel-to))]',
        className,
      )}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
        {meta}
      </div>
      {children}
    </section>
  )
}

export function DataRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid gap-2 rounded-xl border border-border/60 bg-background/50 px-3 py-2.5 text-sm sm:items-center',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
      <p className="font-display text-base font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

export { Button }