/**
 * The neutral visitor page for a paused managed blog ("keep your blog").
 *
 * Served on every ingress (default host, custom domain, subpath) once an
 * AutoSEOPilot-sponsored blog is past its 7-day claim grace and has not been
 * claimed: no content leaks, never a bare 404, never indexable, never cached.
 */
const PAUSED_BODY = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>This blog is paused</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f7;color:#3f3f46;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<main style="padding:2.5rem 1.5rem;text-align:center;">
<p style="margin:0;font-size:1.0625rem;line-height:1.6;">This blog is paused.</p>
</main>
</body>
</html>`;

export function pausedBlogResponse(request?: Request): Response {
  // Agents asking for Markdown get the same one line, without the envelope.
  const wantsMarkdown = request?.headers.get("accept")?.includes("text/markdown") ?? false;
  return new Response(wantsMarkdown ? "This blog is paused.\n" : PAUSED_BODY, {
    status: 503,
    headers: {
      "content-type": wantsMarkdown ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "content-signal": "ai-train=no, search=no, ai-input=no",
      vary: "Accept",
    },
  });
}
