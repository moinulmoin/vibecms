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

while IFS= read -r tracked_file; do
  tracked_name="${tracked_file##*/}"
  case "$tracked_name" in
    .env|.env.*|.dev.vars|.dev.vars.*)
      [[ "$tracked_name" == *.example ]] || fail "tracked environment file found: $tracked_file"
      ;;
  esac
done < <(git ls-files)

if find . \
  -path './node_modules' -prune -o \
  -path './.git' -prune -o \
  -path './.wrangler' -prune -o \
  -path './apps/*/dist' -prune -o \
  -path './dist' -prune -o \
  \( -name '.env' -o -name '.env.*' -o -name '.dev.vars' -o -name '.dev.vars.*' \) \
  ! -name '*.example' -print -quit | grep -q .; then
  echo "warning: local env files exist; keep them untracked and do not publish them" >&2
fi

if git grep -I -q -E \
  '(polar_(oat|whs)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|vc_live_[A-Za-z0-9_-]{32,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)' \
  -- . ':(exclude)pnpm-lock.yaml' ':(exclude).agents/**' ':(exclude)scripts/public-release-audit.sh'; then
  fail "possible committed secret found"
fi

if git grep -I -q -E \
  'Downloads/|agent_native_blog_docs|bare-bones RedwoodSDK starter|"license": "MIT"|REDACTED' \
  -- . ':(exclude).agents/**' ':(exclude)scripts/public-release-audit.sh'; then
  fail "private scaffolding or stale metadata found"
fi

echo "public-release audit ok"
