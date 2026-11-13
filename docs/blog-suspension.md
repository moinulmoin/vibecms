# Suspending a blog for abuse

Operator-only runbook for hosted vibecms. Use it when a blog breaks the [acceptable use rules](../apps/public/src/pages/legal/terms.astro) (spam, malware, attacks): the terms promise we say why when we suspend. Suspension is reversible and deletes nothing. To delete a blog or account, use [account deletion](account-deletion.md) instead.

Reports arrive at `support@vibecms.dev` from the "Report abuse" link in the footer of every free blog (not Cloud, not self-hosted, not AutoSEOPilot-managed). The mail has the blog address filled in. Check the blog yourself before acting.

## Suspend

```sh
pnpm blog:suspend <site-id-or-address> --env production --reason "Spam pages selling pills"
```

`<site-id-or-address>` is the site id or the blog address (the `name` in `name.vibecms.dev`). The reason is one line the owner reads in the email; keep it factual. `--env development` targets the deployed dev database; add `--local` for the local one. The command uses your own Cloudflare login through wrangler and prints the site it changed.

At once:

- Every public address (`name.vibecms.dev`, an own domain, a `/blog` location) serves the paused page with `noindex`. The sitemap, feed, Markdown copies, llms.txt, previews and OG images are not served. Subscribe requests are dropped. Uploaded images keep serving at their media URLs.
- Publish, schedule and upload are refused in the dashboard, REST, MCP and the CLI with "This blog is suspended … Contact support@vibecms.dev". A scheduled post that comes due fails after its retries and says so in Activity.
- Nothing is deleted. The owner can still sign in and read drafts, posts, media and settings, and edit drafts.

Within 15 minutes (the next cron run): the owner gets one email saying the blog is suspended, the reason, that nothing was deleted, and how to reach support; and the blog's public cache is purged. Until that purge, a page already in the edge cache can still be served from it; to stop that sooner, purge the cache tag `vc-site:<site id>` in the Cloudflare dashboard (Caching > Purge cache > Custom purge).

Suspension never touches billing, the AutoSEOPilot managed binding or its revoke and claim clock. A paying customer keeps paying: settle any refund in Polar separately.

## Clear

```sh
pnpm blog:unsuspend <site-id-or-address> --env production
```

Every address serves again and writes are accepted at once. Clearing sends no email; reply to the owner's thread. A later suspension sends a new email.

## Check

```sql
SELECT id, slug, suspended_at, suspension_reason, suspension_notified_at FROM sites WHERE id = :site_id;
```

`suspension_notified_at` is set once the owner email went out (or the blog has no owner login to mail; the cron logs `suspension_notice_no_owner`). A failed send leaves it empty and the next cron run tries again.
