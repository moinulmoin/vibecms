/** Preview links and pending sign-in requests carry their secret in the path; never log them. */
export function redactPathSecrets(pathname: string) {
  return pathname
    .replace(/\/preview\/[^/]+/g, '/preview/[redacted]')
    .replace(/\/oauth\/requests\/[^/]+/g, '/oauth/requests/[redacted]')
}

export function redactErrorText(value: string | undefined) {
  if (!value) return undefined
  return value
    .slice(0, 2_000)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    // Header-style credentials (Cookie: a=b; c=d) are redacted to the end of the line.
    .replace(/(authorization|cookie|set-cookie)["']?\s*[:=][^\r\n]*/gi, '$1=[redacted]')
    // key=value / "key": "value", including quoted values with spaces.
    .replace(/(token|secret|otp|password|api[_-]?key)["']?\s*[:=]\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;}]+)/gi, '$1=[redacted]')
    .replace(/\bvc_[a-z]+_[A-Za-z0-9_-]+/g, '[redacted-key]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/\b\d{6}\b/g, '[redacted-otp]')
    .replace(/\/preview\/[^/\s"')]+/g, '/preview/[redacted]')
}

/** Cause links followed below the top-level error; deeper or cyclic links are marked truncated. */
export const MAX_LOGGED_CAUSE_DEPTH = 3

export type LoggedError = {
  name: string
  message?: string
  stack?: string
  cause?: LoggedError | { truncated: true }
}

function safeText(read: () => unknown): string | undefined {
  try {
    const value = read()
    return value === undefined || value === null ? undefined : String(value)
  } catch {
    return '[unreadable]'
  }
}

function serialize(error: unknown, depth: number, seen: Set<unknown>): LoggedError {
  if (!(error instanceof Error)) {
    return { name: typeof error, message: redactErrorText(safeText(() => error)) }
  }
  seen.add(error)
  const logged: LoggedError = {
    name: redactErrorText(safeText(() => error.name))?.slice(0, 200) ?? 'Error',
    message: redactErrorText(safeText(() => error.message)),
    stack: redactErrorText(safeText(() => error.stack)),
  }
  let cause: unknown
  try {
    cause = error.cause
  } catch {
    cause = '[unreadable cause]'
  }
  if (cause !== undefined) {
    logged.cause = depth >= MAX_LOGGED_CAUSE_DEPTH || seen.has(cause)
      ? { truncated: true }
      : serialize(cause, depth + 1, seen)
  }
  return logged
}

/** Sanitized, bounded error shape for structured logs: every text field is redacted and capped. */
export function serializeErrorForLog(error: unknown): LoggedError {
  return serialize(error, 0, new Set())
}

export type UnhandledExceptionLog = {
  surface: 'app' | 'rest' | 'mcp'
  requestId: string | null
  method: string
  /** Request URL or pathname; only the redacted pathname is logged. */
  url: string
  cfRay?: string | null
  tool?: string
  error: unknown
}

/** The single structured log line for an unexpected (non-domain) exception. */
export function logUnhandledException(input: UnhandledExceptionLog) {
  console.error(JSON.stringify({
    level: 'error',
    event: 'unhandled_exception',
    service: 'vibecms-api',
    surface: input.surface,
    requestId: input.requestId,
    method: input.method,
    path: redactPathSecrets(new URL(input.url, 'http://local').pathname),
    cfRay: input.cfRay ?? null,
    ...(input.tool ? { tool: input.tool } : {}),
    error: serializeErrorForLog(input.error),
  }))
}
