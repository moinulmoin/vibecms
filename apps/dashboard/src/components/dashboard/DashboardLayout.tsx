import { BRAND } from '@vc/config'
import {
  Activity,
  ChartNoAxesCombined,
  Check,
  ChevronsUpDown,
  FileText,
  Image,
  LayoutDashboard,
  Link2,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Settings,
  Sun,
  Users,
} from 'lucide-react'
import { Button, Separator } from '@vc/ui'
import { Link, useRouterState } from '@tanstack/react-router'
import { useState, useTransition, type ComponentType, type ReactNode } from 'react'
import { useAppTheme, type AppTheme } from '~/hooks/use-app-theme'
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
import { TooltipProvider } from '~/components/ui/tooltip'
import { setupAuthClient } from '~/lib/auth-client'
import { selectDashboardApp } from '~/lib/api-client'
import type { AppChoice } from '~/types/dashboard'
import { Panel } from './blocks'

type NavItem = { label: string; to: string; Icon: ComponentType<{ 'aria-hidden'?: boolean; className?: string }> }

const navItems: NavItem[] = [
  { label: 'Overview', to: '/dashboard', Icon: LayoutDashboard },
  { label: 'Posts', to: '/dashboard/posts', Icon: FileText },
  { label: 'Subscribers', to: '/dashboard/subscribers', Icon: Users },
  { label: 'Media', to: '/dashboard/media', Icon: Image },
  { label: 'Connect', to: '/dashboard/connect', Icon: Link2 },
  { label: 'Activity', to: '/dashboard/activity', Icon: Activity },
  { label: 'Analytics', to: '/dashboard/analytics', Icon: ChartNoAxesCombined },
  { label: 'Theme', to: '/dashboard/theme', Icon: Palette },
  { label: 'Settings', to: '/dashboard/settings', Icon: Settings },
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


/** Non-nav routes that still deserve a truthful breadcrumb title. */
const extraPageTitles: Array<Pick<NavItem, 'label' | 'to'>> = [
  { label: 'Billing', to: '/dashboard/billing' },
]

function pageTitle(current: string) {
  const match = [...navItems, ...extraPageTitles]
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
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
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
              <LogOut />
              {isPending ? 'Signing out…' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

const themeOptions: Array<{ value: AppTheme; label: string; Icon: ComponentType<{ 'aria-hidden'?: boolean; className?: string }> }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

function ThemeSwitcher() {
  const { theme, setTheme } = useAppTheme()

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="flex items-center gap-0.5 rounded-lg border border-sidebar-border bg-sidebar-accent/50 p-0.5 md:group-data-[collapsible=icon]:flex-col"
    >
      {themeOptions.map(({ value, label, Icon }) => {
        const selected = theme === value
        return (
          <button
            key={value}
            type="button"
            aria-label={`${label} theme`}
            aria-pressed={selected}
            title={label}
            onClick={() => setTheme(value)}
            className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors duration-150 md:group-data-[collapsible=icon]:size-7 md:group-data-[collapsible=icon]:px-0 ${
              selected
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" />
            <span className="md:group-data-[collapsible=icon]:hidden">{label}</span>
          </button>
        )
      })}
    </div>
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
              !['/dashboard/media', '/dashboard/connect', '/dashboard/settings', '/dashboard/subscribers'].includes(to),
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
                  <Link to={to} onClick={closeMobileNavigation} aria-current={active ? 'page' : undefined}>
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
          <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
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
              {selected ? <Check className="ml-auto" /> : null}
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
  const current = currentProp ?? pathname

  return (
    <TooltipProvider delayDuration={0}>
      <SidebarProvider>
        <Sidebar collapsible="icon" role="complementary" aria-label="Dashboard sidebar">
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
            <ThemeSwitcher />
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
