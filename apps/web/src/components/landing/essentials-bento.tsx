import { MEDIA } from "@vc/config";
import {
  CounterClockwiseClockIcon,
  CubeIcon,
  FileTextIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import type { ReactNode } from "react";
import {
  GlassCard,
  MonoEyebrow,
  SectionShell,
} from "./primitives";

function BentoIcon({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "mb-4 grid size-[34px] place-items-center rounded-[10px] bg-brand-bright/10 text-brand-bright shadow-[inset_0_0_0_1px_oklch(0.8107_0.1705_152.72/0.16)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

function ActivityRow({
  active,
  label,
}: {
  active?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 [background:var(--surface-glass-strong)]">
      <span
        className={[
          "size-1.5 shrink-0 rounded-full",
          active ? "bg-brand-bright" : "bg-muted-foreground/70",
        ].join(" ")}
        aria-hidden="true"
      />
      <span className="font-mono text-[10.5px] text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function MonoPill({
  children,
  accent,
}: {
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <span
      className={[
        "rounded-md px-2.5 py-1 font-mono text-[11px]",
        accent
          ? "bg-brand-bright/10 text-brand-bright"
          : "[background:var(--surface-glass-strong)] text-muted-foreground",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

const THEME_SWATCHES = [
  ["minimal", "Minimal"],
  ["editorial", "Editorial"],
  ["technical", "Technical"],
  ["product", "Product"],
] as const;

// Renders a real, token-driven mini-preview of each blog preset (forced light
// so the four accents read distinctly on the dark landing).
function ThemePreview({ id, name }: { id: string; name: string }) {
  return (
    <div>
      <div
        data-vc-theme={id}
        data-vc-mode="light"
        className="rounded-xl border border-vc-border bg-vc-bg p-3 shadow-[0_12px_26px_-20px_oklch(0_0_0/0.85)]"
      >
        <div className="h-1.5 w-7 rounded-full bg-vc-accent" />
        <div className="mt-2.5 h-1.5 w-full rounded-full bg-vc-fg/85" />
        <div className="mt-1.5 h-1 w-4/5 rounded-full bg-vc-fg/30" />
        <div className="mt-1 h-1 w-2/3 rounded-full bg-vc-fg/30" />
      </div>
      <div className="mt-2 text-center font-mono text-[10.5px] text-muted-foreground">
        {name}
      </div>
    </div>
  );
}

export function EssentialsBento() {
  return (
    <section id="features">
    <SectionShell className="pt-14 md:pt-24">
      <div className="mb-10 max-w-[620px]" data-reveal>
        <MonoEyebrow label="// The essentials" className="mb-4" />
        <h2 className="text-balance font-display text-[clamp(1.875rem,4vw,2.875rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
          Everything one serious
          <br />
          blog needs. Nothing it doesn&apos;t.
        </h2>
        <p className="mt-4 text-[16.5px] leading-[1.6] text-muted-foreground">
          One clean publication surface: editing, media, history, designed themes,
          scoped agents, and your own domain - all wired together.
        </p>
      </div>

      <div
        className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-6"
        data-reveal
        data-d="1"
      >
        <GlassCard className="relative overflow-hidden p-[26px] md:col-span-2 lg:col-span-3">
          <div className="mb-6 grid size-9 place-items-center rounded-[10px] bg-brand-bright/10 text-brand-bright shadow-[inset_0_0_0_1px_oklch(0.8107_0.1705_152.72/0.16)]">
            <ReaderIcon className="size-[18px]" aria-hidden="true" />
          </div>
          <h3 className="font-display text-[19px] font-semibold text-foreground">
            Markdown editor
          </h3>
          <p className="mt-1.5 max-w-[320px] text-sm leading-[1.55] text-muted-foreground">
            Live preview, drafts, and instant publish - with callouts, code blocks,
            and a table of contents built in.
          </p>
          <div className="mt-[18px] rounded-t-[11px] px-[15px] py-3 font-mono text-[11.5px] leading-[1.7] text-muted-foreground ring-1 ring-[color:var(--hairline)] [background:var(--surface-glass-strong)]">
            <div>
              <span className="font-semibold text-brand-bright">## </span>Section
            </div>
            <div>
              Body with <span className="font-semibold text-brand-bright">**bold**</span> text
            </div>
          </div>
        </GlassCard>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:col-span-2 lg:col-span-3">
          <GlassCard className="p-[22px]">
            <BentoIcon>
              <CubeIcon className="size-[17px]" aria-hidden="true" />
            </BentoIcon>
            <h3 className="font-display text-base font-semibold text-foreground">
              Scoped MCP
            </h3>
            <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
              Let agents draft, publish, archive, upload, and read - only what
              you allow.
            </p>
          </GlassCard>

          <GlassCard className="p-[22px]">
            <BentoIcon>
              <CounterClockwiseClockIcon
                className="size-[17px]"
                aria-hidden="true"
              />
            </BentoIcon>
            <h3 className="font-display text-base font-semibold text-foreground">
              Version history
            </h3>
            <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
              Every revision is saved. Diff, restore, and trace who changed what.
            </p>
          </GlassCard>

          <GlassCard className="flex flex-col gap-4 p-[22px] sm:col-span-2 sm:flex-row sm:items-center sm:gap-[18px]">
            <div className="min-w-0 flex-1">
              <BentoIcon className="mb-3.5">
                <FileTextIcon className="size-[17px]" aria-hidden="true" />
              </BentoIcon>
              <h3 className="font-display text-base font-semibold text-foreground">
                Activity log
              </h3>
              <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
                Every action you or your agents take lands in one audit trail.
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-1.5 sm:max-w-[168px]">
              <ActivityRow active label="agent published" />
              <ActivityRow label="you edited draft" />
              <ActivityRow label="media uploaded" />
            </div>
          </GlassCard>
        </div>

        <GlassCard className="p-[22px] md:col-span-1 lg:col-span-2">
          <div className="mb-4 flex gap-1.5">
            <span className="size-[38px] rounded-lg bg-gradient-to-br from-brand-bright/25 to-brand-bright/5" />
            <span className="size-[38px] rounded-lg [background:linear-gradient(135deg,var(--surface-glass-strong),var(--surface-glass))]" />
            <span className="size-[38px] rounded-lg [background:linear-gradient(135deg,oklch(1_0_0/0.07),var(--surface-glass))]" />
          </div>
          <h3 className="font-display text-base font-semibold text-foreground">
            Media library
          </h3>
          <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
            Upload images up to {MEDIA.maxImageLabel}, stored on R2 and served
            fast.
          </p>
        </GlassCard>

        <GlassCard className="p-[22px] md:col-span-1 lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-1.5">
            <MonoPill accent>your domain</MonoPill>
            <MonoPill>RSS</MonoPill>
            <MonoPill>sitemap</MonoPill>
            <MonoPill>llms.txt</MonoPill>
            <MonoPill>.md</MonoPill>
          </div>
          <h3 className="font-display text-base font-semibold text-foreground">
            Your domain, clean output
          </h3>
          <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
            Bring your own domain. RSS, sitemap, SEO,{" "}
            <span className="font-mono text-[12px] text-foreground">llms.txt</span>,
            and clean Markdown of every post - for readers and agents.
          </p>
        </GlassCard>

        <GlassCard className="p-[22px] md:col-span-2 lg:col-span-2">
          <div className="mb-4 rounded-lg bg-background/30 px-[11px] py-2.5 font-mono text-[11px] leading-[1.6] text-muted-foreground">
            <span className="text-brand-bright">{"{"}</span> &quot;posts&quot;:{" "}
            <span className="text-brand-bright">[ … ]</span>{" "}
            <span className="text-brand-bright">{"}"}</span>
          </div>
          <h3 className="font-display text-base font-semibold text-foreground">
            Export anytime
          </h3>
          <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
            Download every post as JSON. No lock-in, ever.
          </p>
        </GlassCard>

        <GlassCard className="p-[26px] md:col-span-2 lg:col-span-6">
          <div className="flex flex-col gap-7 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-[360px]">
              <h3 className="font-display text-[19px] font-semibold text-foreground">
                Themes that look designed
              </h3>
              <p className="mt-1.5 text-sm leading-[1.55] text-muted-foreground">
                Four token-driven themes - Minimal, Editorial, Technical, Product -
                in light and dark, with three layouts. Your blog looks built, not
                generic.
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-3.5 sm:grid-cols-4 lg:max-w-[460px]">
              {THEME_SWATCHES.map(([id, name]) => (
                <ThemePreview key={id} id={id} name={name} />
              ))}
            </div>
          </div>
        </GlassCard>
      </div>
    </SectionShell>
    </section>
  );
}
