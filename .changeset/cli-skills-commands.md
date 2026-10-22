---
"vibecms-cli": minor
---

Add `vibecms skills list` and `vibecms skills install [--dir <path>] [--force]`. `install` downloads every vibecms agent skill from the API host's `/.well-known/agent-skills/` index, checks each file against its published digest, and saves it as `<dir>/<name>/SKILL.md` (default `.agents/skills`). It never replaces a skill file that differs from the latest version unless you pass `--force`. Neither command needs a token.
