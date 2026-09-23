import { FREE_TIER, LAUNCH_OFFER, PRICING } from "@vc/config";
import { Plus } from "./icons";
import { H2, SectionShell } from "./primitives";

const faqs = [
  {
    question: "What do I get for free?",
    answer: `A full blog, your agent connected, and up to ${FREE_TIER.publishedPosts} published posts. No card. Free posts stay out of search engines; subscribing unlocks indexing, your domain, media, and unlimited publishing.`,
  },
  {
    question: "What does the launch price mean?",
    answer: `$${LAUNCH_OFFER.monthlyUsd}/month or $${LAUNCH_OFFER.annualUsd}/year instead of $${PRICING.monthlyUsd} or $${PRICING.annualUsd}. It applies at checkout and stays while your subscription is active.`,
  },
  {
    question: "Does vibecms write my posts?",
    answer:
      "No. Your agent or you write. vibecms stores, versions, checks, and publishes. It never generates content.",
  },
  {
    question: "Which agents work with it?",
    answer:
      "Any MCP client: Claude Code, Codex, Cursor, OpenCode, Amp, and others. Scripts can use the REST API or the CLI.",
  },
  {
    question: "Can an agent publish without me?",
    answer:
      "Only if you give its token the publish scope. Draft tokens can write and preview but not publish, and every change is logged and reversible.",
  },
  {
    question: "Can I leave?",
    answer:
      "Yes. Export every post as JSON anytime, or self-host the open-source version on your own Cloudflare account.",
  },
] as const;

export function FaqAccordion() {
  return (
    <section id="faq" aria-labelledby="faq-title">
      <SectionShell>
        <div className="grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-start lg:gap-14">
          <div data-reveal>
            <h2 id="faq-title" className={H2}>
              Questions.
            </h2>
          </div>
          <div className="divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]" data-reveal data-d="1">
            {faqs.map((item, index) => (
              <details
                key={item.question}
                open={index === 0}
                className="group [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-5 text-[17px] font-medium tracking-[-0.01em] text-foreground outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-brand-bright/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                  <span>{item.question}</span>
                  <Plus className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45" />
                </summary>
                <p className="max-w-[60ch] pb-5 text-[15px] leading-7 text-muted-foreground">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </SectionShell>
    </section>
  );
}
