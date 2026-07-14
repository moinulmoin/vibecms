import { AgentSurface } from "./agent-surface";
import { AgentsDemo } from "./agents-demo";
import { CtaFooter } from "./cta-footer";
import { EssentialsBento } from "./essentials-bento";
import { FaqAccordion } from "./faq-accordion";
import { HeaderHero } from "./header-hero";
import { HostingPricing } from "./hosting-pricing";
import { LandingAppProvider } from "./landing-app-context";
import { DotGrid, Glow } from "./primitives";

export function LandingHome({ loginUrl, apiDocsUrl }: { loginUrl: string; apiDocsUrl: string }) {
  return (
    <LandingAppProvider loginUrl={loginUrl} apiDocsUrl={apiDocsUrl}>
      <main className="dark relative min-h-dvh overflow-hidden bg-background text-foreground">
        <DotGrid className="pointer-events-none fixed inset-0 z-0 opacity-90" />
        <Glow className="pointer-events-none fixed -top-[32%] left-1/2 z-0 size-[min(760px,108vw)] -translate-x-1/2 opacity-40" />
        <div className="relative z-[1]">
          <HeaderHero />
          <AgentsDemo />
          <AgentSurface />
          <EssentialsBento />
          <HostingPricing />
          <FaqAccordion />
          <CtaFooter />
        </div>
      </main>
    </LandingAppProvider>
  );
}