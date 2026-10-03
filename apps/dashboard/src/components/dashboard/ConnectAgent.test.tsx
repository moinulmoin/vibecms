import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_FIRST_WRITING_PROMPT,
  AgentSetup,
  FIRST_POST_PROMPT,
  READ_ONLY_CHECK_PROMPT,
  TOKEN_PLACEHOLDER,
  agentConfigs,
  clientFromPreference,
  cursorInstallUrl,
} from './ConnectAgent'

const MCP = 'https://app.example.com/mcp'

describe('agent setup', () => {
  it('offers one tab per popular client plus a generic HTTP option', () => {
    const html = renderToStaticMarkup(
      <AgentSetup mcpUrl={MCP} token="vc_secret" client="claude_code" onClientChange={() => undefined} />,
    )
    for (const label of ['Claude Code', 'Codex', 'Cursor', 'Other']) expect(html).toContain(label)
    expect(html).toContain('claude mcp add --transport http vibecms https://app.example.com/mcp')
    expect(html).toContain('Bearer vc_secret')
  })

  it('embeds a fresh key in every config and falls back to a placeholder', () => {
    const withKey = agentConfigs(MCP, 'vc_secret')
    const withoutKey = agentConfigs(MCP)
    for (const config of Object.values(withKey)) expect(config.code).toContain('vc_secret')
    for (const config of Object.values(withoutKey)) expect(config.code).toContain(TOKEN_PLACEHOLDER)
    expect(withKey.codex.code).toContain('[mcp_servers.vibecms]')
    expect(withKey.cursor.code).toContain('"mcpServers"')
  })

  it('builds a Cursor one-click link with the encoded config', () => {
    const url = cursorInstallUrl(MCP, 'vc_secret')
    expect(url.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=vibecms&config=')).toBe(true)
    const encoded = decodeURIComponent(url.split('config=')[1] ?? '')
    expect(JSON.parse(atob(encoded))).toEqual({ url: MCP, headers: { Authorization: 'Bearer vc_secret' } })
  })

  it('maps the saved client preference to a tab', () => {
    expect(clientFromPreference('cursor')).toBe('cursor')
    expect(clientFromPreference('droid')).toBe('other')
    expect(clientFromPreference(null)).toBe('claude_code')
  })
})

describe('agent prompts', () => {
  it('asks for approval before the first post is published', () => {
    expect(FIRST_POST_PROMPT).toContain('Save it as a draft')
    expect(FIRST_POST_PROMPT).toContain('only after I say yes')
  })

  it('keeps the protected connection check read-only', () => {
    expect(READ_ONLY_CHECK_PROMPT).toContain('without changing any content')
    expect(READ_ONLY_CHECK_PROMPT).toContain('Do not create, update, publish, archive, delete, restore, or upload anything')
  })

  it('defers publishing to explicit later approval and pins the reviewed version', () => {
    expect(APPROVAL_FIRST_WRITING_PROMPT).toContain('Do not call posts.publish in the same turn as drafting')
    expect(APPROVAL_FIRST_WRITING_PROMPT).toContain('expectedVersionNumber')
  })
})
