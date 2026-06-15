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
  GreenCard,
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
        "rounded-md px-2.5 py-1 font-mono text-[10px]",
        accent
          ? "bg-brand-bright/10 text-brand-bright"
          : "[background:var(--surface-glass-strong)] text-muted-foreground",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export function EssentialsBento() {
  return (
    <SectionShell className="pt-14 md:pt-24">
      <div className="mb-10 max-w-[620px]" data-reveal>
        <MonoEyebrow label="// The essentials" className="mb-4" />
        <h2 className="font-display text-[clamp(1.875rem,4vw,2.875rem)] font-semibold leading-[1.04] tracking-[-0.03em] text-foreground">
          Everything one serious
          <br />
          blog needs. Nothing it doesn&apos;t.
        </h2>
        <p className="mt-4 text-[16.5px] leading-[1.6] text-muted-foreground">
          One clean publication surface: editing, media, history, scoped agents,
          and public output - all wired together.
        </p>
      </div>

      <div
        className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-6"
        data-reveal
        data-d="1"
      >
        <GreenCard className="relative overflow-hidden p-[26px] md:col-span-2 lg:col-span-3">
          <div className="mb-11 inline-flex size-9 items-center justify-center rounded-[10px] bg-brand-bright-foreground/15 text-brand-bright-foreground">
            <ReaderIcon className="size-[18px]" aria-hidden="true" />
          </div>
          <h3 className="font-display text-[19px] font-semibold text-brand-bright-foreground">
            Markdown editor
          </h3>
          <p className="mt-1.5 max-w-[290px] text-sm leading-[1.55] text-brand-bright-foreground/70">
            Write in Markdown with live preview, drafts, and instant publish -
            keyboard-first, distraction-free.
          </p>
          <div className="mt-[18px] rounded-t-[11px] bg-brand-bright-foreground/15 px-[15px] py-3 font-mono text-[11.5px] leading-[1.7] text-brand-bright-foreground/70">
            <div>
              <span className="font-semibold text-brand-bright-foreground">
                ##{" "}
              </span>
              Section
            </div>
            <div>
              Body with{" "}
              <span className="font-semibold text-brand-bright-foreground">
                **bold**
              </span>{" "}
              text
            </div>
          </div>
        </GreenCard>

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
                Every human and agent action lands in one audit trail.
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
            <MonoPill accent>RSS</MonoPill>
            <MonoPill>sitemap</MonoPill>
            <MonoPill>meta tags</MonoPill>
          </div>
          <h3 className="font-display text-base font-semibold text-foreground">
            Public output
          </h3>
          <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
            RSS, sitemap, social cards and clean SEO pages - built in.
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
      </div>
    </SectionShell>
  );
}