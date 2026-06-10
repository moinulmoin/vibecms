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
      <title>VibeCMS | Simple, minimal CMS for humans and AI agents</title>
      <meta
        name="description"
        content="Write in Markdown, manage media and versions, and let agents write, draft, and publish through MCP."
      />
      <meta property="og:title" content="VibeCMS | Simple, minimal CMS for humans and AI agents" />
      <meta
        property="og:description"
        content="Write in Markdown, manage media and versions, and let agents write, draft, and publish through MCP."
      />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <link rel="stylesheet" href={styles} />
      <link rel="modulepreload" href="/src/client.tsx" />
    </head>
    <body>
      {children}
      <script>import("/src/client.tsx")</script>
    </body>
  </html>
);
