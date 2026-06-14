import { Card, CardContent, CardDescription, CardHeader, CardTitle, CopyButton } from "@vc/ui";
import { TokenCookieClearer } from "./token-cookie-clearer";

const STARTER_PROMPT = [
  "You're connected to my VibeCMS blog through the \"vibecms\" MCP server.",
  "Use its tools to help me run the blog.",
  "First, call sites.get to confirm access.",
  "Then draft a short welcome post with posts.create and leave it as a draft for me to review (do not publish).",
  "Write the body in Markdown.",
  "Finally, tell me what you can do for the blog from here.",
].join(" ");

function CodeBlock({ name, hint, code }: { name: string; hint: string; code: string }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <p className="text-sm font-semibold text-foreground">{name}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <CopyButton value={code} label="Copy" copiedLabel="Copied" />
      </div>
      <pre className="overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">{code}</pre>
    </div>
  );
}

/**
 * Shared agent-connection panel. When `token` is present it bakes the real
 * token into every snippet and reveals it once; otherwise it renders a
 * `vc_...` placeholder for reference. Used by the onboarding Connect step and
 * the one-time token-created page.
 */
export function ConnectAgent({ mcpUrl, token, tokenName }: { mcpUrl: string; token?: string; tokenName?: string }) {
  const tok = token ?? "vc_YOUR_TOKEN";
  const claudeCode = `claude mcp add --transport http vibecms ${mcpUrl} --header "Authorization: Bearer ${tok}"`;
  const codex = `# ~/.codex/config.toml
[mcp_servers.vibecms]
url = "${mcpUrl}"
http_headers = { "Authorization" = "Bearer ${tok}" }`;
  const cursor = `// ~/.cursor/mcp.json
{
  "mcpServers": {
    "vibecms": {
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${tok}" }
    }
  }
}`;
  const generic = `{
  "mcpServers": {
    "vibecms": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": { "Authorization": "Bearer ${tok}" }
    }
  }
}`;
  const mcpRemote = `npx -y mcp-remote ${mcpUrl} --header "Authorization: Bearer ${tok}" --transport http-only`;

  return (
    <div className="grid gap-4">
      {token ? (
        <Card className="rounded-2xl border-primary/40 shadow-sm">
          <TokenCookieClearer />
          <CardHeader>
            <CardTitle className="text-lg font-semibold tracking-[-0.02em]">{tokenName ?? "Agent token"}</CardTitle>
            <CardDescription>Copy this token now. For security it is shown only once - it is already baked into the snippets below.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <pre className="overflow-auto rounded-lg border border-border bg-muted p-4 font-mono text-sm text-foreground">{token}</pre>
            <CopyButton value={token} label="Copy token" copiedLabel="Token copied" />
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold tracking-[-0.02em]">MCP endpoint</CardTitle>
          <CardDescription>Your blog speaks the Model Context Protocol over HTTP. Point any agent here.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground">{mcpUrl}</code>
            <CopyButton value={mcpUrl} label="Copy URL" copiedLabel="Copied" />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold tracking-[-0.02em]">Add it to your agent</CardTitle>
          <CardDescription>Paste the snippet for your tool, then start a session. The server teaches the agent the rest.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <CodeBlock name="Claude Code" hint="Run this once in your terminal." code={claudeCode} />
          <CodeBlock name="Codex CLI" hint="Add to ~/.codex/config.toml." code={codex} />
          <details className="group rounded-lg border border-border bg-card">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-foreground">More clients (Cursor, Claude Desktop, others)</summary>
            <div className="grid gap-5 border-t border-border p-3">
              <CodeBlock name="Cursor" hint="Add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project)." code={cursor} />
              <CodeBlock name="Any HTTP-MCP client" hint="Standard mcpServers JSON with a Streamable HTTP transport." code={generic} />
              <CodeBlock name="Stdio-only clients (Claude Desktop, etc.)" hint="Bridge to the remote endpoint with mcp-remote." code={mcpRemote} />
            </div>
          </details>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-semibold tracking-[-0.02em]">Hand it the first task</CardTitle>
          <CardDescription>After connecting, paste this into your agent and it will take it from there.</CardDescription>
        </CardHeader>
        <CardContent>
          <CodeBlock name="Starter prompt" hint="Confirms access and drafts a first post for your review." code={STARTER_PROMPT} />
        </CardContent>
      </Card>
    </div>
  );
}
