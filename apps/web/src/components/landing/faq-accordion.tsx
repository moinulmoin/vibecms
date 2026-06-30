import { PlusIcon } from "@radix-ui/react-icons";
import { GlassCard, SectionShell } from "./primitives";

const faqs = [
  {
    question: "Is vibecms an AI writer?",
    answer:
      "No. It is the CMS your trusted agents publish into - you own every post. Bring your own agent, ours, or no editor at all; vibecms is the publication layer underneath.",
  },
  {
    question: "Who is this for?",
    answer:
      "Solo writers and small teams running one serious blog who want a clean Markdown surface, real version history, and optional agent help.",
  },
  {
    question: "Can I self-host it?",
    answer:
      "Yes. Deploy to your own Cloudflare Workers with D1 and R2, inspect the code, and keep the exact same scoped-MCP publishing model.",
  },
  {
    question: "What is not included?",
    answer:
      "No multi-site dashboards and no bloated page builder. One blog, done well - with media, versions, public output, and scoped agent access.",
  },
] as const;

export function FaqAccordion() {
  return (
    <section id="faq">
      <SectionShell>
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16 lg:items-start">
          <div data-reveal>
            <h2 className="max-w-md text-balance font-display text-[clamp(1.875rem,4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-foreground">
              Questions
              <br />
              before launch.
            </h2>
          </div>
          <div className="space-y-4" data-reveal data-d="1">
            {faqs.map((item, index) => (
              <div
                key={item.question}
                data-reveal
                data-d={String(Math.min(index + 2, 5))}
              >
                <GlassCard className="overflow-hidden p-0">
                  <details open={index === 0} className="group [&_summary::-webkit-details-marker]:hidden">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 font-display text-lg font-medium tracking-[-0.01em] text-foreground marker:content-none">
                      <span>{item.question}</span>
                      <PlusIcon
                        className="size-5 shrink-0 text-brand-bright transition-transform duration-200 group-open:rotate-45"
                        aria-hidden
                      />
                    </summary>
                    <p className="border-t border-[color:var(--hairline)] px-6 pb-5 pt-0 text-sm leading-7 text-muted-foreground">
                      <span className="block pt-4">{item.answer}</span>
                    </p>
                  </details>
                </GlassCard>
              </div>
            ))}
          </div>
        </div>
      </SectionShell>
    </section>
  );
}