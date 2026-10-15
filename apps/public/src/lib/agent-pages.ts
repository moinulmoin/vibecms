import type { PublicIndexLoaderData } from "../server/public-blog";
import { sanitizeLlmsField } from "../server/llms-text";
import { BRAND, LAUNCH_OFFER, PRICING } from "@vc/config";

/**
 * One subscription offer: `price` is what checkout charges now (the launch
 * rate); the ListPrice spec carries the standard rate it is discounted from.
 * `unitCode` is UN/CEFACT: MON = month, ANN = year.
 */
function subscriptionOffer(cadence: "Monthly" | "Annual", launchUsd: number, listUsd: number, unitCode: "MON" | "ANN") {
  const perUnit = { "@type": "QuantitativeValue", value: 1, unitCode };
  return {
    "@type": "Offer",
    name: `${PRICING.planName} · ${cadence} (${LAUNCH_OFFER.phaseLabel.toLowerCase()})`,
    price: String(launchUsd),
    priceCurrency: "USD",
    priceSpecification: [
      { "@type": "UnitPriceSpecification", price: launchUsd, priceCurrency: "USD", referenceQuantity: perUnit },
      { "@type": "UnitPriceSpecification", priceType: "https://schema.org/ListPrice", price: listUsd, priceCurrency: "USD", referenceQuantity: perUnit },
    ],
  };
}

export function marketingJsonLd(canonical: string): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${canonical}#organization`, name: BRAND.name, url: canonical, contactPoint: { "@type": "ContactPoint", url: new URL("/legal/support", canonical).href, contactType: "customer support" } },
      {
        "@type": "SoftwareApplication",
        name: BRAND.name,
        url: canonical,
        description: BRAND.description,
        applicationCategory: "WebApplication",
        operatingSystem: "Web",
        publisher: { "@id": `${canonical}#organization` },
        offers: [
          subscriptionOffer("Monthly", LAUNCH_OFFER.monthlyUsd, PRICING.monthlyUsd, "MON"),
          subscriptionOffer("Annual", LAUNCH_OFFER.annualUsd, PRICING.annualUsd, "ANN"),
        ],
      },
    ],
  }).replace(/</g, "\\u003c");
}

export function listingMarkdown(data: PublicIndexLoaderData, homeBase: string): string {
  const description = data.site.description || data.site.default_seo_description || "";
  const lines = [`# ${sanitizeLlmsField(data.site.name)}`, ...(description.trim() ? [`> ${sanitizeLlmsField(description)}`] : []), "", "## Posts", ""];
  const page = data.page ?? 1;
  const visible = data.totalPosts === undefined ? data.posts.slice((page - 1) * 20, page * 20) : data.posts;
  for (const post of visible) {
    const date = post.published_at ? new Date(post.published_at * 1000).toISOString().slice(0, 10) : "";
    const excerpt = sanitizeLlmsField(post.excerpt || post.seo_description || "");
    lines.push(`- [${sanitizeLlmsField(post.title)}](${homeBase}/${post.slug}.md)${date ? ` — ${date}` : ""}${excerpt ? ` — ${excerpt}` : ""}`);
  }
  if (visible.length === 0) lines.push("No published posts yet.");
  const pageCount = Math.max(1, Math.ceil((data.totalPosts ?? data.posts.length) / 20));
  const base = data.listing.kind === "tag" ? `${data.basePath}/tag/${encodeURIComponent(data.listing.tag)}` : (data.basePath || "/");
  if (page > 1) lines.push(`\n[Newer](${base}${page - 1 > 1 ? `?page=${page - 1}` : ""})`);
  if (page < pageCount) lines.push(`\n[Older](${base}?page=${page + 1})`);
  return `${lines.join("\n")}\n`;
}

export function tenantBlogJsonLd(name: string, url: string, description: string) {
  return JSON.stringify({ "@context": "https://schema.org", "@type": ["WebSite", "Blog"], name, url, description, publisher: { "@type": "Organization", name } }).replace(/</g, "\\u003c");
}
