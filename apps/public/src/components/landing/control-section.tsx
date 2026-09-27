import type { ComponentType, SVGProps } from "react";
import { CalendarClock, Eye, History, ShieldCheck } from "./icons";
import { H2, LEAD, PANEL, SectionLight, SectionShell } from "./primitives";

type Point = {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
};

const POINTS: Point[] = [
  {
    Icon: Eye,
    title: "A private preview for every draft",
    body: "Your agent sends you a link to the rendered post. Only people with the link can see it, and search engines never do.",
  },
  {
    Icon: ShieldCheck,
    title: "Approve the exact version",
    body: "Publishing pins one version. If it changed after you approved it, the publish is refused.",
  },
  {
    Icon: CalendarClock,
    title: "Schedule it",
    body: "Pick a time. That exact version goes live on the minute, and your agent can move or cancel it.",
  },
  {
    Icon: History,
    title: "Undo anything",
    body: "Every change is a version, and every action lands in one activity log. Restore any version in one step.",
  },
];

type Row = {
  v: number;
  who: string;
  agent: boolean;
  note: string;
  state?: "live" | "scheduled";
};

const ROWS: Row[] = [
  { v: 7, who: "claude", agent: true, note: "Tightened the intro", state: "scheduled" },
  { v: 6, who: "you", agent: false, note: "Published", state: "live" },
  { v: 5, who: "claude", agent: true, note: "Added a code sample" },
  { v: 4, who: "you", agent: false, note: "Restored version 2" },
];

function VersionMock() {
  return (
    <div className={PANEL} aria-hidden="true">
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hairline)] px-5 py-3.5">
        <span className="truncate text-sm font-medium text-foreground">Launch week recap</span>
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
            ) : row.state === "scheduled" ? (
              <span className="shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] text-foreground ring-1 ring-[color:var(--hairline)]">
                <span className="hidden sm:inline">scheduled · </span>Tue 09:00
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
      <SectionShell className="isolate grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
        <SectionLight x="28%" y="55%" size={680} strength={0.5} />
        <div data-reveal className="min-w-0 lg:order-2">
          <h2 id="control-title" className={H2}>
            Nothing goes live
            <br />
            by accident.
          </h2>
          <p className={`mt-4 max-w-[440px] ${LEAD}`}>
            Your agent drafts. You look at the real page, say yes, and pick
            when. Every step is saved and reversible.
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
