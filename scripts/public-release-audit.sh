#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "public-release audit failed: $*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "missing $1"
}

require_file LICENSE
require_file SECURITY.md
require_file CONTRIBUTING.md
require_file TRADEMARKS.md
require_file CODE_OF_CONDUCT.md
require_file .dev.vars.example
require_file apps/api/.dev.vars.example
require_file wrangler.jsonc
require_file wrangler.public.jsonc

if find . -path './node_modules' -prune -o -path './.wrangler' -prune -o -path './apps/*/dist' -prune -o -path './dist' -prune -o -name '.env' -o -name '.env.*' -o -name '.dev.vars' -o -name '.dev.vars.*' | grep -vE '(\.example)$' | grep -q .; then
  echo "warning: local env files exist; keep them untracked and do not publish them" >&2
fi

if rg -n --hidden --glob '!**/node_modules/**' --glob '!**/.vite/**' --glob '!**/dist/**' --glob '!.wrangler/**' --glob '!pnpm-lock.yaml' --glob '!apps/api/.dev.vars' --glob '!.agents/**' --glob '!scripts/public-release-audit.sh' '(polar_(oat|whs)_[A-Za-z0-9]+|ghp_[A-Za-z0-9_]+|\bsk-[A-Za-z0-9_]+|AIza[0-9A-Za-z_-]+|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)' .; then
  fail "possible committed secret found"
fi

if rg -n --hidden --glob '!**/node_modules/**' --glob '!**/.vite/**' --glob '!**/dist/**' --glob '!.wrangler/**' --glob '!.agents/**' --glob '!scripts/public-release-audit.sh' 'Downloads/|agent_native_blog_docs|bare-bones RedwoodSDK starter|"license": "MIT"|REDACTED' .; then
  fail "private scaffolding or stale metadata found"
fi

echo "public-release audit ok"
