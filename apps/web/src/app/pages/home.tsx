import { AgentsDemo } from "./landing/agents-demo";
import { CtaFooter } from "./landing/cta-footer";
import { EssentialsBento } from "./landing/essentials-bento";
import { FaqAccordion } from "./landing/faq-accordion";
import { FeatureStrip } from "./landing/feature-strip";
import { HeaderHero } from "./landing/header-hero";
import { HostingPricing } from "./landing/hosting-pricing";
import { DotGrid, Glow } from "./landing/primitives";
import { PublishingFlow } from "./landing/publishing-flow";

export const Home = () => {
  return (
    <main className="dark relative min-h-dvh overflow-hidden bg-background text-foreground">
      <DotGrid className="pointer-events-none fixed inset-0 z-0 opacity-90" />
      <Glow className="pointer-events-none fixed -top-[28%] left-1/2 z-0 size-[min(900px,120vw)] -translate-x-1/2 opacity-70" />
      <div className="relative z-[1]">
        <HeaderHero />
        <FeatureStrip />
        <EssentialsBento />
        <AgentsDemo />
        <PublishingFlow />
        <HostingPricing />
        <FaqAccordion />
        <CtaFooter />
      </div>
    </main>
  );
};