import { BRAND } from '@vc/config'
import type { FormStatus } from '@vc/config'
import {
  ActivityLogIcon,
  CaretSortIcon,
  CheckIcon,
  DashboardIcon,
  ExitIcon,
  FileTextIcon,
  GearIcon,
  ImageIcon,
  Link2Icon,
} from '@radix-ui/react-icons'
import { ChartNoAxesCombined } from 'lucide-react'
import { Alert, Button } from '@vc/ui'
import { Link, useRouterState } from '@tanstack/react-router'
import { useState, useTransition, type ComponentType, type ReactNode } from 'react'
import { useFormStatusFromSearch } from '~/components/dashboard/useFormStatusFromSearch'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
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
import { Separator } from "@vc/ui"
import { TooltipProvider } from '~/components/ui/tooltip'
import { setupAuthClient } from '~/lib/auth-client'
import { selectDashboardApp } from '~/lib/api-client'
import type { AppChoice } from '~/types/dashboard'
// Page primitives moved to the shared block kit; keep re-exports for
// compatibility during the transition, then drop them.
export { PageHeader, Panel, StatCard, StatusBadge, EmptyState, DataRow } from './blocks'
import { Panel } from './blocks'

type NavItem = { label: string; to: string; Icon: ComponentType<{ 'aria-hidden'?: boolean }> }

const navItems: NavItem[] = [
  { label: 'Overview', to: '/dashboard', Icon: DashboardIcon },
  { label: 'Posts', to: '/dashboard/posts', Icon: FileTextIcon },
  { label: 'Media', to: '/dashboard/media', Icon: ImageIcon },
  { label: 'Connect', to: '/dashboard/connect', Icon: Link2Icon },
  { label: 'Activity', to: '/dashboard/activity', Icon: ActivityLogIcon },
  { label: 'Analytics', to: '/dashboard/analytics', Icon: ChartNoAxesCombined },
  { label: 'Settings', to: '/dashboard/settings', Icon: GearIcon },
]

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
  return match ? match.label : 'Overview'
}

function UserMenu({ userEmail }: { userEmail?: string }) {
  const [isPending, startTransition] = useTransition()
  const initials = (userEmail?.[0] ?? 'U').toUpperCase()

  const signOut = () => {
    const authClient = setupAuthClient()
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

function DashboardNavigation({
  current,
  role,
}: {
  current: string
  role?: 'owner' | 'editor' | 'viewer'
}) {
  const { isMobile, setOpenMobile } = useSidebar()
  const closeMobileNavigation = () => {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <SidebarGroup className="px-2 py-3">
      <SidebarMenu className="gap-1">
        {navItems
          .filter(
            ({ to }) =>
              role !== 'viewer' ||
              !['/dashboard/media', '/dashboard/connect', '/dashboard/settings'].includes(to),
          )
          .map(({ label, to, Icon }) => {
            const active = current === to || (to !== '/dashboard' && current.startsWith(to))
            return (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={label}
                  className="relative h-9 px-2.5 font-medium text-muted-foreground data-[active=true]:bg-transparent data-[active=true]:text-sidebar-foreground data-[active=true]:before:absolute data-[active=true]:before:inset-y-2 data-[active=true]:before:left-0 data-[active=true]:before:w-px data-[active=true]:before:bg-primary data-[active=true]:[&>svg]:text-primary"
                >
                  <Link to={to} onClick={closeMobileNavigation}>
                    <Icon aria-hidden />
                    <span>{label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function SiteIdentity({ siteName }: { siteName?: string }) {
  return (
    <>
      <img src="/brand/icon.svg" alt="" className="size-8 shrink-0 rounded-lg" aria-hidden="true" />
      <div className="grid flex-1 text-left leading-tight">
        <span className="truncate text-sm font-semibold tracking-[-0.01em]">
          {siteName ?? BRAND.name}
        </span>
        <span className="truncate font-mono text-[11px] tracking-[0.12em] text-muted-foreground">
          vibecms<span className="text-primary">.</span>
        </span>
      </div>
    </>
  )
}

function SiteSwitcher({
  apps,
  currentWorkspaceId,
  currentSiteId,
  currentRole,
  siteName,
}: {
  apps: AppChoice[]
  currentWorkspaceId?: string
  currentSiteId?: string
  currentRole?: 'owner' | 'editor' | 'viewer'
  siteName?: string
}) {
  const [pendingSiteId, setPendingSiteId] = useState<string | null>(null)
  if (apps.length <= 1) {
    return (
      <SidebarMenuButton asChild size="lg">
        <Link to="/dashboard">
          <SiteIdentity siteName={siteName} />
        </Link>
      </SidebarMenuButton>
    )
  }

  const switchApp = async (choice: AppChoice) => {
    if (
      pendingSiteId ||
      (choice.workspaceId === currentWorkspaceId &&
        choice.siteId === currentSiteId)
    ) {
      return
    }
    setPendingSiteId(choice.siteId)
    try {
      await selectDashboardApp({
        workspaceId: choice.workspaceId,
        siteId: choice.siteId,
      })
      window.location.assign('/dashboard')
    } catch {
      setPendingSiteId(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          aria-label="Switch site"
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <SiteIdentity siteName={siteName} />
          <CaretSortIcon className="ml-auto size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        className="min-w-64"
      >
        <DropdownMenuLabel>Sites</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {apps.map((choice) => {
          const selected =
            choice.workspaceId === currentWorkspaceId &&
            choice.siteId === currentSiteId
          return (
            <DropdownMenuItem
              key={`${choice.workspaceId}:${choice.siteId}`}
              disabled={pendingSiteId !== null}
              onSelect={(event) => {
                event.preventDefault()
                void switchApp(choice)
              }}
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {choice.siteName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {choice.workspaceName}
                </span>
              </div>
              {selected ? <CheckIcon className="ml-auto" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell({
  children,
  current: currentProp,
  siteName,
  userEmail,
  apps = [],
  currentWorkspaceId,
  currentSiteId,
  currentRole,
}: {
  children: ReactNode
  current?: string
  siteName?: string
  userEmail?: string
  apps?: AppChoice[]
  currentWorkspaceId?: string
  currentSiteId?: string
  currentRole?: 'owner' | 'editor' | 'viewer'
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
                <SiteSwitcher
                  apps={apps}
                  currentWorkspaceId={currentWorkspaceId}
                  currentSiteId={currentSiteId}
                  siteName={siteName}
                />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <DashboardNavigation current={current} role={currentRole} />
          </SidebarContent>

          <SidebarFooter>
            <UserMenu userEmail={userEmail} />
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
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-[color:var(--hairline)] bg-background/88 px-4 backdrop-blur-xl sm:px-6">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-3.5" />
            <span className="truncate font-mono text-[11px] font-medium uppercase tracking-[0.11em] text-muted-foreground">
              dashboard <span aria-hidden className="px-1 text-border">/</span>{' '}
              <span className="text-foreground">{pageTitle(current)}</span>
            </span>
          </header>
          <div
            id="dashboard-main"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-6 px-4 py-6 outline-none sm:px-8 sm:py-9 lg:px-10 lg:py-10"
          >
            <StatusAlert status={formStatus} />
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

/** Consistent, retryable error state for a page whose data failed to load. */
export function LoadError({ message }: { message: string }) {
  return (
    <Panel title="Something went wrong">
      <div className="grid gap-3">
        <p className="font-sans text-base leading-7 text-muted-foreground">{message}</p>
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
