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
import { resolveSiteTheme, templateAttributes, type SiteThemeInput } from "./presented-post.js";
import styles from "./public-chrome.module.css";
import subscribeStyles from "./subscribe-form.module.css";

/* Visible subscribe copy (the consent record version stays in apps/public's
   subscribe-consent module, which re-exports these display strings). Bumping
   consent language there means new subscribers get stamped with the new
   version. */
export const SUBSCRIBE_HEADING = "Get new posts by email";
export const SUBSCRIBE_SUBTEXT =
  "Leave your email and you'll hear from us when new-post emails start.";
export const SUBSCRIBE_BUTTON = "Notify me";
export const SUBSCRIBE_SUCCESS =
  "You're on the list. We'll email you when subscriptions launch.";
export const SUBSCRIBE_CONSENT_TEXT =
  "By subscribing, you agree to receive one email when subscriptions launch. No marketing emails.";

/**
 * Per-site copy and visibility for the capture form. Undefined fields preserve
 * the original copy, which keeps older sites backwards-compatible.
 */
export interface SubscribeSettings {
  heading?: string;
  subtext?: string;
  buttonLabel?: string;
  enabled?: boolean;
}

export function SubscribeBlock({
  siteSlug,
  variant,
  settings,
}: {
  siteSlug?: string;
  variant: "footer" | "end";
  settings?: SubscribeSettings | null;
}) {
  if (settings?.enabled === false) return null;
  const inert = !siteSlug;
  const idSlug = siteSlug ?? "preview";
  return (
    <form
      className={`${subscribeStyles.form} ${variant === "footer" ? subscribeStyles.formFooter : subscribeStyles.formEnd} vc-subscribe-form`}
      data-site-slug={siteSlug}
      noValidate
      onSubmit={inert ? (event) => event.preventDefault() : undefined}
    >
      <p className={subscribeStyles.heading}>{settings?.heading || SUBSCRIBE_HEADING}</p>
      <p className={subscribeStyles.subtext}>{settings?.subtext || SUBSCRIBE_SUBTEXT}</p>
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
          {settings?.buttonLabel || SUBSCRIBE_BUTTON}
        </button>
      </div>
      <p className={subscribeStyles.consentNote}>{SUBSCRIBE_CONSENT_TEXT}</p>
      <p
        className={subscribeStyles.errorMsg}
        role="alert"
        aria-live="assertive"
        hidden
        data-subscribe-error
      />
      <p
        className={subscribeStyles.successMsg}
        role="status"
        aria-live="polite"
        hidden
        data-subscribe-success
      >
        {SUBSCRIBE_SUCCESS}
      </p>
    </form>
  );
}

export interface PublicPageChromeProps {
  siteName: string;
  tagline?: string | null;
  homeHref: string;
  /** When set, the masthead shows an "All posts" link (article pages). */
  allPostsHref?: string;
  /** Index pages render the site name as the page's visible h1 and the tagline as an intro. */
  homeHeading?: boolean;
  /** Raw site theme id; resolved through resolvePresetId. */
  presetId: string;
  /** Per-site accent/font/mode; omitted values fall back to preset defaults. */
  theme?: SiteThemeInput;
  /** Article pages mark the page for chrome rules. */
  article?: boolean;
  /** Widen the shell for an article with a ToC rail. */
  wide?: boolean;
  /** Masthead search (index pages). */
  searchAction?: string;
  searchQuery?: string;
  /** RSS link in the masthead + footer. */
  feedHref?: string;
  /** Subscribe placement; omit to render no subscribe block (preview passes "end" with no slug). */
  subscribeVariant?: "footer" | "end";
  subscribeSiteSlug?: string;
  subscribeSettings?: SubscribeSettings | null;
  /** Year shown in the footer; defaults to the current UTC year. */
  year?: number;
  /** Rendered inside another surface (dashboard preview): no viewport min-height. */
  embedded?: boolean;
  /** The post's layout on article pages (shell width follows it). */
  layout?: string;
  /** Reader light/dark toggle in the masthead (public pages). */
  modeToggle?: boolean;
  /** Sidebar content for templates with sidebar chrome. */
  sidebar?: SidebarData | null;
  children: ReactNode;
}

export interface SidebarData {
  tags: { name: string; href: string; count?: number }[];
  recent: { title: string; href: string }[];
}

function ContrastIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
    </svg>
  );
}

function RssIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function PublicPageChrome({
  siteName,
  tagline,
  homeHref,
  allPostsHref,
  homeHeading = false,
  presetId,
  theme,
  article = false,
  wide = false,
  searchAction,
  searchQuery,
  feedHref,
  subscribeVariant,
  subscribeSiteSlug,
  subscribeSettings,
  year,
  embedded = false,
  layout,
  modeToggle = false,
  sidebar,
  children,
}: PublicPageChromeProps) {
  const themeAttrs = theme ? resolveSiteTheme(theme, presetId) : undefined;
  const template = templateAttributes(presetId);
  const hasSidebar = template["data-vc-chrome"] === "sidebar";
  const subscribe = subscribeVariant ? (
    <SubscribeBlock siteSlug={subscribeSiteSlug} variant={subscribeVariant} settings={subscribeSettings} />
  ) : null;
  const brand = (
    <a href={homeHref} className={styles.brand}>
      {siteName}
    </a>
  );
  return (
    <main
      className={styles.page}
      {...template}
      data-vc-theme={resolvePresetId(presetId)}
      style={themeAttrs?.style}
      {...(themeAttrs?.mode === "light" || themeAttrs?.mode === "dark"
        ? { "data-vc-mode": themeAttrs.mode }
        : {})}
      {...(article ? { "data-vc-article-page": "" } : {})}
      {...(embedded ? { "data-embedded": "" } : {})}
    >
      <div className={styles.frame}>
      {hasSidebar ? (
        <aside className={styles.sidebar} aria-label="Blog">
          <a href={homeHref} className={styles.sidebarBrand}>
            {siteName}
          </a>
          {tagline ? <p className={styles.sidebarTagline}>{tagline}</p> : null}
          <nav className={styles.sidebarNav} aria-label="Sections">
            <a href={allPostsHref ?? homeHref} className={styles.sidebarLink}>
              All posts
            </a>
            {feedHref ? (
              <a href={feedHref} className={styles.sidebarLink}>
                RSS
              </a>
            ) : null}
          </nav>
          {sidebar && sidebar.recent.length > 0 ? (
            <div className={styles.sidebarGroup}>
              <p className={styles.sidebarLabel}>Recent</p>
              <ul className={styles.sidebarList}>
                {sidebar.recent.slice(0, 6).map((post) => (
                  <li key={post.href}>
                    <a href={post.href} className={styles.sidebarLink}>
                      {post.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {sidebar && sidebar.tags.length > 0 ? (
            <div className={styles.sidebarGroup}>
              <p className={styles.sidebarLabel}>Tags</p>
              <ul className={styles.sidebarTags}>
                {sidebar.tags.slice(0, 16).map((tag) => (
                  <li key={tag.href}>
                    <a href={tag.href} className={styles.sidebarTag}>
                      {tag.name}
                      {tag.count ? <span className={styles.sidebarCount}>{tag.count}</span> : null}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      ) : null}
      <div className={styles.shell} data-wide={wide ? "" : undefined} data-layout={layout}>
        <header className={styles.masthead}>
          {homeHeading ? <h1 className={styles.brandHeading}>{brand}</h1> : brand}
          <nav className={styles.mastNav} aria-label="Site">
            {searchAction ? (
              <form method="get" action={searchAction} role="search" className={styles.search}>
                <label className={styles.searchField}>
                  <SearchIcon />
                  <span className={styles.visuallyHidden}>Search posts</span>
                  <input
                    type="search"
                    name="q"
                    defaultValue={searchQuery}
                    placeholder="Search"
                    className={styles.searchInput}
                    autoComplete="off"
                  />
                </label>
              </form>
            ) : null}
            {allPostsHref ? (
              <a href={allPostsHref} className={styles.navLink}>
                All posts
              </a>
            ) : null}
            {feedHref ? (
              <a href={feedHref} className={styles.iconLink} aria-label="RSS feed" title="RSS feed">
                <RssIcon />
              </a>
            ) : null}
            {modeToggle ? (
              <button type="button" className={styles.iconLink} data-vc-mode-toggle="" aria-label="Switch light or dark mode" title="Light or dark">
                <ContrastIcon />
              </button>
            ) : null}
          </nav>
        </header>
        {homeHeading && tagline ? <p className={styles.intro}>{tagline}</p> : null}
        <div className={styles.content}>{children}</div>
        {subscribe}
        <div className={styles.push} aria-hidden="true" />
        <footer className={styles.footer}>
          <span>
            &copy; {year ?? new Date().getUTCFullYear()} {siteName}
          </span>
          {feedHref ? (
            <a href={feedHref} className={styles.footerLink}>
              RSS
            </a>
          ) : null}
        </footer>
      </div>
      </div>
    </main>
  );
}
