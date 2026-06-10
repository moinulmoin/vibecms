import { BRAND } from "@vc/config";
import { env } from "cloudflare:workers";

import styles from "./globals.css?url";

const siteUrl = env.APP_URL.replace(/\/$/, "");
const pageTitle = `${BRAND.name} | ${BRAND.tagline}`;
const ogImageUrl = `${siteUrl}/brand/og-image.png`;

export const Document: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="theme-color" content="#f6f8f4" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#0c100e" media="(prefers-color-scheme: dark)" />
      <link rel="icon" href="/favicon-light.svg" type="image/svg+xml" media="(prefers-color-scheme: light)" />
      <link rel="icon" href="/favicon-dark.svg" type="image/svg+xml" media="(prefers-color-scheme: dark)" />
      <title>{pageTitle}</title>
      <meta name="description" content={BRAND.description} />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={BRAND.description} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={siteUrl} />
      <meta property="og:image" content={ogImageUrl} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={`${BRAND.name}: ${BRAND.tagline}`} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={BRAND.description} />
      <meta name="twitter:image" content={ogImageUrl} />
      <link rel="stylesheet" href={styles} />
      <link rel="modulepreload" href="/src/client.tsx" />
    </head>
    <body>
      {children}
      <script>import("/src/client.tsx")</script>
    </body>
  </html>
);
