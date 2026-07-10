import { BRAND } from '@vc/config'
import type { FormStatus } from '@vc/config'
import {
  ActivityLogIcon,
  CaretSortIcon,
  DashboardIcon,
  ExitIcon,
  FileTextIcon,
  GearIcon,
  ImageIcon,
  Link2Icon,
} from '@radix-ui/react-icons'
import { Alert, Button, cn } from '@vc/ui'
import { Link, useRouterState } from '@tanstack/react-router'
import { useTransition, type ReactNode } from 'react'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '~/components/ui/sidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { Card } from "@vc/ui"
import { Separator } from "@vc/ui"
import { TooltipProvider } from '~/components/ui/tooltip'
import { setupAuthClient } from '~/lib/auth-client'

type NavItem = { label: string; to: string; Icon: typeof DashboardIcon }

const navItems: NavItem[] = [
  { label: 'Overview', to: '/dashboard', Icon: DashboardIcon },
  { label: 'Posts', to: '/dashboard/posts', Icon: FileTextIcon },
  { label: 'Media', to: '/dashboard/media', Icon: ImageIcon },
  { label: 'Activity', to: '/dashboard/activity', Icon: ActivityLogIcon },
  { label: 'Connect', to: '/dashboard/connect', Icon: Link2Icon },
  { label: 'Settings', to: '/dashboard/settings', Icon: GearIcon },
]

// Titles for non-nav routes so the top bar never falls through to "Overview".
const EXTRA_TITLES: Record<string, string> = {
  '/dashboard/billing': 'Billing',
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

function pageTitle(current: string) {
  const match = [...navItems]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => current === item.to || (item.to !== '/dashboard' && current.startsWith(item.to)))
  if (match) return match.label
  const extra = Object.keys(EXTRA_TITLES)
    .sort((a, b) => b.length - a.length)
    .find((path) => current === path || current.startsWith(path))
  return extra ? EXTRA_TITLES[extra] : 'Overview'
}

function UserMenu({ userEmail, authUrl }: { userEmail?: string; authUrl: string }) {
  const [isPending, startTransition] = useTransition()
  const initials = (userEmail?.[0] ?? 'U').toUpperCase()

  const signOut = () => {
    const authClient = setupAuthClient(authUrl)
    startTransition(() => {
      void authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = '/login'
          },
        },
      })
    })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary font-mono text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-[11px] text-muted-foreground">
                  Signed in
                </span>
                <span className="truncate text-sm font-medium">{userEmail ?? 'Account'}</span>
              </div>
              <CaretSortIcon className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium">{userEmail ?? 'Account'}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">
                vibecms<span className="text-primary">.</span>
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={isPending}
              onSelect={(event) => {
                event.preventDefault()
                signOut()
              }}
            >
              <ExitIcon />
              {isPending ? 'Signing out…' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
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
  const formStatus = useFormStatusFromSearch()
  const current = currentProp ?? pathname

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="lg">
                  <Link to="/dashboard">
                    <img src="/brand/icon.svg" alt="" className="size-8 shrink-0 rounded-lg" aria-hidden="true" />
                    <div className="grid flex-1 text-left leading-tight">
                      <span className="truncate text-sm font-semibold tracking-[-0.01em]">
                        {siteName ?? BRAND.name}
                      </span>
                      <span className="truncate font-mono text-[11px] tracking-[0.12em] text-muted-foreground">
                        vibecms<span className="text-primary">.</span>
                      </span>
                    </div>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarMenu>
                {navItems.map(({ label, to, Icon }) => {
                  const active = current === to || (to !== '/dashboard' && current.startsWith(to))
                  return (
                    <SidebarMenuItem key={to}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={label}
                        className="[&[data-active=true]_svg]:text-primary"
                      >
                        <Link to={to}>
                          <Icon aria-hidden="true" />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <UserMenu userEmail={userEmail} authUrl={authUrl} />
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <a
            href="#dashboard-main"
            className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50"
          >
            Skip to content
          </a>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-[color:var(--hairline)] bg-background/80 px-4 backdrop-blur-xl">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
            <h1 className="font-display text-sm font-semibold tracking-[-0.01em]">{pageTitle(current)}</h1>
          </header>
          <div id="dashboard-main" tabIndex={-1} className="flex flex-1 flex-col gap-4 p-4 outline-none sm:p-6">
            <StatusAlert status={formStatus} />
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
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
        <p className="font-mono text-[11px] font-medium text-primary">{kicker}</p>
        <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">{title}</h2>
        {description ? (
          <p className="max-w-2xl text-pretty font-sans text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  )
}

export function StatCard({
  label,
  value,
  detail,
  interactive,
}: {
  label: string
  value: string | number
  detail?: string
  interactive?: boolean
}) {
  return (
    <Card
      className={cn(
        'gap-0 p-4',
        interactive && 'h-full transition-colors hover:border-[color:var(--brand-bright)]/30 hover:bg-muted/40',
      )}
    >
      <p className="font-mono text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {detail ? <p className="mt-1 font-sans text-xs text-muted-foreground">{detail}</p> : null}
    </Card>
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
    <Card className={cn('gap-0 p-4', className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
        {meta}
      </div>
      {children}
    </Card>
  )
}

export function DataRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm sm:items-center',
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
    <div className="rounded-xl border border-dashed border-[color:var(--hairline)] px-4 py-8 text-center">
      <p className="font-display text-base font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  )
}

/** Consistent, retryable error state for a page whose data failed to load. */
export function LoadError({ message }: { message: string }) {
  return (
    <Panel title="Something went wrong">
      <div className="grid gap-3">
        <p className="font-sans text-sm text-muted-foreground">{message}</p>
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => {
            if (typeof window !== 'undefined') window.location.reload()
          }}
        >
          Try again
        </Button>
      </div>
    </Panel>
  )
}

export { Button }
