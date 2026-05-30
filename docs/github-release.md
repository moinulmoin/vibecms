# GitHub Release Checklist

Use this when cutting a VibeCMS GitHub release.

## Before tagging

```sh
pnpm public:audit
pnpm typecheck
pnpm lint
pnpm build
pnpm build:self-host
```

Then verify:

- no `.env` or `.dev.vars` files are tracked
- `CHANGELOG.md` has the release notes
- `README.md` deploy button URL matches the actual repository
- production/sandbox secrets have not been committed
- any secret exposed in chat, logs, screenshots, or old commits has been rotated

## Suggested first tag

```sh
git tag v0.1.0-alpha
git push origin v0.1.0-alpha
```

## Release notes skeleton

```md
## VibeCMS 0.1.0-alpha

First public alpha of VibeCMS: a minimal blog CMS for humans and AI agents.

### Included

- Cloudflare Worker + RedwoodSDK app
- D1 database and R2 media
- Better Auth signup/login
- Posts, publishing, activity history, and post versions
- API keys and MCP endpoint
- Polar hosted billing
- `SELF_HOSTED=true` mode
- Root Deploy-to-Cloudflare configuration

### Known limitations

- Custom domains are deferred
- Email verification enforcement is deferred
- Deploy-to-Cloudflare should be rehearsed from the public repo before broad announcement
```
