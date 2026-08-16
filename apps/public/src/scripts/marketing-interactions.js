const NAV_ACTIVE = "relative text-sm font-medium no-underline transition-colors text-foreground";
const NAV_IDLE =
  "relative text-sm font-medium no-underline transition-colors text-muted-foreground hover:text-foreground";
const UNDERLINE_ON =
  "absolute -bottom-1.5 left-0 h-px w-full origin-left bg-brand-bright transition-transform duration-200 ease-out scale-x-100";
const UNDERLINE_OFF =
  "absolute -bottom-1.5 left-0 h-px w-full origin-left bg-brand-bright transition-transform duration-200 ease-out scale-x-0";

const SWITCH_ON =
  "relative h-[25px] w-11 shrink-0 rounded-full border-0 p-0 transition-[background,box-shadow] duration-250 ease-out before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] bg-gradient-to-b from-primary to-brand-bright shadow-[0_0_0_1px_oklch(0.8107_0.1705_152.72/0.45),0_8px_18px_-8px_oklch(0.8107_0.1705_152.72/0.7)]";
const SWITCH_OFF =
  "relative h-[25px] w-11 shrink-0 rounded-full border-0 p-0 transition-[background,box-shadow] duration-250 ease-out before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] bg-white/10 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.09)]";
const KNOB_ON =
  "absolute top-[3px] size-[19px] rounded-full shadow-[0_2px_5px_oklch(0_0_0/0.4)] transition-[left,background] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] left-[22px] bg-brand-bright-foreground";
const KNOB_OFF =
  "absolute top-[3px] size-[19px] rounded-full shadow-[0_2px_5px_oklch(0_0_0/0.4)] transition-[left,background] duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] left-[3px] bg-muted-foreground/80";
const STATE_ON = "min-w-[52px] text-right font-mono text-[10.5px] transition-colors text-brand-bright";
const STATE_OFF =
  "min-w-[52px] text-right font-mono text-[10.5px] transition-colors text-muted-foreground";

const NODE_ACTIVE =
  "relative z-10 grid size-14 scale-105 place-items-center rounded-2xl ring-1 ring-brand-bright/70 shadow-[0_0_30px_oklch(0.8107_0.1705_152.72/0.5)] transition-all duration-500 [background:var(--surface-panel-from)]";
const NODE_IDLE =
  "relative z-10 grid size-14 scale-100 place-items-center rounded-2xl ring-1 ring-brand-bright/30 transition-all duration-500 [background:var(--surface-panel-from)]";
const BADGE_LIVE =
  "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold transition-colors duration-500 text-brand-bright ring-1 ring-brand-bright/35 [background:oklch(0.8107_0.1705_152.72/0.12)]";
const BADGE_IDLE =
  "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold transition-colors duration-500 text-muted-foreground ring-1 ring-[color:var(--hairline)]";

function initNav() {
  const nav = document.querySelector("[data-landing-nav]");
  if (!(nav instanceof HTMLElement)) return;

  const links = [...nav.querySelectorAll("[data-nav-section]")].filter(
    (el) => el instanceof HTMLAnchorElement,
  );
  if (links.length === 0) return;

  const sections = links
    .map((link) => {
      const id = link.getAttribute("data-nav-section");
      const section = id ? document.getElementById(id) : null;
      return section instanceof HTMLElement ? { id, link, section } : null;
    })
    .filter(Boolean);

  if (sections.length === 0) return;

  const setActive = (activeId) => {
    for (const { id, link } of sections) {
      const on = id === activeId;
      link.className = on ? NAV_ACTIVE : NAV_IDLE;
      if (on) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
      const underline = link.querySelector("[data-nav-underline]");
      if (underline instanceof HTMLElement) {
        underline.className = on ? UNDERLINE_ON : UNDERLINE_OFF;
      }
    }
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]?.target?.id) setActive(visible[0].target.id);
    },
    { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 1] },
  );

  for (const { section } of sections) observer.observe(section);
}

function formatScopeTokenFromRows(rows) {
  const enabled = rows
    .filter((row) => row.on)
    .map((row) => row.token)
    .filter(Boolean);
  return enabled.length > 0 ? enabled.join("  ") : "- no scopes granted -";
}

function applyScopeRow(row, on) {
  row.dataset.on = on ? "true" : "false";
  const label = row.getAttribute("data-scope-label") || "scope";
  const state = row.querySelector("[data-scope-state]");
  const sw = row.querySelector("[data-scope-switch]");
  const knob = row.querySelector("[data-scope-knob]");
  if (state instanceof HTMLElement) {
    state.className = on ? STATE_ON : STATE_OFF;
    state.textContent = on ? "Allowed" : "Blocked";
  }
  if (sw instanceof HTMLButtonElement) {
    sw.className = on ? SWITCH_ON : SWITCH_OFF;
    sw.dataset.on = on ? "true" : "false";
    sw.setAttribute("aria-pressed", on ? "true" : "false");
    sw.setAttribute("aria-label", `${on ? "Revoke" : "Allow"} ${label}`);
  }
  if (knob instanceof HTMLElement) {
    knob.className = on ? KNOB_ON : KNOB_OFF;
  }
}

function initScopeDemo() {
  const root = document.querySelector("[data-scope-demo]");
  if (!(root instanceof HTMLElement)) return;

  const tokenEl =
    document.querySelector("[data-scope-token]") ||
    root.closest("section")?.querySelector("[data-scope-token]");
  const rows = [...root.querySelectorAll("[data-scope-row]")].filter(
    (el) => el instanceof HTMLElement,
  );

  const refreshToken = () => {
    if (!(tokenEl instanceof HTMLElement)) return;
    const snapshot = rows.map((row) => {
      const sw = row.querySelector("[data-scope-switch]");
      const on = sw instanceof HTMLElement ? sw.dataset.on === "true" : false;
      return { on, token: row.getAttribute("data-scope-token-part") || "" };
    });
    tokenEl.textContent = formatScopeTokenFromRows(snapshot);
  };

  for (const row of rows) {
    const sw = row.querySelector("[data-scope-switch]");
    if (!(sw instanceof HTMLButtonElement)) continue;
    applyScopeRow(row, sw.dataset.on === "true");
    sw.addEventListener("click", () => {
      applyScopeRow(row, sw.dataset.on !== "true");
      refreshToken();
    });
  }
  refreshToken();
}

function setHeroPhase(root, phase) {
  root.dataset.phase = phase;
  const cursor = root.querySelector("[data-hero-cursor]");
  const agent = root.querySelector("[data-hero-agent]");
  const agentDot = root.querySelector("[data-hero-agent-dot]");
  const agentStatus = root.querySelector("[data-hero-agent-status]");
  const liveLine = root.querySelector("[data-hero-live-line]");
  const trackH = root.querySelector("[data-hero-track-h]");
  const trackV = root.querySelector("[data-hero-track-v]");
  const node = root.querySelector("[data-hero-node]");
  const post = root.querySelector("[data-hero-post]");
  const badge = root.querySelector("[data-hero-live-badge]");
  const liveDot = root.querySelector("[data-hero-live-dot]");

  const publishing = phase === "publishing";
  const published = phase === "live";
  const active = publishing || published;
  const typing = phase === "typing";

  if (cursor instanceof HTMLElement) {
    cursor.hidden = !typing;
    cursor.style.display = typing ? "" : "none";
  }
  if (agent instanceof HTMLElement) {
    agent.classList.toggle("opacity-0", typing);
    agent.classList.toggle("opacity-100", !typing);
  }
  if (agentDot instanceof HTMLElement) {
    agentDot.classList.toggle("animate-vc-pulse", publishing);
  }
  if (agentStatus instanceof HTMLElement) {
    agentStatus.textContent = published ? "published to vibecms" : "routing through vibecms…";
  }
  if (liveLine instanceof HTMLElement) {
    liveLine.classList.toggle("opacity-0", !published);
    liveLine.classList.toggle("opacity-100", published);
  }
  if (trackH instanceof HTMLElement) trackH.style.width = active ? "100%" : "0%";
  if (trackV instanceof HTMLElement) trackV.style.height = active ? "100%" : "0%";
  if (node instanceof HTMLElement) node.className = active ? NODE_ACTIVE : NODE_IDLE;
  if (post instanceof HTMLElement) {
    post.classList.toggle("opacity-100", published);
    post.classList.toggle("opacity-45", !published);
  }
  if (badge instanceof HTMLElement) badge.className = published ? BADGE_LIVE : BADGE_IDLE;
  if (liveDot instanceof HTMLElement) {
    liveDot.className = published
      ? "size-1.5 rounded-full bg-brand-bright shadow-[0_0_8px_var(--brand-bright)]"
      : "size-1.5 rounded-full bg-muted-foreground/40";
  }
}

function initHeroDemo() {
  const root = document.querySelector("[data-hero-demo]");
  if (!(root instanceof HTMLElement)) return;
  const prompt = root.getAttribute("data-hero-prompt") || "";
  const typed = root.querySelector("[data-hero-typed]");
  if (!(typed instanceof HTMLElement)) return;

  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  let cancelled = false;
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  const at = (ms, fn) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!cancelled) fn();
    }, ms);
    timers.add(id);
  };
  const clear = () => {
    cancelled = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };

  const applyReduced = () => {
    clear();
    cancelled = false;
    typed.textContent = prompt;
    setHeroPhase(root, "live");
  };

  const runLoop = () => {
    clear();
    cancelled = false;
    if (mq.matches) {
      applyReduced();
      return;
    }

    let i = 0;
    const run = () => {
      typed.textContent = "";
      setHeroPhase(root, "typing");
      i = 0;
      const type = () => {
        if (cancelled) return;
        if (i <= prompt.length) {
          typed.textContent = prompt.slice(0, i);
          i += 1;
          at(48, type);
        } else {
          at(650, () => setHeroPhase(root, "publishing"));
          at(2000, () => setHeroPhase(root, "live"));
          at(5600, run);
        }
      };
      at(700, type);
    };
    run();
  };

  runLoop();
  mq.addEventListener("change", runLoop);
}

function initMobileNav() {
  const nav = document.querySelector("[data-mobile-nav]");
  if (!(nav instanceof HTMLDetailsElement)) return;

  const summary = nav.querySelector("summary");

  document.addEventListener("click", (event) => {
    if (nav.open && !(event.target instanceof Node && nav.contains(event.target))) {
      nav.open = false;
    }
  });

  nav.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.open) {
      nav.open = false;
      if (summary instanceof HTMLElement) summary.focus();
    }
  });

  for (const link of nav.querySelectorAll("[data-mobile-nav-link]")) {
    link.addEventListener("click", () => {
      nav.open = false;
    });
  }
}

initNav();
initMobileNav();
initScopeDemo();
initHeroDemo();
