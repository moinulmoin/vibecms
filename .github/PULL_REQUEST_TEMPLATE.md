## Summary

<!-- What changed and why? -->

## Checks

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm build`
- [ ] `pnpm public:audit` when touching docs/config/release files

## Safety

- [ ] No `.env`, `.dev.vars`, tokens, cookies, Cloudflare credentials, Polar credentials, or production user data included
- [ ] Mutations create activity where applicable
- [ ] Meaningful post changes create versions where applicable
