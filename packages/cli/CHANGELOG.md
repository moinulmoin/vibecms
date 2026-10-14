# vibecms-cli

## 0.1.2

### Patch Changes

- 4068d80: Fix the `vibecms` command failing to start when installed from npm or run with `npx`: the entry file now has a Node shebang. `--version` now reports the installed version instead of a hardcoded 0.1.0.

## 0.1.1

### Patch Changes

- 2016d79: Fix `--ndjson` for `posts list` and `posts search`: print one post per line instead of a pretty-printed `{posts, pagination}` envelope.
