/**
 * Line diff (Myers, O((n+m)·D)) with common prefix/suffix trimmed first. A
 * replaced line renders as `del` (old) then `add` (new). Very large rewrites
 * past MAX_EDITS fall back to one replaced block instead of a slow diff.
 */

export type DiffLine = { type: 'add' | 'del' | 'same'; text: string }

const MAX_EDITS = 1500

/** Split a string into its lines; an empty string yields no lines. */
const lines = (s: string): string[] => (s === '' ? [] : s.split(/\r?\n/))

function myers(a: string[], b: string[]): DiffLine[] | null {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, MAX_EDITS)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    // Only diagonals -d..d are live at step d; keep just that window.
    trace.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
      let x = down ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(a, b, trace, d)
    }
  }
  return null
}

function backtrack(a: string[], b: string[], trace: Int32Array[], lastD: number): DiffLine[] {
  const out: DiffLine[] = []
  let x = a.length
  let y = b.length
  for (let d = lastD; d >= 0; d--) {
    const window = trace[d]
    const at = (k: number) => window[k + d + 1]
    const k = x - y
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1))
    const prevK = down ? k + 1 : k - 1
    const prevX = d === 0 ? 0 : at(prevK)
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      out.push({ type: 'same', text: a[x - 1] })
      x--
      y--
    }
    if (d === 0) break
    if (down) {
      out.push({ type: 'add', text: b[y - 1] })
      y--
    } else {
      out.push({ type: 'del', text: a[x - 1] })
      x--
    }
  }
  return out.reverse()
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = lines(before)
  const b = lines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const head = a.slice(0, start).map((text): DiffLine => ({ type: 'same', text }))
  const tail = a.slice(endA).map((text): DiffLine => ({ type: 'same', text }))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const middle = myers(midA, midB) ?? [
    ...midA.map((text): DiffLine => ({ type: 'del', text })),
    ...midB.map((text): DiffLine => ({ type: 'add', text })),
  ]
  // Within a changed run, show all removals before additions so a rewritten
  // paragraph reads as old block → new block.
  return [...head, ...groupChanges(middle), ...tail]
}

function groupChanges(input: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = []
  let dels: DiffLine[] = []
  let adds: DiffLine[] = []
  const flush = () => {
    out.push(...dels, ...adds)
    dels = []
    adds = []
  }
  for (const line of input) {
    if (line.type === 'same') {
      flush()
      out.push(line)
    } else if (line.type === 'del') dels.push(line)
    else adds.push(line)
  }
  flush()
  return out
}

export type DiffHunk =
  | { type: 'lines'; lines: DiffLine[] }
  | { type: 'skip'; count: number; lines: DiffLine[] }

/** Collapse long unchanged runs, keeping `context` lines around each change. */
export function collapseUnchanged(diff: DiffLine[], context = 3): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let run: DiffLine[] = []
  let current: DiffLine[] = []
  const pushLines = (items: DiffLine[]) => {
    if (items.length) current.push(...items)
  }
  const flushCurrent = () => {
    if (current.length) hunks.push({ type: 'lines', lines: current })
    current = []
  }
  const closeRun = (atEnd: boolean) => {
    const isStart = hunks.length === 0 && current.length === 0
    const keepBefore = isStart ? 0 : context
    const keepAfter = atEnd ? 0 : context
    if (run.length <= keepBefore + keepAfter + 1) {
      pushLines(run)
    } else {
      pushLines(run.slice(0, keepBefore))
      flushCurrent()
      const hidden = run.slice(keepBefore, run.length - keepAfter)
      hunks.push({ type: 'skip', count: hidden.length, lines: hidden })
      pushLines(run.slice(run.length - keepAfter))
    }
    run = []
  }
  for (const line of diff) {
    if (line.type === 'same') {
      run.push(line)
      continue
    }
    if (run.length) closeRun(false)
    current.push(line)
  }
  if (run.length) closeRun(true)
  flushCurrent()
  return hunks
}

export function diffStats(diff: DiffLine[]) {
  let added = 0
  let removed = 0
  for (const line of diff) {
    if (line.type === 'add') added++
    else if (line.type === 'del') removed++
  }
  return { added, removed }
}
