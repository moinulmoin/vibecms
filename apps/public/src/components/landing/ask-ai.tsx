import { BRAND } from "@vc/config";

export const ASK_AI_PROMPT = `Tell me about vibecms (${BRAND.marketingUrl}), a CMS for AI agents. Read ${BRAND.marketingUrl}/llms.txt first. How would it work with my AI agent, what would it cost, and is it a good fit for my blog?`;

// Each opens a new chat with the prompt filled in. Logos from svgl.app (Perplexity: LobeHub, filled mark).
const PROVIDERS = [
  ["ChatGPT", "chatgpt.svg", "https://chatgpt.com/?q="],
  ["Claude", "claude.svg", "https://claude.ai/new?q="],
  ["Perplexity", "perplexity.svg", "https://www.perplexity.ai/search?q="],
  ["Google AI Mode", "google.svg", "https://www.google.com/search?udm=50&q="],
  ["Grok", "grok.svg", "https://grok.com/?q="],
] as const;

export function askAiLinks(prompt = ASK_AI_PROMPT) {
  const q = encodeURIComponent(prompt);
  return PROVIDERS.map(([name, logo, base]) => ({ name, logo: `/brand/ai/${logo}`, href: `${base}${q}` }));
}

const CHIP =
  "inline-flex min-h-[40px] items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium text-secondary-foreground no-underline ring-1 ring-[color:var(--hairline)] [background:var(--surface-glass)] transition-[color,transform,box-shadow] duration-200 hover:-translate-y-px hover:text-foreground hover:ring-foreground/25 motion-reduce:hover:translate-y-0";

/** "Ask your AI about us": sits under the FAQ heading. */
export function AskAi() {
  return (
    <div id="ask-ai" className="max-w-[400px]">
      <p className="text-base font-medium text-foreground">Or ask your AI about us.</p>
      <p className="mt-1.5 text-sm leading-[1.6] text-muted-foreground">
        Everything on this page is in our llms.txt, limits included. Let your
        favorite model read it and tell you if vibecms fits.
      </p>
      <ul className="mt-5 flex flex-wrap gap-2">
        {askAiLinks().map(({ name, logo, href }) => (
          <li key={name}>
            <a className={CHIP} href={href} rel="noopener noreferrer" target="_blank">
              <img src={logo} alt="" width={16} height={16} className="size-4" aria-hidden="true" />
              {name}
              <span className="sr-only"> (opens a new chat)</span>
            </a>
          </li>
        ))}
        <li>
          <button type="button" className={`${CHIP} cursor-pointer`} data-copy={ASK_AI_PROMPT}>
            <span data-copy-label>Copy prompt</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
