import type { ReactNode } from "react";

type Classable = {
  className?: string;
  children?: ReactNode;
};

// The single source of truth for the primary green CTA. Visual + interaction
// only (rounded, color, shadow, hover/active); each call adds its own size /
// padding. Pair with GREEN_BG on the style prop. Hover lift is motion-reduce safe.
export const GREEN_BG =
  "linear-gradient(180deg, oklch(0.8693 0.1435 156.03), oklch(0.7423 0.1585 154.53))";
export const GREEN_CTA =
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl font-semibold text-brand-bright-foreground no-underline shadow-[0_8px_20px_-8px_oklch(0.8107_0.1705_152.72/0.7),inset_0_1px_0_var(--hairline)] transition duration-200 ease-out hover:-translate-y-px hover:brightness-[1.06] active:translate-y-0 active:brightness-100 motion-reduce:hover:translate-y-0";
// Secondary / ghost button, with a hover that lifts the hairline + ink.
export const GHOST_CTA =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold text-secondary-foreground no-underline ring-1 ring-[color:var(--hairline)] [background:var(--surface-glass)] transition-colors duration-200 hover:text-foreground hover:ring-[color:var(--brand-bright)]/30";

export function DotGrid({ className, children }: Classable) {
  return (
    <div
      className={["pointer-events-none absolute inset-0", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_80%_60%_at_50%_0%,oklch(0_0_0)_30%,transparent_75%)]"
        style={{
          backgroundImage: "radial-gradient(var(--dot-grid-fill) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      {children}
    </div>
  );
}

export function Glow({ className, children }: Classable) {
  return (
    <div
      className={[
        "pointer-events-none absolute left-1/2 top-[-240px] h-[720px] w-[1100px] -translate-x-1/2 blur-[20px]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        background: "radial-gradient(ellipse at center, var(--glow-primary), transparent 68%)",
      }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

export function GlassCard({ className, children }: Classable) {
  return (
    <div
      className={[
        "rounded-[18px] shadow-[inset_0_1px_0_var(--hairline),0_24px_50px_-36px_oklch(0_0_0/0.9)] ring-1 ring-[color:var(--hairline)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        background: "linear-gradient(180deg, var(--surface-glass-strong), var(--surface-glass))",
      }}
    >
      {children}
    </div>
  );
}

export function GreenCard({ className, children }: Classable) {
  return (
    <div
      className={[
        "rounded-[18px] text-brand-bright-foreground shadow-[inset_0_1px_0_var(--hairline),0_40px_80px_-30px_oklch(0.8107_0.1705_152.72/0.55)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        background:
          "linear-gradient(160deg, oklch(0.8693 0.1435 156.03), oklch(0.7423 0.1585 154.53))",
      }}
    >
      {children}
    </div>
  );
}

type MonoEyebrowProps = Classable & {
  label: string;
};

export function MonoEyebrow({ className, label }: MonoEyebrowProps) {
  return (
    <p
      className={[
        "font-mono text-xs uppercase tracking-[0.16em] text-brand-bright",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label.startsWith("//") ? label : `// ${label}`}
    </p>
  );
}

type PillProps = Classable & {
  pulse?: boolean;
};

export function Pill({ className, children, pulse }: PillProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-brand-bright ring-1 ring-[color:var(--brand-bright)]/20 [background:oklch(0.8107_0.1705_152.72/0.08)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {pulse ? (
        <span
          className="size-1.5 shrink-0 rounded-full bg-brand-bright shadow-[0_0_10px_var(--brand-bright)] animate-vc-pulse"
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}

export function SectionShell({ className, children }: Classable) {
  return (
    <section
      className={[
        "relative mx-auto w-full max-w-[1200px] px-5 py-16 sm:px-7 md:py-[110px]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </section>
  );
}