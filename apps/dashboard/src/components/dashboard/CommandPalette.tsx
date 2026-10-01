import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Activity,
  ChartNoAxesCombined,
  CornerDownLeft,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  Globe,
  Image,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  Moon,
  Palette,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@vc/ui'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import { StatusBadge } from '~/components/dashboard/blocks'
import { resolveAppTheme, useAppTheme } from '~/hooks/use-app-theme'
import { loadPostsPage } from '~/lib/api-client'
import { emptyPostEditorSearch, postsListSearch } from '~/lib/dashboard-search'

type Role = 'owner' | 'editor' | 'viewer' | undefined

export type PaletteItem = {
  id: string
  group: 'Posts' | 'Go to' | 'Create' | 'Your blog' | 'Preferences'
  label: string
  /** Extra words that should match ("drafts" finds Posts). */
  keywords?: string
  Icon: LucideIcon
  meta?: React.ReactNode
  run: () => void
}

const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'

/** Every word of the query must appear somewhere in the label or keywords. */
export function matchesQuery(item: Pick<PaletteItem, 'label' | 'keywords'>, query: string) {
  const haystack = `${item.label} ${item.keywords ?? ''}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word))
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/**
 * Cmd/Ctrl+K: jump to any page, find a post by title, or start something,
 * without reaching for the sidebar.
 */
export function CommandPalette({ role }: { role: Role }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The post editor uses Cmd+K for links; it handles (and prevents) it first.
      if (event.defaultPrevented) return
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-auto inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:w-56"
        aria-label="Search and jump to"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Search aria-hidden className="size-4" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="ml-auto hidden rounded border border-border px-1.5 font-sans text-[11px] leading-5 text-muted-foreground sm:inline">
          {SHORTCUT}
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Search and jump to</DialogTitle>
          <DialogDescription className="sr-only">Type to find a page, a post, or an action. Use the arrow keys, then Enter.</DialogDescription>
          {open ? <PaletteBody role={role} onClose={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function PaletteBody({ role, onClose }: { role: Role; onClose: () => void }) {
  const navigate = useNavigate()
  const { theme, setTheme } = useAppTheme()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const canEdit = role === 'owner' || role === 'editor'
  const isOwner = role === 'owner'
  const term = useDebounced(query.trim(), 150)

  // Recent posts when empty; title search as you type. The first page also
  // carries the blog's public address.
  const posts = useQuery({
    queryKey: ['command-palette', 'posts', term],
    queryFn: ({ signal }) => loadPostsPage({ search: term || undefined }, signal),
    staleTime: 30_000,
  })

  const items = useMemo(() => {
    const go = (to: string) => () => void navigate({ to })
    const all: PaletteItem[] = []
    const found = (posts.data?.posts ?? []).slice(0, term ? 8 : 5)
    for (const post of found) {
      all.push({
        id: `post:${post.id}`,
        group: 'Posts',
        label: post.title || 'Untitled',
        keywords: `${post.slug} ${term}`,
        Icon: FileText,
        meta: <StatusBadge status={post.status} className="w-fit" />,
        run: () => void navigate({ to: '/dashboard/posts/$postId/edit', params: { postId: post.id }, search: emptyPostEditorSearch }),
      })
    }
    if (canEdit) {
      all.push({ id: 'new-post', group: 'Create', label: 'New post', keywords: 'write draft create', Icon: Plus,
        run: () => void navigate({ to: '/dashboard/posts/new', search: emptyPostEditorSearch }) })
      all.push({ id: 'new-key', group: 'Create', label: 'Connect an agent', keywords: 'key mcp cli claude codex cursor token', Icon: KeyRound, run: go('/dashboard/connect') })
    }
    all.push(
      { id: 'overview', group: 'Go to', label: 'Overview', keywords: 'home dashboard', Icon: LayoutDashboard, run: go('/dashboard') },
      { id: 'posts', group: 'Go to', label: 'Posts', keywords: 'drafts published archived', Icon: FileText, run: go('/dashboard/posts') },
      { id: 'review', group: 'Go to', label: 'Needs review', keywords: 'posts approve pending changes', Icon: Inbox,
        run: () => void navigate({ to: '/dashboard/posts', search: postsListSearch({ status: 'review' }) }) },
      { id: 'analytics', group: 'Go to', label: 'Analytics', keywords: 'views traffic crawlers referrers', Icon: ChartNoAxesCombined, run: go('/dashboard/analytics') },
      { id: 'activity', group: 'Go to', label: 'Activity', keywords: 'history log changes', Icon: Activity, run: go('/dashboard/activity') },
    )
    if (canEdit) {
      all.push(
        { id: 'media', group: 'Go to', label: 'Media', keywords: 'images uploads', Icon: Image, run: go('/dashboard/media') },
        { id: 'subscribers', group: 'Go to', label: 'Subscribers', keywords: 'email newsletter readers signup', Icon: Users, run: go('/dashboard/subscribers') },
        { id: 'theme', group: 'Go to', label: 'Theme', keywords: 'design template accent font colors', Icon: Palette, run: go('/dashboard/theme') },
        { id: 'connect', group: 'Go to', label: 'Connect', keywords: 'agents keys mcp', Icon: Link2, run: go('/dashboard/connect') },
        { id: 'settings', group: 'Go to', label: 'Settings', keywords: 'name description logo links byline seo', Icon: Settings, run: go('/dashboard/settings') },
        { id: 'voice', group: 'Go to', label: 'Voice', keywords: 'settings tone rules agents write', Icon: Sparkles,
          run: () => void navigate({ to: '/dashboard/settings', search: { ok: undefined, error: undefined, tab: 'voice' } }) },
      )
    }
    if (isOwner) {
      all.push(
        { id: 'domain', group: 'Go to', label: 'Custom domain', keywords: 'settings dns address', Icon: Globe,
          run: () => void navigate({ to: '/dashboard/settings', search: { ok: undefined, error: undefined, tab: 'domain' } }) },
        { id: 'billing', group: 'Go to', label: 'Plan & billing', keywords: 'settings subscription upgrade invoice', Icon: CreditCard,
          run: () => void navigate({ to: '/dashboard/settings', search: { ok: undefined, error: undefined, tab: 'billing' } }) },
        { id: 'export', group: 'Go to', label: 'Export posts', keywords: 'settings download backup json', Icon: Download,
          run: () => void navigate({ to: '/dashboard/settings', search: { ok: undefined, error: undefined, tab: 'export' } }) },
      )
    }
    const blogUrl = posts.data?.publicBaseUrl
    if (blogUrl) {
      all.push({ id: 'open-blog', group: 'Your blog', label: 'Open your blog', keywords: `view public site ${blogUrl}`, Icon: ExternalLink,
        meta: <span className="truncate font-mono text-xs text-muted-foreground">{blogUrl.replace(/^https?:\/\//, '')}</span>,
        run: () => window.open(blogUrl, '_blank', 'noopener,noreferrer') })
    }
    const dark = resolveAppTheme(theme) === 'dark'
    all.push({ id: 'theme-toggle', group: 'Preferences', label: dark ? 'Switch to light mode' : 'Switch to dark mode', keywords: 'appearance dark light theme', Icon: dark ? Sun : Moon,
      run: () => setTheme(dark ? 'light' : 'dark') })
    // Posts already matched on the server; everything else filters here.
    return query.trim() ? all.filter((item) => item.group === 'Posts' || matchesQuery(item, query.trim())) : all
  }, [posts.data, term, query, canEdit, isOwner, navigate, theme, setTheme])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function runItem(item: PaletteItem | undefined) {
    if (!item) return
    onClose()
    item.run()
  }

  const groups: Array<{ name: PaletteItem['group']; items: Array<PaletteItem & { index: number }> }> = []
  items.forEach((item, index) => {
    const group = groups.find((g) => g.name === item.group) ?? groups[groups.push({ name: item.group, items: [] }) - 1]!
    group.items.push({ ...item, index })
  })
  const activeItem = items[active]

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActive((i) => (items.length ? (i + 1) % items.length : 0))
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0))
        } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault()
          runItem(activeItem)
        }
      }}
    >
      <div className="flex items-center gap-2.5 border-b border-[color:var(--hairline)] px-4">
        <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search posts, pages, and actions"
          aria-label="Search posts, pages, and actions"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={activeItem ? `command-palette-${activeItem.id}` : undefined}
          className="h-12 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {posts.isFetching ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" /> : null}
      </div>
      <div ref={listRef} id="command-palette-list" role="listbox" aria-label="Results" className="max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain p-2">
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {posts.isFetching ? 'Searching…' : `Nothing matches “${query.trim()}”.`}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.name} role="group" aria-label={group.name} className="pb-1">
              <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group.name === 'Posts' && !term ? 'Recent posts' : group.name}</p>
              {group.items.map((item) => (
                <div
                  key={item.id}
                  id={`command-palette-${item.id}`}
                  data-index={item.index}
                  role="option"
                  aria-selected={item.index === active}
                  onMouseMove={() => { if (item.index !== active) setActive(item.index) }}
                  onClick={() => runItem(item)}
                  className={cn(
                    'flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground',
                    item.index === active && 'bg-muted',
                  )}
                >
                  <item.Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.meta ? <span className="flex min-w-0 max-w-[45%] shrink items-center justify-end">{item.meta}</span> : null}
                  {item.index === active ? <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-4 border-t border-[color:var(--hairline)] px-4 py-2 text-xs text-muted-foreground">
        <span><kbd className="font-sans">↑↓</kbd> to move</span>
        <span><kbd className="font-sans">↵</kbd> to open</span>
        <span className="ml-auto"><kbd className="font-sans">esc</kbd> to close</span>
      </div>
    </div>
  )
}
