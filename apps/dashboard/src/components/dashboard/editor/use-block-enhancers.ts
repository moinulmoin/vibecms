import mermaidSrc from '@mermaid-js/tiny/dist/mermaid.tiny.js?url'
import { useEffect, useState } from 'react'

/**
 * Dashboard twin of apps/public/src/scripts/blocks.js: enhances generated
 * Markdown blocks inside a preview (tabs -> ARIA tablist, ```mermaid ->
 * SVG). Idempotent, so it re-runs after every React render of the preview
 * without fighting reconciliation (only foreign nodes/attributes are added).
 */

type MermaidApi = {
  initialize(config: Record<string, unknown>): void
  render(id: string, source: string): Promise<{ svg: string }>
}

declare global {
  interface Window {
    mermaid?: MermaidApi
  }
}

const MERMAID_MAX_CHARS = 5000
let seq = 0

// ── Tabs ────────────────────────────────────────────────────────────────

type TabState = { buttons: HTMLButtonElement[]; panels: HTMLElement[] }
const tabState = new WeakMap<Element, TabState>()
const norm = (s: string | null) => (s ?? '').trim().toLowerCase()

function showTab(group: Element, index: number, focus: boolean) {
  const s = tabState.get(group)
  if (!s) return
  s.buttons.forEach((b, i) => {
    const on = i === index
    b.setAttribute('aria-selected', String(on))
    b.tabIndex = on ? 0 : -1
    s.panels[i]!.hidden = !on
  })
  if (focus) s.buttons[index]?.focus()
}

function enhanceTabs(root: HTMLElement) {
  for (const group of root.querySelectorAll<HTMLElement>('.vc-tabs')) {
    const previous = tabState.get(group)
    const selected = previous ? norm(previous.buttons.find((b) => b.getAttribute('aria-selected') === 'true')?.textContent ?? '') : ''
    group.querySelector(':scope > .vc-tablist')?.remove()
    const panels = [...group.children].filter((el): el is HTMLElement => el.matches('section.vc-tab'))
    if (!panels.length) continue
    const id = `vc-tabs-${++seq}`
    const list = document.createElement('div')
    list.className = 'vc-tablist'
    list.setAttribute('role', 'tablist')
    const buttons = panels.map((panel, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.id = `${id}-tab-${i}`
      b.textContent = panel.dataset.vcTab || `Tab ${i + 1}`
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-controls', `${id}-panel-${i}`)
      panel.id = `${id}-panel-${i}`
      panel.setAttribute('role', 'tabpanel')
      panel.setAttribute('aria-labelledby', b.id)
      panel.tabIndex = 0
      list.append(b)
      return b
    })
    group.prepend(list)
    group.setAttribute('data-vc-tabs-ready', '')
    tabState.set(group, { buttons, panels })
    showTab(group, Math.max(0, buttons.findIndex((b) => norm(b.textContent) === selected)), false)

    const choose = (index: number) => {
      const label = norm(buttons[index]!.textContent)
      showTab(group, index, true)
      for (const other of root.querySelectorAll('.vc-tabs[data-vc-tabs-ready]')) {
        if (other === group) continue
        const i = tabState.get(other)?.buttons.findIndex((b) => norm(b.textContent) === label) ?? -1
        if (i !== -1) showTab(other, i, false)
      }
    }
    list.addEventListener('click', (event) => {
      const i = buttons.indexOf((event.target as Element).closest('button') as HTMLButtonElement)
      if (i !== -1) choose(i)
    })
    list.addEventListener('keydown', (event) => {
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (current === -1) return
      const last = buttons.length - 1
      const next =
        event.key === 'ArrowRight' ? (current === last ? 0 : current + 1)
        : event.key === 'ArrowLeft' ? (current === 0 ? last : current - 1)
        : event.key === 'Home' ? 0
        : event.key === 'End' ? last
        : -1
      if (next === -1) return
      event.preventDefault()
      choose(next)
    })
  }
}

// ── Diagrams ────────────────────────────────────────────────────────────

let mermaidPromise: Promise<MermaidApi> | null = null

function loadMermaid(): Promise<MermaidApi> {
  if (window.mermaid) return Promise.resolve(window.mermaid)
  mermaidPromise ??= new Promise<MermaidApi>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = mermaidSrc
    s.async = true
    s.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error('mermaid missing')))
    s.onerror = () => reject(new Error('mermaid failed to load'))
    document.head.append(s)
  }).catch((error: unknown) => {
    mermaidPromise = null
    throw error
  })
  return mermaidPromise
}

let ctx: CanvasRenderingContext2D | null = null

/** Resolves a --vc-* token (oklch, light-dark) to #rrggbb for Mermaid. */
function tokenHex(el: Element, token: string, fallback: string): string {
  const probe = document.createElement('span')
  probe.style.color = `var(${token}, ${fallback})`
  el.append(probe)
  const color = getComputedStyle(probe).color
  probe.remove()
  if (!ctx) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    ctx = canvas.getContext('2d', { willReadFrequently: true })
  }
  if (!ctx) return fallback
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = fallback
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function diagramTheme(el: Element): Record<string, unknown> {
  const bg = tokenHex(el, '--vc-bg', '#ffffff')
  const fg = tokenHex(el, '--vc-fg', '#1f1f1f')
  const muted = tokenHex(el, '--vc-muted', '#f4f4f4')
  const mutedFg = tokenHex(el, '--vc-muted-fg', '#6b6b6b')
  const border = tokenHex(el, '--vc-border', '#dddddd')
  const n = parseInt(bg.slice(1), 16)
  const luminance = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return {
    darkMode: luminance < 0.5,
    background: bg,
    fontFamily: getComputedStyle(el).fontFamily,
    fontSize: '14px',
    primaryColor: muted,
    primaryTextColor: fg,
    primaryBorderColor: border,
    secondaryColor: muted,
    tertiaryColor: bg,
    lineColor: mutedFg,
    textColor: fg,
    mainBkg: muted,
    nodeBorder: border,
    clusterBkg: bg,
    clusterBorder: border,
    titleColor: fg,
    edgeLabelBackground: bg,
    noteBkgColor: muted,
    noteTextColor: fg,
    noteBorderColor: border,
    actorBkg: muted,
    actorBorder: border,
    actorTextColor: fg,
    actorLineColor: mutedFg,
    signalColor: fg,
    signalTextColor: fg,
    labelBoxBkgColor: muted,
    labelBoxBorderColor: border,
    labelTextColor: fg,
    loopTextColor: fg,
  }
}

const rendered = new WeakMap<Element, string>()

async function renderDiagrams(root: HTMLElement) {
  const pres = [...root.querySelectorAll<HTMLElement>('pre[data-vc-mermaid]')]
  if (!pres.length) return
  const mermaid = await loadMermaid()
  for (const pre of pres) {
    if (!pre.isConnected) continue
    const figure = pre.closest('.vc-diagram') ?? pre.parentElement
    const source = pre.textContent ?? ''
    if (!figure || source.length > MERMAID_MAX_CHARS) continue
    const theme = diagramTheme(figure)
    const signature = `${JSON.stringify(theme)}\u0000${source}`
    if (rendered.get(pre) === signature) continue
    rendered.set(pre, signature)
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      maxTextSize: MERMAID_MAX_CHARS,
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: theme,
    })
    const id = `vc-mermaid-${++seq}`
    let out = figure.querySelector<HTMLElement>(':scope > .vc-diagram-svg')
    try {
      const { svg } = await mermaid.render(id, source)
      if (!pre.isConnected) continue
      if (!out) {
        out = document.createElement('div')
        out.className = 'vc-diagram-svg'
        figure.append(out)
      }
      // Mermaid "strict" output: labels are sanitized, click handlers disabled.
      out.innerHTML = svg
      // Wide diagrams scroll on phones instead of shrinking to unreadable text.
      const svgEl = out.querySelector('svg')
      const natural = parseFloat(svgEl?.style.maxWidth || '')
      if (svgEl && natural > 0) svgEl.style.minWidth = `${Math.min(natural, 480)}px`
      pre.hidden = true
    } catch {
      document.getElementById(`d${id}`)?.remove()
      out?.remove()
      pre.hidden = false
    }
  }
}

let queue: Promise<void> = Promise.resolve()

function scheduleDiagrams(root: HTMLElement) {
  queue = queue.then(() => renderDiagrams(root)).catch(() => undefined)
}

/**
 * Enhances tabs and Mermaid diagrams in the element given the returned
 * callback ref. Pass the render result (or anything that changes with the
 * markup) as `key`.
 */
export function useBlockEnhancers<T extends HTMLElement = HTMLDivElement>(key: unknown): (el: T | null) => void {
  const [root, setRoot] = useState<T | null>(null)

  useEffect(() => {
    if (!root) return
    enhanceTabs(root)
    if (!root.querySelector('pre[data-vc-mermaid]')) return
    scheduleDiagrams(root)
    // Preview mode / theme toggles restyle the tokens: re-theme diagrams.
    let timer: ReturnType<typeof setTimeout> | undefined
    const rerender = () => {
      clearTimeout(timer)
      timer = setTimeout(() => scheduleDiagrams(root), 60)
    }
    const observer = new MutationObserver(rerender)
    observer.observe(root, { attributes: true, subtree: true, attributeFilter: ['data-vc-mode', 'data-vc-theme', 'style'] })
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener?.('change', rerender)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
      media?.removeEventListener?.('change', rerender)
    }
  }, [root, key])

  return setRoot
}
