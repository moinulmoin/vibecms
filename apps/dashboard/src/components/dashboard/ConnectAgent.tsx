'use client'

import { CopyButton } from '@vc/ui'

export const READ_ONLY_CHECK_PROMPT =
  'Use the "vibecms" MCP server to verify this connection without changing any content. Call sites.get, posts.list, then posts.format_guide. Report the site name, its public URL when present, and whether the format guide loaded. Do not create, update, publish, archive, delete, restore, or upload anything.'

export const APPROVAL_FIRST_WRITING_PROMPT = `Use the "vibecms" MCP server to prepare a post with an approval-first workflow.

1. Call sites.get and posts.format_guide before drafting.
2. Find relevant published posts with posts.search or posts.list, then read at most three with posts.get to learn this site's voice.
3. Draft the post in Markdown. Call posts.preview and resolve its warnings before saving.
4. Save it as a draft with posts.create. Call posts.versions.list and record the newest versionNumber.
5. Report the title, slug, preview warnings, and versionNumber, then ask me for explicit approval to publish.

Do not call posts.publish in the same turn as drafting, and do not publish unless I explicitly approve in a later message. After I approve, call posts.publish with the draft postId and expectedVersionNumber set to the version I approved. If the version changed, stop, preview the latest version, and ask for approval again. When publishing succeeds, return the URL from the tool result.`

function CodeBlock({ name, hint, code }: { name: string; hint: string; code: string }) {
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium text-foreground">{name}</p>
          <p className="mt-1 font-sans text-xs text-muted-foreground">{hint}</p>
        </div>
        <CopyButton value={code} label="Copy" copiedLabel="Copied" iconOnly className="shrink-0" />
      </div>
      <pre className="max-w-full overflow-x-auto rounded-xl bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
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
  connected = false,
  promptOnly = false,
}: {
  mcpUrl: string
  token?: string
  tokenName?: string
  /** Opens the writing guidance after authentication has been observed. */
  connected?: boolean
  /** When true, show only the protected check and approval-first writing prompts. */
  promptOnly?: boolean
}) {
  const tok = token ?? 'vc_YOUR_TOKEN'
  const claudeCode = `claude mcp add --transport http vibecms ${mcpUrl} --header "Authorization: Bearer ${tok}"`
  const skillsInstall =
    'npx skills add moinulmoin/vibecms --skill vibecms-core --skill vibecms-writing'
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

  return (
    <div className="grid gap-5">
      {!promptOnly && token ? (
        <div className="grid min-w-0 gap-3 rounded-2xl bg-muted/50 p-4">
          <div className="space-y-1">
            <p className="font-mono text-[11px] font-medium text-primary">
              {tokenName ?? 'Agent token'}
            </p>
            <p className="font-sans text-xs leading-5 text-muted-foreground">
              Copy this token now. For security it is shown only once - it is already baked into the snippets below.
            </p>
          </div>
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-background/80 p-4 font-mono text-sm text-primary">
            {token}
          </pre>
          <CopyButton value={token} label="Copy token" copiedLabel="Token copied" className="w-fit" />
        </div>
      ) : null}

      {!promptOnly ? (
        <>
          <Section
            title="1. Add VibeCMS to your agent"
            description={
              token
                ? 'Claude Code is the primary example. VibeCMS uses the standard Streamable HTTP transport. Any compatible MCP client uses the same URL and Authorization header.'
                : 'Use a token you saved previously, or create a new token above to get a ready-to-paste command.'
            }
          >
            <div className="grid min-w-0 gap-3">
              <CodeBlock name="Claude Code · primary example" hint="Run this once in your terminal." code={claudeCode} />
              <details className="group rounded-xl bg-muted/50">
                <summary className="cursor-pointer select-none px-3 py-2.5 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground">
                  Other MCP clients
                </summary>
                <div className="grid min-w-0 gap-3 px-3 pb-3">
                  <CodeBlock name="Codex CLI" hint="Add to ~/.codex/config.toml." code={codex} />
                  <CodeBlock
                    name="Cursor"
                    hint="Add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project)."
                    code={cursor}
                  />
                  <CodeBlock
                    name="Any Streamable HTTP MCP client"
                    hint="Use standard mcpServers JSON with the endpoint and Bearer token."
                    code={generic}
                  />
                </div>
              </details>
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <code className="min-w-0 break-all rounded-xl bg-muted/50 px-3 py-2 font-mono text-sm text-foreground">
                  {mcpUrl}
                </code>
                <CopyButton value={mcpUrl} label="Copy MCP URL" copiedLabel="Copied" className="shrink-0" />
              </div>
            </div>
          </Section>

          <Section
            title="Install the VibeCMS skills"
            description="The MCP server provides capabilities; these two client-independent skills provide the safe operating contract and editorial method."
          >
            <CodeBlock
              name="vibecms-core + vibecms-writing"
              hint="Install both once in your Agent Skills-compatible client."
              code={skillsInstall}
            />
          </Section>
        </>
      ) : null}

      <Section
        title="2. Verify read-only access"
        description="Run this protected check next. It confirms the connection without changing your site."
      >
        <CodeBlock
          name="Read-only connection check"
          hint="Safe to run before you are ready to draft."
          code={READ_ONLY_CHECK_PROMPT}
        />
      </Section>

      <details className="group rounded-xl bg-muted/50" open={connected || undefined}>
        <summary className="cursor-pointer select-none px-3 py-2.5 font-display text-sm font-semibold text-foreground">
          3. Draft, review, then approve
        </summary>
        <div className="grid min-w-0 gap-3 px-3 pb-3">
          <p className="font-sans text-xs leading-5 text-muted-foreground">
            This creates a draft and preview, but requires a separate explicit approval before publishing the exact
            version you reviewed.
          </p>
          <CodeBlock
            name="Approval-first writing flow"
            hint="Publishing is deliberately deferred to a later approval message."
            code={APPROVAL_FIRST_WRITING_PROMPT}
          />
        </div>
      </details>
    </div>
  )
}
