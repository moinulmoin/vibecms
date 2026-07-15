import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicPostLoaderData } from "./server/public-blog";
import { PublicBlogPostView, PublicShell } from "./components/PublicBlogPages";
import {
  SUBSCRIBE_BUTTON,
  SUBSCRIBE_CONSENT_TEXT,
  SUBSCRIBE_HEADING,
  SUBSCRIBE_SUBTEXT,
  SUBSCRIBE_SUCCESS,
} from "./lib/subscribe-consent";

type SubmitListener = (event: { target: unknown; preventDefault: () => void }) => void;

class FakeClassList {
  constructor(private readonly values: Set<string>) {}
  contains(value: string) {
    return this.values.has(value);
  }
}

class FakeInput {
  type = "text";
  name = "";
  value = "";
}

class FakeElement {
  hidden = false;
  textContent = "";
  dataset: Record<string, string> = {};
}

class FakeForm {
  classList = new FakeClassList(new Set(["vc-subscribe-form"]));
  dataset = { siteSlug: "site-1" };
  private readonly nodes = new Map<string, FakeInput | FakeElement>();
  private listener: SubmitListener | undefined;

  constructor() {
    const email = new FakeInput();
    email.type = "email";
    email.name = "email";
    const company = new FakeInput();
    company.name = "company";
    const error = new FakeElement();
    error.dataset.subscribeError = "";
    const success = new FakeElement();
    success.dataset.subscribeSuccess = "";
    success.hidden = true;
    this.nodes.set('input[name="email"]', email);
    this.nodes.set('input[name="company"]', company);
    this.nodes.set("[data-subscribe-error]", error);
    this.nodes.set("[data-subscribe-success]", success);
  }

  addEventListener(type: string, listener: SubmitListener) {
    if (type === "submit") this.listener = listener;
  }

  querySelector(selector: string) {
    return this.nodes.get(selector) ?? null;
  }

  dispatchSubmit() {
    this.listener?.({ target: this, preventDefault() {} });
  }

  reset() {
    for (const node of this.nodes.values()) {
      if (node instanceof FakeInput) node.value = "";
    }
  }

  input(name: "email" | "company") {
    return this.nodes.get(`input[name="${name}"]`) as FakeInput;
  }

  message(kind: "error" | "success") {
    return this.nodes.get(`[data-subscribe-${kind}]`) as FakeElement;
  }
}

class FakeDocument {
  private listener: SubmitListener | undefined;
  addEventListener(type: string, listener: SubmitListener) {
    if (type === "submit") this.listener = listener;
  }
  dispatchSubmit(form: FakeForm) {
    this.listener?.({ target: form, preventDefault() {} });
  }
}

const fakeDocument = new FakeDocument();
vi.stubGlobal("document", fakeDocument);
vi.stubGlobal("HTMLFormElement", FakeForm);
vi.stubGlobal("HTMLInputElement", FakeInput);
vi.stubGlobal("HTMLElement", FakeElement);

// The browser script touches document at module evaluation, so load it only after
// installing this deterministic DOM harness rather than using a static import.
beforeAll(async () => {
  // @ts-expect-error The browser-only script intentionally has no exports; load it for side effects after installing the DOM harness.
    await import("../public/scripts/subscribe-form.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("HTMLFormElement", FakeForm);
  vi.stubGlobal("HTMLInputElement", FakeInput);
  vi.stubGlobal("HTMLElement", FakeElement);
});

async function submit(form: FakeForm) {
  fakeDocument.dispatchSubmit(form);
  await Promise.resolve();
  await Promise.resolve();
}

describe("progressive subscribe form behavior", () => {
  it("posts normalized email and site metadata, then shows success and resets", async () => {
    const form = new FakeForm();
    form.input("email").value = "  User@Example.COM ";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submit(form);

    expect(fetchMock).toHaveBeenCalledWith("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", siteSlug: "site-1", company: "" }),
    });
    expect(form.message("success").hidden).toBe(false);
    expect(form.input("email").value).toBe("");
  });

  it("shows validation and rate-limit messages while clearing stale errors before submit", async () => {
    const form = new FakeForm();
    form.message("error").hidden = false;
    form.message("error").textContent = "stale";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    await submit(form);
    expect(form.message("error").hidden).toBe(false);
    expect(form.message("error").textContent).toBe("Enter a valid email address.");

    await submit(form);
    expect(form.message("error").textContent).toBe("Too many attempts. Try again later.");
  });

  it("shows a generic error when the request fails and preserves the honeypot value", async () => {
    const form = new FakeForm();
    form.input("email").value = "person@example.com";
    form.input("company").value = "bot";
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await submit(form);

    expect(form.message("error").hidden).toBe(false);
    expect(form.message("error").textContent).toBe("Something went wrong. Try again.");
    expect(form.input("company").value).toBe("bot");
  });
  it("carries the form's site slug through as the request source context", async () => {
    const form = new FakeForm();
    form.dataset.siteSlug = "acme-blog";
    form.input("email").value = "person@example.com";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await submit(form);

    // The site slug is the source context the public proxy forwards to the API
    // service binding; it must reflect the form's data-site-slug, not a default.
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/subscribe");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.siteSlug).toBe("acme-blog");
  });

  it("surfaces a server error status to the user without throwing", async () => {
    const form = new FakeForm();
    form.input("email").value = "person@example.com";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await submit(form);

    // A non-validation server failure (5xx) must still be surfaced to the user.
    expect(form.message("error").hidden).toBe(false);
    expect(form.message("error").textContent).toBe("Something went wrong. Try again.");
  });
});

const site = {
  id: "site-1",
  workspace_id: "workspace-1",
  name: "Site One",
  slug: "site-1",
  theme: "minimal",
  theme_accent: null,
  theme_font: null,
  theme_mode: "light",
  description: null,
  default_seo_title: null,
  default_seo_description: null,
  billing_status: null,
  current_period_end: null,
  published_count: 1,
};

const post = {
  id: "post-1",
  title: "Hello",
  slug: "hello",
  excerpt: null,
  content_markdown: "# Hello\n\nA post.",
  cover_asset_id: null,
  published_at: 1_700_000_000,
  updated_at: 1_700_000_000,
  seo_title: null,
  seo_description: null,
  canonical_url: null,
  tags_json: "[]",
  presentation_json: null,
  presentation: null,
};

describe("subscribe form rendered-control contract", () => {
  it("keeps labeled email controls, hidden honeypots, and submit boundaries in footer and end placements", () => {
    const footer = renderToStaticMarkup(
      createElement(PublicShell, { site, basePath: "", indexable: true, children: createElement("div") }),
    );
    const end = renderToStaticMarkup(
      createElement(PublicBlogPostView, {
        data: {
          site,
          post,
          basePath: "",
          canonicalUrl: "/hello",
          origin: "https://site-1.basedui.dev",
          indexable: true,
          cacheTags: [],
        } satisfies PublicPostLoaderData,
      }),
    );

    for (const [markup, id] of [
      [footer, "email-footer-site-1"],
      [end, "email-end-site-1"],
    ] as const) {
      expect(markup).toContain("vc-subscribe-form");
      expect(markup).toContain(`for="${id}"`);
      expect(markup).toContain(`id="${id}"`);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).toContain('name="company"');
      expect(markup).toContain('tabindex="-1"');
      expect(markup).toContain('<button type="submit"');
    }
  });

  it("renders the shared subscriber consent copy in both placements", () => {
    const footer = renderToStaticMarkup(
      createElement(PublicShell, { site, basePath: "", indexable: true, children: createElement("div") }),
    );
    const end = renderToStaticMarkup(
      createElement(PublicBlogPostView, {
        data: {
          site,
          post,
          basePath: "",
          canonicalUrl: "/hello",
          origin: "https://site-1.basedui.dev",
          indexable: true,
          cacheTags: [],
        } satisfies PublicPostLoaderData,
      }),
    );

    // The exact consent text the subscriber agrees to (and that the API stamps
    // with a version) must be visible in the widget for both placements.
    expect(footer).toContain(SUBSCRIBE_CONSENT_TEXT);
    expect(end).toContain(SUBSCRIBE_CONSENT_TEXT);
  });
});

describe("public editorial article rendering", () => {
  const articleSite = {
    ...site,
    name: "Site One",
    theme: "editorial",
  };

  const articlePost = {
    ...post,
    id: "post-editorial",
    title: "Structured Article",
    excerpt: "A multi-section exploration of ideas worth sharing.",
    tags_json: JSON.stringify(["design", "writing"]),
    content_markdown:
      "# Structured Article\n\nOpening paragraph.\n\n## First Section\n\nContent for the first section.\n\n### Sub-point Alpha\n\nA deeper detail.\n\n## Second Section\n\nContent for the second section.\n\n## Third Section\n\nClosing thoughts.\n",
    presentation_json: JSON.stringify({ toc: true }),
    presentation: { toc: true },
  };

  let markup: string;
  beforeAll(() => {
    markup = renderToStaticMarkup(
      createElement(PublicBlogPostView, {
        data: {
          site: articleSite,
          post: articlePost,
          basePath: "",
          canonicalUrl: "/structured-article",
          origin: "https://site-1.basedui.dev",
          indexable: true,
          cacheTags: [],
        } satisfies PublicPostLoaderData,
      }),
    );
  });

  it("renders the article-page marker on the page main", () => {
    expect(markup).toContain('data-vc-article-page=""');
  });

  it("emits exactly one semantic H1 and does not duplicate the body title as H2", () => {
    const h1Matches = markup.match(/<h1[ >]/g);
    expect(h1Matches).toHaveLength(1);

    // The matching leading H1 is removed from the rendered body, so the
    // article title must not appear again as an H2.
    expect(markup).not.toMatch(/<h2[^>]*>Structured Article<\/h2>/);
  });

  it("renders the deck and byline before body content", () => {
    const deckIndex = markup.indexOf("A multi-section exploration of ideas worth sharing.");
    const bylineIndex = markup.indexOf("By Site One");
    const bodyStart = markup.indexOf("data-rich-content");

    expect(deckIndex).toBeGreaterThanOrEqual(0);
    expect(bylineIndex).toBeGreaterThanOrEqual(0);
    expect(deckIndex).toBeLessThan(bodyStart);
    expect(bylineIndex).toBeLessThan(bodyStart);
  });

  it("renders the metadata line before the tag row", () => {
    // Taxonomy order is title, deck, metadata, then tags; the meta line must
    // precede the tag links in source order.
    const metaIndex = markup.indexOf("min read");
    const tagIndex = markup.indexOf("/tag/design");

    expect(metaIndex).toBeGreaterThanOrEqual(0);
    expect(tagIndex).toBeGreaterThanOrEqual(0);
    expect(metaIndex).toBeLessThan(tagIndex);
  });

  it("produces narrow TOC disclosure markup for structured headings", () => {
    // Three H2/H3 headings trigger the <details> TOC disclosure.
    expect(markup).toContain("<details");
    expect(markup).toContain("<summary");
    expect(markup).toContain("On this page");

    // All outline entries appear as links.
    expect(markup).toContain(">First Section</a>");
    expect(markup).toContain(">Sub-point Alpha</a>");
    expect(markup).toContain(">Second Section</a>");
    expect(markup).toContain(">Third Section</a>");
  });

  it("produces desktop navigation TOC rail markup", () => {
    // The sticky sidebar nav is rendered alongside the body.
    expect(markup).toContain('<nav');
    expect(markup).toContain('aria-label="On this page"');
  });
});

describe("article masthead navigation", () => {
  const markup = renderToStaticMarkup(
    createElement(PublicBlogPostView, {
      data: {
        site: { ...site, theme: "editorial" },
        post: { ...post, title: "Masthead Nav Post" },
        basePath: "",
        canonicalUrl: "/masthead-nav-post",
        origin: "https://site-1.basedui.dev",
        indexable: true,
        cacheTags: [],
      } satisfies PublicPostLoaderData,
    }),
  );

  it("renders the All posts navigation inside the masthead", () => {
    // The article masthead carries an explicit All posts nav, not a brand-only header.
    expect(markup).toContain('aria-label="Posts"');
    expect(markup).toContain(">All posts</a>");
  });

  it("does not render a standalone arrow-back link", () => {
    // The old separate left-arrow back link is gone; only the masthead nav remains.
    expect(markup).not.toContain("\u2190");
  });
});

describe("subscription callout copy and consent", () => {
  const footerMarkup = renderToStaticMarkup(
    createElement(PublicShell, { site, basePath: "", indexable: true, children: createElement("div") }),
  );
  const endMarkup = renderToStaticMarkup(
    createElement(PublicBlogPostView, {
      data: {
        site,
        post,
        basePath: "",
        canonicalUrl: "/hello",
        origin: "https://site-1.basedui.dev",
        indexable: true,
        cacheTags: [],
      } satisfies PublicPostLoaderData,
    }),
  );

  const visibleTextMarkup = (markup: string) => markup.replaceAll("&#x27;", "'");

  it("renders the exact heading, subtext, and button copy in both placements", () => {
    for (const markup of [footerMarkup, endMarkup].map(visibleTextMarkup)) {
      expect(markup).toContain(SUBSCRIBE_HEADING);
      expect(markup).toContain(SUBSCRIBE_SUBTEXT);
      expect(markup).toContain(`>${SUBSCRIBE_BUTTON}</button>`);
    }
  });

  it("renders the exact success message and consent copy in both placements", () => {
    for (const markup of [footerMarkup, endMarkup].map(visibleTextMarkup)) {
      expect(markup).toContain(SUBSCRIBE_SUCCESS);
      expect(markup).toContain(SUBSCRIBE_CONSENT_TEXT);
    }
  });
});
