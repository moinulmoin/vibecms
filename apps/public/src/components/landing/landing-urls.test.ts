import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentSurface } from "./agent-surface";
import { AgentsDemo } from "./agents-demo";
import { CtaFooter } from "./cta-footer";
import { HeaderHero } from "./header-hero";
import { HostingPricing } from "./hosting-pricing";
import { formatScopeToken, INITIAL_SCOPES } from "./scope-toggle-demo";

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
  });

  it("wires API docs through AgentsDemo and static AgentSurface", () => {
    const agents = renderToStaticMarkup(createElement(AgentsDemo, { apiDocsUrl }));
    expect(agents).toContain(`href="${apiDocsUrl}"`);
    expect(agents).toContain("data-scope-demo");
    expect(agents).toContain(formatScopeToken(INITIAL_SCOPES));

    const surface = renderToStaticMarkup(createElement(AgentSurface, { apiDocsUrl }));
    expect(surface).toContain(`href="${apiDocsUrl}"`);
    expect(surface).toContain("Open API docs");
  });

  it("wires login CTAs through static HostingPricing", () => {
    const html = renderToStaticMarkup(createElement(HostingPricing, { loginUrl }));
    expect(html).toContain(`href="${loginUrl}"`);
    expect(html).toContain("Claim the founding rate");
  });

  it("wires login and docs through static CtaFooter", () => {
    const html = renderToStaticMarkup(createElement(CtaFooter, { loginUrl, apiDocsUrl }));
    expect(html).toContain(`href="${loginUrl}"`);
    expect(html).toContain(`href="${apiDocsUrl}"`);
    expect(html).toContain("API docs");
  });
});
