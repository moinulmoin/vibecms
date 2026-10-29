# vibecms-cli

## 0.2.0

### Minor Changes

- 03fc40b: Add `vibecms sites redirects list|set|delete` for exact old-path redirects, and `vibecms posts publish --original-published-at <time>` to keep an imported post's original date on its first publish (an ISO-8601 time with a timezone, such as `2019-06-15T09:30:00Z`). `sites signup-form update` now accepts `externalForm` to send signups to your own newsletter tool.
- 2959ad4: Add `sites location get`, `sites location set-subpath --data '<json>'` (or `--data-file`), `sites location remove`, and `sites location check` to manage subpath proxy locations. Add `posts seo <postId> [--focus-keyword <text>]` for deterministic SEO findings on the saved current tip, without an AI option. All five commands support dry-run request output. Update global and command-specific help and CLI documentation.
- 877f481: Add `vibecms skills list` and `vibecms skills get [name...] [--dir <path>] [--force]`. `get` downloads named skills, or every vibecms agent skill when no names are supplied, from the API host's `/.well-known/agent-skills/` index. It checks each file against its published digest and saves it as `<dir>/<name>/SKILL.md` (default `.agents/skills`). Unknown names fail before any skill files are downloaded or written. Existing files that differ from the latest version are never replaced without `--force`. Neither command needs a token.

### Patch Changes

- 8e9ad3d: Refresh the bundled API description: the image upload and skill download operations now describe what they return instead of telling the agent which tool to use next.

## 0.1.2

### Patch Changes

- 4068d80: Fix the `vibecms` command failing to start when installed from npm or run with `npx`: the entry file now has a Node shebang. `--version` now reports the installed version instead of a hardcoded 0.1.0.

## 0.1.1

### Patch Changes

- 2016d79: Fix `--ndjson` for `posts list` and `posts search`: print one post per line instead of a pretty-printed `{posts, pagination}` envelope.
