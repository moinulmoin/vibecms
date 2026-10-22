# vibecms - Agent Skills

vibecms provides three specialized agent skills for writing and publishing blog posts:

- **vibecms-core**: Safety-critical contract for publishing. Covers operation order, approval safety, scope enforcement, error handling, and the golden contract that prevents autonomous publish.
- **vibecms-writing**: Writing-specific contract for authoring. Covers rough-thought briefs, uncertainty handling, Voice Profile precedence, exemplar selection, Markdown composition, revision tracking, source attribution, and preference suggestions.
- **vibecms-seo**: Search and AI-answer readiness for a saved draft. Covers running the SEO check, fixing its findings, and answering the judgment questions with your own model before asking for publication approval.

All three skills are located in `skills/` and are designed to be used together for a complete publishing workflow.

---

## Quick Start

1. **Read vibecms-core** for the safety-critical contract and operation order.
2. **Read vibecms-writing** for writing guidance and editorial best practices.
3. **Read vibecms-seo** before asking for publication approval.
4. **Follow the golden contract** from vibecms-core: inspect → draft → read saved content → preview → bind the latest saved version → explicit approval → publish that version → report the returned URL.

---

## Skill Locations

- `skills/vibecms-core/SKILL.md` - Core contract and safety rules
- `skills/vibecms-writing/SKILL.md` - Writing contract and editorial guidance
- `skills/vibecms-seo/SKILL.md` - SEO and AI-answer readiness check

---

## Installation

Install every vibecms skill for Claude Code or another supported Agent Skills client:

```bash
npx skills add moinulmoin/vibecms --skill '*'
```

Or run `npx vibecms-cli skills install`, or call the `skills.list` and `skills.get` MCP tools.

Claude Code users can install every skill together with the hosted MCP server as the `vibecms` plugin:

```bash
claude plugin marketplace add moinulmoin/vibecms
claude plugin install vibecms@vibecms
```

Claude Code asks for your agent key when the plugin is enabled and keeps it in secure storage.

Inside a vibecms repository checkout, compatible agents can also discover the canonical files directly from `skills/`.
