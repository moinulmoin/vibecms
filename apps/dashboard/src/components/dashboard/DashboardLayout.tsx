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
  RotateCw,
  Settings,
  Sun,
  Users,
} from 'lucide-react'
import { Button } from '@vc/ui'
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '~/components/ui/avatar'
import { TooltipProvider } from '~/components/ui/tooltip'
import { setupAuthClient } from '~/lib/auth-client'
import { selectDashboardApp, suspendDashboardMutations } from '~/lib/api-client'
import { queryClient } from '~/lib/queries'
import { clearSessionSecrets } from '~/lib/token-flash'
import type { AppChoice } from '~/types/dashboard'

type IconType = ComponentType<{ 'aria-hidden'?: boolean; className?: string }>
type NavItem = { label: string; to: string; Icon: IconType; editorsOnly?: boolean }

const navItems: NavItem[] = [
  { label: 'Overview', to: '/dashboard', Icon: LayoutDashboard },
  { label: 'Posts', to: '/dashboard/posts', Icon: FileText },
  { label: 'Media', to: '/dashboard/media', Icon: Image, editorsOnly: true },
  { label: 'Subscribers', to: '/dashboard/subscribers', Icon: Users, editorsOnly: true },
  { label: 'Analytics', to: '/dashboard/analytics', Icon: ChartNoAxesCombined },
  { label: 'Activity', to: '/dashboard/activity', Icon: Activity },
  { label: 'Connect', to: '/dashboard/connect', Icon: Link2, editorsOnly: true },
  { label: 'Theme', to: '/dashboard/theme', Icon: Palette, editorsOnly: true },
  { label: 'Settings', to: '/dashboard/settings', Icon: Settings, editorsOnly: true },
]

const dateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })
const shortDateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
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

/** "just now", "5m ago", "3h ago", "yesterday", "Mar 4", "Mar 4, 2024". */
export function formatRelative(value: number | string | Date, now: number = Date.now()) {
  const date = toDate(value)
  const seconds = Math.round((now - date.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return date.getFullYear() === new Date(now).getFullYear()
    ? shortDateFormatter.format(date)
    : dateFormatter.format(date)
}

export function labelAction(action: string) {
  return action.replaceAll('.', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const extraPageTitles: Array<Pick<NavItem, 'label' | 'to'>> = [
  { label: 'Plan & billing', to: '/dashboard/billing' },
  { label: 'New post', to: '/dashboard/posts/new' },
]

/** Editor and theme customizer need the full width for side-by-side panes. */
export function isWideRoute(pathname: string) {
  return (
    pathname === '/dashboard/theme' ||
    pathname === '/dashboard/posts/new' ||
    /^\/dashboard\/posts\/[^/]+\/edit\/?$/.test(pathname)
  )
}

function pageTitle(current: string) {
  if (/^\/dashboard\/posts\/[^/]+\/edit\/?$/.test(current)) return 'Edit post'
  const match = [...navItems, ...extraPageTitles]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => current === item.to || (item.to !== '/dashboard' && current.startsWith(item.to)))
  return match ? match.label : 'Overview'
}

const themeOptions: Array<{ value: AppTheme; label: string; Icon: IconType }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

function UserMenu({ userEmail }: { userEmail?: string }) {
  const [isPending, startTransition] = useTransition()
  const { theme, setTheme } = useAppTheme()
  const initials = (userEmail?.[0] ?? 'U').toUpperCase()

  const signOut = () => {
    const authClient = setupAuthClient()
    startTransition(() => {
      void authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            clearSessionSecrets()
            queryClient.clear()
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
              aria-label="Account menu"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-muted font-mono text-sm text-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{userEmail ?? 'Account'}</span>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60"
          >
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              {userEmail ?? 'Account'}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="pb-1 text-xs font-normal text-muted-foreground">Appearance</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as AppTheme)}>
              {themeOptions.map(({ value, label, Icon }) => (
                <DropdownMenuRadioItem key={value} value={value} onSelect={(event) => event.preventDefault()}>
                  <Icon aria-hidden className="size-4 text-muted-foreground" />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
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

function DashboardNavigation({ current, role }: { current: string; role?: 'owner' | 'editor' | 'viewer' }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const closeMobileNavigation = () => {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <SidebarGroup className="px-2 py-3">
      <SidebarMenu className="gap-0.5">
        {navItems
          .filter((item) => role !== 'viewer' || !item.editorsOnly)
          .map(({ label, to, Icon }) => {
            const active = current === to || (to !== '/dashboard' && current.startsWith(to))
            return (
              <SidebarMenuItem key={to}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={label}
                  className="h-9 px-2.5 text-[0.9375rem] font-normal text-muted-foreground hover:text-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-foreground data-[active=true]:[&>svg]:text-primary [&>svg]:size-[1.05rem]"
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
      <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold tracking-[-0.01em]">
        {siteName ?? BRAND.name}
      </span>
    </>
  )
}

function SiteSwitcher({
  apps,
  currentWorkspaceId,
  currentSiteId,
  siteName,
}: {
  apps: AppChoice[]
  currentWorkspaceId?: string
  currentSiteId?: string
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
    if (pendingSiteId || (choice.workspaceId === currentWorkspaceId && choice.siteId === currentSiteId)) return
    setPendingSiteId(choice.siteId)
    try {
      await selectDashboardApp({ workspaceId: choice.workspaceId, siteId: choice.siteId })
      suspendDashboardMutations()
      try {
        localStorage.setItem('vc-dashboard-selection', JSON.stringify({
          workspaceId: choice.workspaceId,
          siteId: choice.siteId,
          siteName: choice.siteName,
          changedAt: Date.now(),
        }))
      } catch {
        // Focus/visibility checks still detect the change if storage is unavailable.
      }
      // The one-time key belongs to the site it was made for.
      clearSessionSecrets()
      queryClient.clear()
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
      <DropdownMenuContent side="bottom" align="start" sideOffset={6} className="min-w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Your blogs</DropdownMenuLabel>
        {apps.map((choice) => {
          const selected = choice.workspaceId === currentWorkspaceId && choice.siteId === currentSiteId
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
                <span className="block truncate text-sm font-medium">{choice.siteName}</span>
                <span className="block truncate text-xs text-muted-foreground">{choice.workspaceName}</span>
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
        {/* First tab stop, so keyboard users can jump past the sidebar. */}
        <a
          href="#dashboard-main"
          className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50"
        >
          Skip to content
        </a>
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
            <UserMenu userEmail={userEmail} />
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-[color:var(--hairline)] bg-background/90 px-4 backdrop-blur-xl sm:px-6">
            <SidebarTrigger className="-ml-1" aria-label="Toggle navigation" />
            <span className="truncate text-sm text-muted-foreground">
              <span className="hidden sm:inline">{siteName ?? BRAND.name}</span>
              <span aria-hidden className="hidden px-2 text-muted-foreground/50 sm:inline">/</span>
              <span className="font-medium text-foreground">{pageTitle(current)}</span>
            </span>
          </header>
          <div
            id="dashboard-main"
            tabIndex={-1}
            className={
              isWideRoute(current)
                ? 'flex w-full flex-1 flex-col gap-6 px-4 py-6 outline-none sm:px-6 lg:px-8'
                : 'mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-8 px-4 py-7 outline-none sm:px-8 sm:py-10 lg:px-10'
            }
          >
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}

/** Flat, retryable error state for a page whose data failed to load. */
export function LoadError({
  message,
  onRetry,
  title = 'Couldn’t load this page',
}: {
  message: string
  onRetry?: () => void
  title?: string
}) {
  return (
    <div role="alert" className="flex max-w-xl flex-col items-start gap-4 py-10">
      <div className="space-y-1.5">
        <h2 className="font-display text-lg font-semibold tracking-[-0.02em] text-foreground">{title}</h2>
        <p className="text-base leading-7 text-muted-foreground">{message}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          if (onRetry) onRetry()
          else if (typeof window !== 'undefined') window.location.reload()
        }}
      >
        <RotateCw aria-hidden data-icon="inline-start" /> Try again
      </Button>
    </div>
  )
}

export { Button }
