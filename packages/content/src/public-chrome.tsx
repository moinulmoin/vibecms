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

export type PublicNavLink = { label: string; url: string };
export type PublicSocialLink = { kind: "x" | "github" | "linkedin" | "bluesky" | "mastodon" | "youtube" | "instagram" | "website" | "email"; url: string };

export interface PublicPageChromeProps {
  logoUrl?: string | null;
  navLinks?: PublicNavLink[];
  socialLinks?: PublicSocialLink[];
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

const SOCIAL_LABELS: Record<PublicSocialLink["kind"], string> = {
  x: "X", github: "GitHub", linkedin: "LinkedIn", bluesky: "Bluesky",
  mastodon: "Mastodon", youtube: "YouTube", instagram: "Instagram",
  website: "Website", email: "Email",
};

// Stroke glyphs on a 24px grid. GitHub, LinkedIn, YouTube, Instagram, globe
// and mail follow Lucide (ISC); X, Mastodon and Bluesky are drawn to match.
const SOCIAL_ICON_PATHS: Record<PublicSocialLink["kind"], string[]> = {
  x: ["M4 4l11.7 16H20L8.3 4Z", "M4 20l6.8-7.3", "M20 4l-6.8 7.3"],
  github: [
    "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",
    "M9 18c-4.51 2-5-2-7-2",
  ],
  linkedin: [
    "M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6Z",
    "M2 9h4v12H2Z",
    "M2 4a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  ],
  bluesky: [
    "M12 11C10.5 8 6.5 3.5 4 3.5c-1.4 0-2 .9-2 2.6 0 1.6.9 4.6 3.4 5.2-3 .6-3.7 2.5-2 4.3 3 3.1 5.3.1 8.6-3.9 3.3 4 5.6 7 8.6 3.9 1.7-1.8 1-3.7-2-4.3 2.5-.6 3.4-3.6 3.4-5.2 0-1.7-.6-2.6-2-2.6-2.5 0-6.5 4.5-8 7.5Z",
  ],
  mastodon: [
    "M21 8.5c0-4.3-2.8-5.6-2.8-5.6C16.8 2.3 14.4 2 12 2h-.1c-2.4 0-4.8.3-6.1.9C5.8 2.9 3 4.2 3 8.5c0 2.6-.1 5.8 1 8.6 1.5 3.9 6.1 4.4 9.6 3.4.6-.2 1.3-.4 1.9-.7v-1.7s-1.5.5-3.3.4c-1.7-.1-3.5-.2-3.8-2.3a5 5 0 0 1 0-.6s1.8.4 4 .5c1.4.1 2.7-.1 4-.2 2.5-.3 4.7-1.8 5-3.2.5-2.2.5-5.4.5-5.4Z",
    "M8 13V9.3C8 8 8.7 7.4 9.7 7.4c1.1 0 1.8.7 1.8 2V12",
    "M12.5 12V9.4c0-1.3.7-2 1.8-2 1 0 1.7.6 1.7 1.9V13",
  ],
  youtube: [
    "M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17",
    "m10 15 5-3-5-3Z",
  ],
  instagram: [
    "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Z",
    "M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37Z",
    "M17.5 6.5h.01",
  ],
  website: ["M2 12a10 10 0 1 0 20 0 10 10 0 1 0-20 0", "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20"],
  email: ["M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"],
};

function SocialIcon({ kind }: { kind: PublicSocialLink["kind"] }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {SOCIAL_ICON_PATHS[kind].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

export function PublicPageChrome({
  siteName,
  logoUrl,
  navLinks = [],
  socialLinks = [],
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
      {logoUrl ? <img src={logoUrl} alt={siteName} className={styles.logo} /> : null}
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
            {logoUrl ? <img src={logoUrl} alt={siteName} className={styles.logo} /> : null}
            {siteName}
          </a>
          {tagline ? <p className={styles.sidebarTagline}>{tagline}</p> : null}
          <nav className={styles.sidebarNav} aria-label="Sections">
            <a href={allPostsHref ?? homeHref} className={styles.sidebarLink}>
              All posts
            </a>
            {navLinks.map((link, index) => <a key={`${index}-${link.url}`} href={link.url} rel={/^https?:/i.test(link.url) ? "noopener" : undefined} className={styles.sidebarLink}>{link.label}</a>)}
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
            {/* Notebook repeats these in its sidebar; the header copy only shows
                while the sidebar is hidden on narrow pages. */}
            {allPostsHref || navLinks.length > 0 ? (
              <a href={allPostsHref ?? homeHref} className={styles.navLink} data-sidebar-dup={hasSidebar ? "" : undefined}>
                All posts
              </a>
            ) : null}
            {navLinks.map((link, index) => (
              <a
                key={`${index}-${link.url}`}
                href={link.url}
                rel={/^https?:/i.test(link.url) ? "noopener" : undefined}
                className={styles.navLink}
                data-sidebar-dup={hasSidebar ? "" : undefined}
              >
                {link.label}
              </a>
            ))}
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
          {socialLinks.length ? <nav className={styles.socialLinks} aria-label="Social links">{socialLinks.map((link, index) => <a key={`${index}-${link.kind}`} href={link.url} className={styles.footerLink} aria-label={SOCIAL_LABELS[link.kind]} rel={link.kind === "mastodon" ? "me noopener" : /^https?:/i.test(link.url) ? "noopener" : undefined}><SocialIcon kind={link.kind} /></a>)}</nav> : null}
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
