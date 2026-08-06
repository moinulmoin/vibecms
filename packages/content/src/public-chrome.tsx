/**
 * public-chrome.tsx — the page shell every vibecms blog page renders inside:
 * themed canvas, masthead, and the subscribe end-matter. Shared between
 * apps/public SSR and the dashboard editor preview so "Preview" is the real
 * public page by construction, not a lookalike.
 *
 * Theming contract: this component stamps data-vc-theme (+ data-vc-mode when
 * the site forces light/dark) and the per-site --vc-* custom properties on the
 * root <main>; presets.css, vc-rich-content.css, and the module styles consume
 * them from there.
 */
import type { ReactNode } from "react";
import { resolvePresetId } from "@vc/config";
import { resolveSiteTheme, type SiteThemeInput } from "./presented-post.js";
import styles from "./public-chrome.module.css";
import subscribeStyles from "./subscribe-form.module.css";

/* Visible subscribe copy (the consent record version stays in apps/public's
   subscribe-consent module, which re-exports these display strings). Bumping
   consent language there means new subscribers get stamped with the new
   version. */
export const SUBSCRIBE_HEADING = "Get new posts by email";
export const SUBSCRIBE_SUBTEXT =
  "Email delivery is coming soon. Join now and we'll let you know when it launches.";
export const SUBSCRIBE_BUTTON = "Notify me";
export const SUBSCRIBE_SUCCESS =
  "You're on the list. We'll email you when subscriptions launch.";
export const SUBSCRIBE_CONSENT_TEXT =
  "By subscribing, you agree to receive one email when subscriptions launch. No marketing emails.";

/**
 * The subscribe widget. On public pages pass the site slug: markup carries
 * `vc-subscribe-form` + data-site-slug and the public client script enhances
 * it. Without a slug (dashboard preview) it renders inert: no data attribute,
 * submit prevented, controls removed from tab order.
 */
export function SubscribeBlock({ siteSlug, variant }: { siteSlug?: string; variant: "footer" | "end" }) {
  const inert = !siteSlug;
  const idSlug = siteSlug ?? "preview";
  return (
    <form
      className={`${subscribeStyles.form} ${variant === "footer" ? subscribeStyles.formFooter : subscribeStyles.formEnd} vc-subscribe-form`}
      data-site-slug={siteSlug}
      noValidate
      onSubmit={inert ? (event) => event.preventDefault() : undefined}
    >
      <p className={subscribeStyles.heading}>{SUBSCRIBE_HEADING}</p>
      <p className={subscribeStyles.subtext}>{SUBSCRIBE_SUBTEXT}</p>
      <div className={subscribeStyles.honeypot} aria-hidden="true">
        <input name="company" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div className={subscribeStyles.row}>
        <label className={subscribeStyles.emailLabel} htmlFor={`email-${variant}-${idSlug}`}>
          Email address
        </label>
        <input
          id={`email-${variant}-${idSlug}`}
          name="email"
          type="email"
          required
          className={`${subscribeStyles.emailInput} ${subscribeStyles.input}`}
          placeholder="you@example.com"
          tabIndex={inert ? -1 : undefined}
        />
        <button type="submit" className={subscribeStyles.submitBtn} tabIndex={inert ? -1 : undefined}>
          {SUBSCRIBE_BUTTON}
        </button>
      </div>
      <p className={subscribeStyles.consentNote}>{SUBSCRIBE_CONSENT_TEXT}</p>
      <p className={subscribeStyles.errorMsg} hidden data-subscribe-error />
      <p className={subscribeStyles.successMsg} hidden data-subscribe-success>
        {SUBSCRIBE_SUCCESS}
      </p>
    </form>
  );
}

export interface PublicPageChromeProps {
  siteName: string;
  tagline?: string | null;
  homeHref: string;
  /** When set, renders the article-page "All posts" masthead nav. */
  allPostsHref?: string;
  /** Raw site theme id; resolved through resolvePresetId. */
  presetId: string;
  /** Per-site accent/font/mode; omitted values fall back to preset defaults. */
  theme?: SiteThemeInput;
  /** Article pages: wider container and the data-vc-article-page marker. */
  article?: boolean;
  /** Renders <meta name="robots" content="noindex,nofollow"> inside the shell. */
  robotsNoindex?: boolean;
  /** Subscribe placement; omit to render no subscribe block (preview passes "end" with no slug). */
  subscribeVariant?: "footer" | "end";
  subscribeSiteSlug?: string;
  children: ReactNode;
}

export function PublicPageChrome({
  siteName,
  tagline,
  homeHref,
  allPostsHref,
  presetId,
  theme,
  article = false,
  robotsNoindex = false,
  subscribeVariant,
  subscribeSiteSlug,
  children,
}: PublicPageChromeProps) {
  const themeAttrs = theme ? resolveSiteTheme(theme) : undefined;
  const subscribe = subscribeVariant ? (
    <SubscribeBlock siteSlug={subscribeSiteSlug} variant={subscribeVariant} />
  ) : null;
  return (
    <main
      className={styles.page}
      data-vc-theme={resolvePresetId(presetId)}
      style={themeAttrs?.style}
      {...(themeAttrs?.mode === "light" || themeAttrs?.mode === "dark"
        ? { "data-vc-mode": themeAttrs.mode }
        : {})}
      {...(article ? { "data-vc-article-page": "" } : {})}
    >
      <div className={styles.container}>
        {robotsNoindex ? <meta name="robots" content="noindex,nofollow" /> : null}
        <header className={styles.header}>
          <a href={homeHref} className={styles.brand}>
            {siteName}
          </a>
          {tagline ? <p className={styles.tagline}>{tagline}</p> : null}
          {allPostsHref ? (
            <nav className={styles.mastheadNav} aria-label="Posts">
              <a href={allPostsHref} className={styles.allPostsLink}>
                All posts
              </a>
            </nav>
          ) : null}
        </header>
        {children}
        {subscribe && subscribeVariant === "footer" ? <footer>{subscribe}</footer> : subscribe}
      </div>
    </main>
  );
}
