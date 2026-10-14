---
"vibecms-cli": patch
---

Fix the `vibecms` command failing to start when installed from npm or run with `npx`: the entry file now has a Node shebang. `--version` now reports the installed version instead of a hardcoded 0.1.0.
