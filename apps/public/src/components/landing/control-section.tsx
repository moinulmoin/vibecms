import type { ComponentType, SVGProps } from "react";
import { History, ListChecks, ShieldCheck } from "./icons";
import { H2, LEAD, PANEL, SectionShell } from "./primitives";

type Point = {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
};

const POINTS: Point[] = [
  {
    Icon: ShieldCheck,
    title: "Approve the exact version",
    body: "Publishing pins one version. If it changed after you approved it, the publish is refused.",
  },
  {
    Icon: History,
    title: "Versions with one-click restore",
    body: "Every change is saved as a version. See what changed, restore any of them.",
  },
  {
    Icon: ListChecks,
    title: "One activity log",
    body: "Every action, by you or an agent, recorded in one place.",
  },
];

type Row = {
  v: number;
  who: string;
  agent: boolean;
  note: string;
  state?: "live" | "review";
};

const ROWS: Row[] = [
  { v: 7, who: "claude", agent: true, note: "Tightened the intro", state: "review" },
  { v: 6, who: "you", agent: false, note: "Published", state: "live" },
  { v: 5, who: "claude", agent: true, note: "Added a code sample" },
  { v: 4, who: "you", agent: false, note: "Restored version 2" },
];

function VersionMock() {
  return (
    <div className={PANEL} aria-hidden="true">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-5 py-3.5">
        <span className="truncate text-sm font-medium text-foreground">Shipping with MCP</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">history</span>
      </div>
      <ol className="divide-y divide-[color:var(--hairline)]">
        {ROWS.map((row) => (
          <li key={row.v} className="flex items-center gap-3 px-5 py-3.5">
            <span className="w-7 shrink-0 font-mono text-xs text-muted-foreground">v{row.v}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{row.note}</p>
              <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {row.agent ? "agent" : "human"} · {row.who}
              </p>
            </div>
            {row.state === "live" ? (
              <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-brand-bright">
                <span className="size-1.5 rounded-full bg-brand-bright" />
                live
              </span>
            ) : row.state === "review" ? (
              <span className="shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] text-foreground ring-1 ring-[color:var(--hairline)]">
                review
              </span>
            ) : (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">restore</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ControlSection() {
  return (
    <section id="control" aria-labelledby="control-title">
      <SectionShell className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
        <div data-reveal className="min-w-0 lg:order-2">
          <h2 id="control-title" className={H2}>
            Nothing goes live
            <br />
            by accident.
          </h2>
          <p className={`mt-4 max-w-[440px] ${LEAD}`}>
            You and your agents share one history. Review what changed, publish
            what you approved, undo anything.
          </p>
          <ul className="mt-8 grid gap-5">
            {POINTS.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <Icon className="mt-0.5 size-[18px] shrink-0 text-brand-bright" />
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-foreground">{title}</p>
                  <p className="mt-0.5 text-sm leading-[1.55] text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div data-reveal data-d="1" className="min-w-0 lg:order-1">
          <VersionMock />
        </div>
      </SectionShell>
    </section>
  );
}
