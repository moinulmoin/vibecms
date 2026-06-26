import { AgentsDemo } from '~/components/landing/agents-demo'
import { CtaFooter } from '~/components/landing/cta-footer'
import { EssentialsBento } from '~/components/landing/essentials-bento'
import { FaqAccordion } from '~/components/landing/faq-accordion'
import { HeaderHero } from '~/components/landing/header-hero'
import { HostingPricing } from '~/components/landing/hosting-pricing'
import { DotGrid, Glow } from '~/components/landing/primitives'
import { PublishingFlow } from '~/components/landing/publishing-flow'

export function LandingHome() {
  return (
    <main className="dark relative min-h-dvh overflow-hidden bg-background text-foreground">
      <DotGrid className="pointer-events-none fixed inset-0 z-0 opacity-90" />
      <Glow className="pointer-events-none fixed -top-[32%] left-1/2 z-0 size-[min(760px,108vw)] -translate-x-1/2 opacity-40" />
      <div className="relative z-[1]">
        <HeaderHero />
        <EssentialsBento />
        <AgentsDemo />
        <PublishingFlow />
        <HostingPricing />
        <FaqAccordion />
        <CtaFooter />
      </div>
    </main>
  )
}