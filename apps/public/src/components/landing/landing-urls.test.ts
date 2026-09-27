import { FREE_TIER, LAUNCH_OFFER, PRICING } from "@vc/config";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentSurface } from "./agent-surface";
import { AgentsDemo } from "./agents-demo";
import { ASK_AI_PROMPT, AskAi, askAiLinks } from "./ask-ai";
import { CtaFooter } from "./cta-footer";
import { FaqAccordion } from "./faq-accordion";
import { HeaderHero } from "./header-hero";
import { HostingPricing } from "./hosting-pricing";
import { AGENT_TOKEN_PRESETS } from "../../../../../packages/core/src/types";
import { HERO_TURNS } from "./hero-demo";
import { KEY_LEVELS } from "./key-levels";

const loginUrl = "https://app.example.com/login";
const apiDocsUrl = "https://app.example.com/api/v1/docs";

describe("landing URL props", () => {
  it("wires login CTAs through HeaderHero without client hydration", () => {
    const html = renderToStaticMarkup(createElement(HeaderHero, { loginUrl }));
    expect(html).toContain(`href="${loginUrl}"`);
    expect(html).toContain("Start free");
    expect(html).toContain("Sign in");
    expect(html).toContain("data-landing-nav");
    expect(html).toContain("data-hero-demo");
    expect(html).toContain("sends you a private")
    expect(html).toContain("the final say")
    // The full conversation is server-rendered, so it reads without JS.
    for (const turn of HERO_TURNS) expect(html).toContain(`data-hero-turn="${turn.step}"`);
    expect(html).toContain("Publish it Tuesday at 9.")
  });

  it("wires API docs through AgentsDemo and static AgentSurface", () => {
    const agents = renderToStaticMarkup(createElement(AgentsDemo, { apiDocsUrl }));
    expect(agents).toContain(`href="${apiDocsUrl}"`);
    expect(agents).toContain("data-key-demo");
    expect(agents).toContain("always yours");

    const surface = renderToStaticMarkup(createElement(AgentSurface, { apiDocsUrl }));
    expect(surface).toContain(`href="${apiDocsUrl}"`);
    expect(surface).toContain("API docs");
  });

  it("wires login CTAs through static HostingPricing", () => {
    const html = renderToStaticMarkup(createElement(HostingPricing, { loginUrl }));
    expect(html).toContain(`href="${loginUrl}"`);
    expect(html).toContain("Start free");
    expect(html).toContain(`$${LAUNCH_OFFER.monthlyUsd}`);
    expect(html).toContain(`$${PRICING.monthlyUsd}`);
    expect(html).toContain(`up to ${FREE_TIER.publishedPosts} posts`);
  });

  it("keeps FAQ pricing copy in sync with config", () => {
    const html = renderToStaticMarkup(createElement(FaqAccordion));
    expect(html).toContain(`$${LAUNCH_OFFER.monthlyUsd}/month`);
    expect(html).toContain(`up to ${FREE_TIER.publishedPosts} published posts`);
  });

  it("wires login and docs through static CtaFooter", () => {
    const html = renderToStaticMarkup(createElement(CtaFooter, { loginUrl, apiDocsUrl }));
    expect(html).toContain(`href="${loginUrl}"`);
    expect(html).toContain(`href="${apiDocsUrl}"`);
    expect(html).toContain("API docs");
  });

  it("opens each AI provider with the prompt prefilled and points it at llms.txt", () => {
    expect(ASK_AI_PROMPT).toContain("https://vibecms.dev/llms.txt");
    const links = askAiLinks();
    for (const { logo } of links) expect(logo).toMatch(/^\/brand\/ai\/[a-z]+\.svg$/);
    expect(links.map((l) => l.name)).toEqual(["ChatGPT", "Claude", "Perplexity", "Google AI Mode", "Grok"]);
    for (const { href } of links) {
      expect(new URL(href).searchParams.get("q")).toBe(ASK_AI_PROMPT);
    }
    const html = renderToStaticMarkup(createElement(AskAi));
    expect(html).toContain("data-copy-prompt");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("shows the same scopes for each key level as the real key presets", () => {
    for (const level of KEY_LEVELS) {
      expect([...level.scopes].sort()).toEqual([...AGENT_TOKEN_PRESETS[level.id]].sort());
    }
  });
});
