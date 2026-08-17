import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_FIRST_WRITING_PROMPT,
  ConnectAgent,
  READ_ONLY_CHECK_PROMPT,
} from './ConnectAgent'

describe('ConnectAgent onboarding contract', () => {
  it('frames VibeCMS as universal Streamable HTTP MCP with Claude Code as the primary example', () => {
    const html = renderToStaticMarkup(
      <ConnectAgent mcpUrl="https://app.example.com/mcp" token="vc_secret" tokenName="Publishing agent" />,
    )

    expect(html).toContain('standard Streamable HTTP transport')
    expect(html).toContain('Any compatible MCP client')
    expect(html).toContain('Claude Code · primary example')
    expect(html).toContain('Other MCP clients')
    expect(html).toContain('vibecms-core')
    expect(html).toContain('vibecms-writing')
    expect(html).not.toContain('Claude Desktop')
    expect(html).not.toContain('mcp-remote')
  })

  it('promotes the Make it yours agent to the primary snippet', () => {
    const cursorHtml = renderToStaticMarkup(
      <ConnectAgent mcpUrl="https://app.example.com/mcp" token="vc_secret" preferredAgent="cursor" />,
    )
    expect(cursorHtml).toContain('1. Add VibeCMS to Cursor')
    expect(cursorHtml).toContain('Cursor · configured for you')
    expect(cursorHtml).toContain('Pre-configured from your Make it yours answer')
    // Alternates keep every other client reachable.
    expect(cursorHtml).toContain('Claude Code')
    expect(cursorHtml).toContain('Codex CLI')

    const droidHtml = renderToStaticMarkup(
      <ConnectAgent mcpUrl="https://app.example.com/mcp" token="vc_secret" preferredAgent="droid" />,
    )
    expect(droidHtml).toContain('Droid · configured for you')
    // The generic block is folded into the Droid primary, not duplicated below.
    expect((droidHtml.match(/Any Streamable HTTP MCP client/g) ?? []).length).toBe(0)
  })

  it('progressively discloses alternate clients and writing guidance with native details', () => {
    const disconnected = renderToStaticMarkup(
      <ConnectAgent mcpUrl="https://app.example.com/mcp" token="vc_secret" tokenName="Publishing agent" />,
    )
    const connected = renderToStaticMarkup(
      <ConnectAgent mcpUrl="https://app.example.com/mcp" token="vc_secret" tokenName="Publishing agent" connected />,
    )

    expect(disconnected).toContain('<details')
    expect(disconnected).toContain('Other MCP clients')
    expect(disconnected).toContain('2. Verify read-only access')
    expect(disconnected).toContain('3. Draft, review, then approve')
    expect(disconnected).not.toMatch(/<details[^>]* open="">/)
    expect(connected).toMatch(/<details[^>]* open="">/)
    expect(disconnected).toContain('max-w-full overflow-x-auto')
    expect(disconnected).toContain('break-all')
  })

  it('keeps the protected connection check read-only', () => {
    expect(READ_ONLY_CHECK_PROMPT).toContain('sites.get')
    expect(READ_ONLY_CHECK_PROMPT).toContain('posts.list')
    expect(READ_ONLY_CHECK_PROMPT).toContain('posts.format_guide')
    expect(READ_ONLY_CHECK_PROMPT).toContain('without changing any content')
    expect(READ_ONLY_CHECK_PROMPT).toContain('Do not create, update, publish, archive, delete, restore, or upload anything')
  })

  it('defers publishing to explicit later approval and pins the reviewed version', () => {
    expect(APPROVAL_FIRST_WRITING_PROMPT).toContain('read at most three')
    expect(APPROVAL_FIRST_WRITING_PROMPT).toContain('posts.preview')
    expect(APPROVAL_FIRST_WRITING_PROMPT).toContain('posts.versions.list')
    expect(APPROVAL_FIRST_WRITING_PROMPT).toContain('explicit approval')
    expect(APPROVAL_FIRST_WRITING_PROMPT).toContain('Do not call posts.publish in the same turn as drafting')
    expect(APPROVAL_FIRST_WRITING_PROMPT).toContain('expectedVersionNumber')
    expect(APPROVAL_FIRST_WRITING_PROMPT).toContain('version I approved')
    expect(APPROVAL_FIRST_WRITING_PROMPT).toContain('return the URL from the tool result')
  })
})
