import { CopyButton, cn } from '@vc/ui'
import type { ReactNode } from 'react'
import { Tabs, TabsContent } from '~/components/ui/tabs'
import { PageTabs } from '~/components/dashboard/blocks'
import type { AgentPreference } from '~/types/dashboard'

export type AgentClient = 'claude_code' | 'codex' | 'cursor' | 'other'

export const AGENT_CLIENTS: Array<{ id: AgentClient; label: string }> = [
  { id: 'claude_code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'other', label: 'Other' },
]

export function isAgentClient(value: unknown): value is AgentClient {
  return value === 'claude_code' || value === 'codex' || value === 'cursor' || value === 'other'
}

export function clientFromPreference(preference: AgentPreference | null | undefined): AgentClient {
  return preference && isAgentClient(preference) ? preference : preference === 'droid' ? 'other' : 'claude_code'
}

export const TOKEN_PLACEHOLDER = 'YOUR_KEY'

/** What to paste into the agent once it is connected. Publishing still waits for a yes. */
export const FIRST_POST_PROMPT =
  'Use vibecms to write a short first post for my blog: a friendly hello that says what this blog will be about. Save it as a draft, show me the title and a short preview, and publish it only after I say yes.'

export const READ_ONLY_CHECK_PROMPT =
  'Use the "vibecms" MCP server to verify this connection without changing any content. Call sites.get, posts.list, then posts.format_guide. Report the site name, its public URL when present, and whether the format guide loaded. Do not create, update, publish, archive, delete, restore, or upload anything.'

export const APPROVAL_FIRST_WRITING_PROMPT = `Use the "vibecms" MCP server to prepare a post with an approval-first workflow.

1. Call sites.get and posts.format_guide before drafting.
2. Find relevant published posts with posts.search or posts.list, then read at most three with posts.get to learn this site's voice.
3. Draft the post in Markdown. Call posts.preview and resolve its warnings before saving.
4. Save it as a draft with posts.create. Call posts.versions.list and record the newest versionNumber.
5. Report the title, slug, preview warnings, and versionNumber, then ask me for explicit approval to publish.

Do not call posts.publish in the same turn as drafting, and do not publish unless I explicitly approve in a later message. For posts.update and posts.versions.restore, always send expectedVersionNumber for the current tip; public output stays on publishedVersionNumber until publish. After I approve, call posts.publish with the draft postId and expectedVersionNumber set to the version I approved. If the version changed, stop, preview the latest version, and ask for approval again. When publishing succeeds, return the URL from the tool result.`

export const SKILLS_INSTALL_COMMAND = 'npx skills add moinulmoin/vibecms --skill vibecms-core --skill vibecms-writing'

type ClientConfig = { hint: ReactNode; code: string; label: string }

export function agentConfigs(mcpUrl: string, token?: string): Record<AgentClient, ClientConfig> {
  const key = token ?? TOKEN_PLACEHOLDER
  return {
    claude_code: {
      label: 'Terminal command',
      hint: 'Run this once in your terminal. Then start Claude Code.',
      code: `claude mcp add --transport http vibecms ${mcpUrl} --header "Authorization: Bearer ${key}"`,
    },
    codex: {
      label: '~/.codex/config.toml',
      hint: (
        <>
          Add this to <code className="font-mono text-foreground">~/.codex/config.toml</code>, then restart Codex.
        </>
      ),
      code: `[mcp_servers.vibecms]
url = "${mcpUrl}"
http_headers = { "Authorization" = "Bearer ${key}" }`,
    },
    cursor: {
      label: '~/.cursor/mcp.json',
      hint: (
        <>
          Add this to <code className="font-mono text-foreground">~/.cursor/mcp.json</code> (or a project’s{' '}
          <code className="font-mono text-foreground">.cursor/mcp.json</code>).
        </>
      ),
      code: `{
  "mcpServers": {
    "vibecms": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${key}" }
    }
  }
}`,
    },
    other: {
      label: 'MCP config',
      hint: 'Any client that supports remote MCP over HTTP works with the same address and key.',
      code: `{
  "mcpServers": {
    "vibecms": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${key}" }
    }
  }
}`,
    },
  }
}

/** One-click install link for Cursor. Only offered once a real key exists. */
export function cursorInstallUrl(mcpUrl: string, token: string) {
  const config = JSON.stringify({ url: mcpUrl, headers: { Authorization: `Bearer ${token}` } })
  const encoded = typeof btoa === 'function' ? btoa(config) : Buffer.from(config).toString('base64')
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=vibecms&config=${encodeURIComponent(encoded)}`
}

export function CodeBlock({
  label,
  code,
  copyLabel = 'Copy',
  className,
}: {
  label: string
  code: string
  copyLabel?: string
  className?: string
}) {
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-lg border border-border bg-muted/40', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] py-1.5 pl-3.5 pr-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">{label}</span>
        <CopyButton value={code} label={copyLabel} copiedLabel="Copied" className="h-8 shrink-0" />
      </div>
      <pre
        role="region"
        aria-label={label}
        tabIndex={0}
        className="max-w-full min-w-0 overflow-x-auto whitespace-pre-wrap [overflow-wrap:anywhere] p-3.5 font-mono text-[0.8125rem] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {code}
      </pre>
    </div>
  )
}

/** Per-client setup tabs. The token is embedded when one was just created. */
export function AgentSetup({
  mcpUrl,
  token,
  client,
  onClientChange,
}: {
  mcpUrl: string
  token?: string
  client: AgentClient
  onClientChange: (client: AgentClient) => void
}) {
  const configs = agentConfigs(mcpUrl, token)
  return (
    <Tabs value={client} onValueChange={(value) => isAgentClient(value) && onClientChange(value)} className="gap-4">
      <PageTabs label="Agent" tabs={AGENT_CLIENTS.map((item) => ({ value: item.id, label: item.label }))} />
      {AGENT_CLIENTS.map(({ id }) => {
        const config = configs[id]
        return (
          <TabsContent key={id} value={id} className="grid min-w-0 gap-3">
            <p className="text-sm leading-6 text-muted-foreground">{config.hint}</p>
            <CodeBlock label={config.label} code={config.code} copyLabel={id === 'claude_code' ? 'Copy command' : 'Copy'} />
            {id === 'cursor' && token ? (
              <a
                href={cursorInstallUrl(mcpUrl, token)}
                className="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Or add it to Cursor in one click
              </a>
            ) : null}
            {id === 'other' ? (
              <dl className="grid gap-2 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
                <dt className="text-muted-foreground">Server address</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <code className="min-w-0 truncate font-mono text-[0.8125rem] text-foreground">{mcpUrl}</code>
                  <CopyButton value={mcpUrl} label="Copy address" copiedLabel="Copied" iconOnly className="size-7 shrink-0" />
                </dd>
                <dt className="text-muted-foreground">Header</dt>
                <dd className="min-w-0 truncate font-mono text-[0.8125rem] text-foreground">
                  Authorization: Bearer {token ? `${token.slice(0, 10)}…` : TOKEN_PLACEHOLDER}
                </dd>
              </dl>
            ) : null}
            {!token ? (
              <p className="text-sm text-muted-foreground">
                Replace <code className="font-mono text-foreground">{TOKEN_PLACEHOLDER}</code> with a key you saved, or create a new one below.
              </p>
            ) : null}
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

/** The prompt to paste once connected. */
export function FirstPostPrompt() {
  return <CodeBlock label="Paste into your agent" code={FIRST_POST_PROMPT} copyLabel="Copy prompt" />
}
