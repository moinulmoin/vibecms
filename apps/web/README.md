# VibeCMS Web Worker

RedwoodSDK/Cloudflare Worker app for VibeCMS.

Most project commands should be run from the repository root:

```sh
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm build
```

Local development secrets belong in `apps/web/.env` or `apps/web/.dev.vars`; never commit them. Use `apps/web/dev.vars.example` as the shape for self-host/local values.

Relevant docs:

- Root README: `../../README.md`
- Self-hosting: `../../docs/self-hosting.md`
- Launch rehearsal: `../../docs/launch-rehearsal.md`
