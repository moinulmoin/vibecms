import { BRAND } from "@vc/config";
import { ArrowRight } from "./icons";
import { GHOST_CTA, H2, LEAD, SectionShell } from "./primitives";

export const ASK_AI_PROMPT = `Tell me about vibecms (${BRAND.marketingUrl}), a CMS for AI agents. Read ${BRAND.marketingUrl}/llms.txt first. How would it work with my AI agent, what would it cost, and is it a good fit for my blog?`;

// Each opens a new chat with the prompt filled in.
const PROVIDERS = [
  ["ChatGPT", "https://chatgpt.com/?q="],
  ["Claude", "https://claude.ai/new?q="],
  ["Perplexity", "https://www.perplexity.ai/search?q="],
  ["Google AI Mode", "https://www.google.com/search?udm=50&q="],
  ["Grok", "https://grok.com/?q="],
] as const;

export function askAiLinks(prompt = ASK_AI_PROMPT) {
  const q = encodeURIComponent(prompt);
  return PROVIDERS.map(([name, base]) => ({ name, href: `${base}${q}` }));
}

export function AskAi() {
  return (
    <section id="ask-ai" aria-labelledby="ask-ai-title">
      <SectionShell>
        <div className="grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:gap-14">
          <div data-reveal className="min-w-0">
            <h2 id="ask-ai-title" className={H2}>
              Ask your AI
              <br />
              about us.
            </h2>
            <p className={`mt-4 max-w-md ${LEAD}`}>
              Everything on this page is in our llms.txt, limits included. Let
              your favorite model read it and tell you if vibecms fits.
            </p>
          </div>
          <div data-reveal data-d="1" className="min-w-0">
            <p className="rounded-xl px-4 py-3.5 font-mono text-[12.5px] leading-[1.7] text-muted-foreground ring-1 ring-[color:var(--hairline)]">
              {ASK_AI_PROMPT}
            </p>
            <ul className="mt-5 flex flex-wrap gap-2.5">
              {askAiLinks().map(({ name, href }) => (
                <li key={name}>
                  <a
                    className={`${GHOST_CTA} min-h-[44px] px-4 text-sm`}
                    href={href}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {name}
                    <ArrowRight className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SectionShell>
    </section>
  );
}
