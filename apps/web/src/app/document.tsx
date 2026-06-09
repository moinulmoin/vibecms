import styles from "./globals.css?url";

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
      <title>VibeCMS | Blog CMS for humans and AI agents</title>
      <meta
        name="description"
        content="VibeCMS is an open-source Cloudflare-native blog CMS with a clean dashboard, media uploads, activity history, post versions, and scoped MCP/API access for trusted agents."
      />
      <meta property="og:title" content="VibeCMS | Blog CMS for humans and AI agents" />
      <meta
        property="og:description"
        content="Publish from a clean dashboard and let trusted agents draft, update, and inspect posts through scoped MCP/API access."
      />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin=""
      />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600&display=optional"
        precedence="first"
      />
      <link rel="stylesheet" href={styles} />
      <link rel="modulepreload" href="/src/client.tsx" />
    </head>
    <body>
      {children}
      <script>import("/src/client.tsx")</script>
    </body>
  </html>
);
