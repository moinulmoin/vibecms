export {};

const appUrl = (process.env.PRODUCTION_APP_URL || "https://app.vibecms.dev").replace(/\/$/, "");
const publicUrl = (process.env.PRODUCTION_PUBLIC_URL || "https://vibecms.dev").replace(/\/$/, "");
const token = process.env.PRODUCTION_SMOKE_TOKEN?.trim();

async function expectResponse(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response;
}

async function main(): Promise<void> {
  const readiness = await expectResponse(`${appUrl}/api/health/ready`);
  const readinessBody = (await readiness.json()) as { status?: string; checks?: Record<string, unknown> };
  if (readinessBody.status !== "ready") throw new Error("API readiness endpoint did not report ready");
  await expectResponse(appUrl, { headers: { Accept: "text/html" } });
  await expectResponse(`${publicUrl}/__vc-health`);

  if (!token) {
    if (process.env.ALLOW_BOOTSTRAP_SMOKE !== "1") throw new Error("PRODUCTION_SMOKE_TOKEN is required");
    console.warn("Bootstrap infrastructure smoke passed; authenticated tenant smoke was explicitly skipped");
    return;
  }

  const authHeaders = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  const siteResponse = await expectResponse(`${appUrl}/api/v1/site`, { headers: authHeaders });
  const siteEnvelope = (await siteResponse.json()) as { result?: { url?: string; name?: string } };
  const site = siteEnvelope.result;
  if (!site?.url) throw new Error("Authenticated production site has no public URL");

  const postsResponse = await expectResponse(`${appUrl}/api/v1/posts?status=published&limit=1`, {
    headers: authHeaders,
  });
  const postsEnvelope = (await postsResponse.json()) as {
    result?: { items?: Array<{ title?: string; url?: string }> } | Array<{ title?: string; url?: string }>;
  };
  const posts = Array.isArray(postsEnvelope.result) ? postsEnvelope.result : postsEnvelope.result?.items;
  const publishedPost = posts?.find((post) => post.url);
  if (!publishedPost?.url) throw new Error("Production smoke site needs at least one published post");

  await expectResponse(new URL("/__vc-health", site.url).toString());
  const articleResponse = await expectResponse(publishedPost.url, { headers: { Accept: "text/html" } });
  const articleHtml = await articleResponse.text();
  if (publishedPost.title && !articleHtml.includes(publishedPost.title)) {
    throw new Error("Public article response did not contain the published title");
  }

  console.log(`Production smoke passed for ${site.name || site.url} and ${publishedPost.url}`);
}

await main();
