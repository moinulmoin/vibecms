# vibecms - Agent Skills

vibecms provides two specialized agent skills for writing and publishing blog posts:

- **vibecms-core**: Safety-critical contract for publishing. Covers operation order, approval safety, scope enforcement, error handling, and the golden contract that prevents autonomous publish.
- **vibecms-writing**: Writing-specific contract for authoring. Covers rough-thought briefs, uncertainty handling, Voice Profile precedence, exemplar selection, Markdown composition, revision tracking, source attribution, and preference suggestions.

Both skills are located in `plugins/vibecms/skills/` and are designed to be used together for a complete publishing workflow.

---

## Quick Start

1. **Read vibecms-core** for the safety-critical contract and operation order.
2. **Read vibecms-writing** for writing guidance and editorial best practices.
3. **Follow the golden contract** from vibecms-core: inspect → draft → read saved content → preview → bind the latest saved version → explicit approval → publish that version → report the returned URL.

---

## Skill Locations

- `plugins/vibecms/skills/vibecms-core/SKILL.md` - Core contract and safety rules
- `plugins/vibecms/skills/vibecms-writing/SKILL.md` - Writing contract and editorial guidance

---

## Installation

Install both skills for Claude Code or another supported Agent Skills client:

```bash
npx skills add moinulmoin/vibecms --skill vibecms-core --skill vibecms-writing
```

Claude Code users can install both skills together with the hosted MCP server as the `vibecms` plugin:

```bash
claude plugin marketplace add moinulmoin/vibecms
claude plugin install vibecms@vibecms
```

Claude Code asks for your agent key when the plugin is enabled and keeps it in secure storage.

Inside a vibecms repository checkout, compatible agents can also discover the canonical files directly from `plugins/vibecms/skills/`.
