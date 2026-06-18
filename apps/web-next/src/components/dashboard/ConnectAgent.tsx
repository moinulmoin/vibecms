'use client'

import { CopyButton } from '@vc/ui'

const STARTER_PROMPT = [
  'You\'re connected to my VibeCMS blog through the "vibecms" MCP server.',
  'Use its tools to help me run the blog.',
  'First, call sites.get to confirm access.',
  'Then draft a short welcome post with posts.create and leave it as a draft for me to review (do not publish).',
  'Write the body in Markdown.',
  'Finally, tell me what you can do for the blog from here.',
].join(' ')

function CodeBlock({ name, hint, code }: { name: string; hint: string; code: string }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-foreground">{name}</p>
          <p className="mt-1 font-sans text-xs text-muted-foreground">{hint}</p>
        </div>
        <CopyButton value={code} label="Copy" copiedLabel="Copied" iconOnly />
      </div>
      <pre className="overflow-auto rounded-xl bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
        {code}
      </pre>
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="grid gap-3">
      <div className="space-y-1">
        <h3 className="font-display text-sm font-semibold text-foreground">{title}</h3>
        <p className="font-sans text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

export function ConnectAgent({
  mcpUrl,
  token,
  tokenName,
}: {
  mcpUrl: string
  token?: string
  tokenName?: string
}) {
  const tok = token ?? 'vc_YOUR_TOKEN'
  const claudeCode = `claude mcp add --transport http vibecms ${mcpUrl} --header "Authorization: Bearer ${tok}"`
  const codex = `# ~/.codex/config.toml
[mcp_servers.vibecms]
url = "${mcpUrl}"
http_headers = { "Authorization" = "Bearer ${tok}" }`
  const cursor = `// ~/.cursor/mcp.json
{
  "mcpServers": {
    "vibecms": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${tok}" }
    }
  }
}`
  const generic = `{
  "mcpServers": {
    "vibecms": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${tok}" }
    }
  }
}`
  const mcpRemote = `npx -y mcp-remote ${mcpUrl} --header "Authorization: Bearer ${tok}" --transport http-only`

  return (
    <div className="grid gap-3">
      {token ? (
        <div className="grid gap-3 rounded-2xl bg-muted/50 p-4">
          <div className="space-y-1">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-brand-bright">
              {tokenName ?? 'Agent token'}
            </p>
            <p className="font-sans text-xs leading-5 text-muted-foreground">
              Copy this token now. For security it is shown only once - it is already baked into the snippets below.
            </p>
          </div>
          <pre className="overflow-auto rounded-xl bg-background/80 p-4 font-mono text-sm text-brand-bright">
            {token}
          </pre>
          <CopyButton value={token} label="Copy token" copiedLabel="Token copied" className="w-fit" />
        </div>
      ) : null}

      <Section title="MCP endpoint" description="Your blog speaks the Model Context Protocol over HTTP. Point any agent here.">
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded-xl bg-muted/50 px-3 py-2 font-mono text-sm text-foreground">{mcpUrl}</code>
          <CopyButton value={mcpUrl} label="Copy URL" copiedLabel="Copied" />
        </div>
      </Section>

      <Section
        title="Add it to your agent"
        description="Paste the snippet for your tool, then start a session. The server teaches the agent the rest."
      >
        <div className="grid gap-3">
          <CodeBlock name="Claude Code" hint="Run this once in your terminal." code={claudeCode} />
          <CodeBlock name="Codex CLI" hint="Add to ~/.codex/config.toml." code={codex} />
          <details className="group rounded-xl bg-muted/50">
            <summary className="cursor-pointer select-none px-3 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground">
              More clients (Cursor, Claude Desktop, others)
            </summary>
            <div className="grid gap-3 px-3 pb-3">
              <CodeBlock
                name="Cursor"
                hint="Add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project)."
                code={cursor}
              />
              <CodeBlock
                name="Any HTTP-MCP client"
                hint="Standard mcpServers JSON with a Streamable HTTP transport."
                code={generic}
              />
              <CodeBlock
                name="Stdio-only clients (Claude Desktop, etc.)"
                hint="Bridge to the remote endpoint with mcp-remote."
                code={mcpRemote}
              />
            </div>
          </details>
        </div>
      </Section>

      <Section
        title="Hand it the first task"
        description="After connecting, paste this into your agent and it will take it from there."
      >
        <CodeBlock
          name="Starter prompt"
          hint="Confirms access and drafts a first post for your review."
          code={STARTER_PROMPT}
        />
      </Section>
    </div>
  )
}
