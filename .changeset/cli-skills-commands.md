---
"vibecms-cli": minor
---

Add `vibecms skills list` and `vibecms skills get [name...] [--dir <path>] [--force]`. `get` downloads named skills, or every vibecms agent skill when no names are supplied, from the API host's `/.well-known/agent-skills/` index. It checks each file against its published digest and saves it as `<dir>/<name>/SKILL.md` (default `.agents/skills`). Unknown names fail before any skill files are downloaded or written. Existing files that differ from the latest version are never replaced without `--force`. Neither command needs a token.
