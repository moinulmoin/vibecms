import { AGENT_TOOL_COUNT } from '@vc/config';
import { describe, expect, it } from 'vitest';
import operationsSource from '../../../../../packages/api-contract/src/operations.ts?raw';

const pages = import.meta.glob('./**/*.{mdx,json}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const read = (path: string) => pages[`./${path}`];

const requiredPages = {
  'agent-workflows': ['scopes-and-tools', 'managing-the-site'],
  content: ['previews-and-scheduling', 'urls-and-redirects', 'built-for-agents'],
};

describe('documentation contract', () => {
  it('lists every MCP operation under its required scope', () => {
    const page = read('agent-workflows/scopes-and-tools.mdx');
    const operations = [...operationsSource.matchAll(/toolName:\s*["']([^"']+)["']\s*,[^\n]*?(?:\n[^\n]*){0,3}?requiredScope:\s*["']([^"']+)["']/g)];
    expect(operations).toHaveLength(AGENT_TOOL_COUNT);
    const rows = new Map([...page.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)].map((match) => [match[1], match[2]]));
    for (const [, name, scope] of operations) {
      expect(rows.get(scope), `${name} should appear under ${scope}`).toContain(`\`${name}\``);
    }
  });

  it('keeps new pages in the sidebar with frontmatter and current branding', () => {
    for (const [section, names] of Object.entries(requiredPages)) {
      const meta = JSON.parse(read(`${section}/meta.json`)) as { pages: string[] };
      for (const name of names) {
        expect(meta.pages).toContain(name);
        expect(read(`${section}/${name}.mdx`)).toMatch(/^---\ntitle: .+\ndescription: .+\n---/);
      }
    }
    for (const [path, body] of Object.entries(pages)) {
      if (path.endsWith('.mdx')) expect(body, path).not.toContain('VibeCMS');
    }
    expect(read('agent-workflows/scopes-and-tools.mdx')).toContain('**Never available to agents:**');
  });
});
