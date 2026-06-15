import {
  CounterClockwiseClockIcon,
  CubeIcon,
  ReaderIcon,
} from "@radix-ui/react-icons";
import type { ComponentType } from "react";
import { GlassCard, SectionShell } from "./primitives";

const STRIP_ITEMS: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  {
    title: "Markdown-first",
    description:
      "A calm writing surface for prose, not page-builder sprawl.",
    icon: ReaderIcon,
  },
  {
    title: "Agent-scoped",
    description:
      "MCP means limited access to one blog, never your account.",
    icon: CubeIcon,
  },
  {
    title: "Versioned",
    description:
      "Every edit and publish is recorded - humans and agents alike.",
    icon: CounterClockwiseClockIcon,
  },
];

function IconChip({
  icon: Icon,
}: {
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <span className="grid size-[38px] shrink-0 place-items-center rounded-[11px] bg-brand-bright/10 text-brand-bright shadow-[inset_0_0_0_1px_oklch(0.8107_0.1705_152.72/0.16)]">
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
  );
}

export function FeatureStrip() {
  return (
    <section id="features">
      <SectionShell className="pb-0 pt-16 md:pt-[64px]">
        <GlassCard className="p-[22px]" data-reveal>
          <div className="grid gap-3.5 md:grid-cols-3 md:gap-3.5">
            {STRIP_ITEMS.map((item, index) => (
              <div
                key={item.title}
                className={[
                  "flex gap-3.5 p-2",
                  index > 0
                    ? "md:shadow-[-1px_0_0_var(--hairline)]"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <IconChip icon={item.icon} />
                <div className="min-w-0">
                  <div className="mb-0.5 font-display text-[15.5px] font-semibold text-foreground">
                    {item.title}
                  </div>
                  <p className="text-[13.5px] leading-[1.5] text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </SectionShell>
    </section>
  );
}