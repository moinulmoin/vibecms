const NAV_ACTIVE = "relative text-sm font-medium no-underline transition-colors text-foreground";
const NAV_IDLE =
  "relative text-sm font-medium no-underline transition-colors text-muted-foreground hover:text-foreground";
const UNDERLINE_ON =
  "absolute -bottom-1.5 left-0 h-px w-full origin-left bg-brand-bright transition-transform duration-200 ease-out scale-x-100";
const UNDERLINE_OFF =
  "absolute -bottom-1.5 left-0 h-px w-full origin-left bg-brand-bright transition-transform duration-200 ease-out scale-x-0";

const BADGE_LIVE =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] text-brand-bright ring-1 ring-brand-bright/35";
const BADGE_QUIET =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] text-foreground/85 ring-1 ring-[color:var(--hairline)]";
const DOT_LIVE = "size-1.5 rounded-full bg-brand-bright";
const DOT_QUIET = "size-1.5 rounded-full bg-muted-foreground/60";
const NODE_GLOW = "0 0 28px oklch(0.8107 0.1705 152.72 / 0.45)";

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

// Hero steps: 1 ask · 2 private preview · 3 approve · 4 scheduled · 5 live.
const HERO_BADGES = {
  1: "drafting…",
  2: "private preview",
  3: "private preview",
  4: "scheduled · Tue 09:00",
  5: "live",
};

function setHeroStep(root, step) {
  root.dataset.step = String(step);
  const live = step === 5;
  const url = root.querySelector("[data-hero-url]");
  const badge = root.querySelector("[data-hero-badge]");
  const dot = root.querySelector("[data-hero-badge-dot]");
  const label = root.querySelector("[data-hero-badge-label]");
  const byline = root.querySelector("[data-hero-byline]");
  const node = root.querySelector("[data-hero-node]");
  if (url instanceof HTMLElement) {
    url.textContent = live ? root.dataset.liveUrl || "" : root.dataset.previewUrl || "";
  }
  if (badge instanceof HTMLElement) badge.className = live ? BADGE_LIVE : BADGE_QUIET;
  if (dot instanceof HTMLElement) dot.className = live ? DOT_LIVE : DOT_QUIET;
  if (label instanceof HTMLElement) label.textContent = HERO_BADGES[step];
  if (byline instanceof HTMLElement) {
    byline.textContent = step >= 4 ? "by claude · approved by you" : "by claude · waiting for you";
  }
  if (node instanceof HTMLElement) node.style.boxShadow = live ? NODE_GLOW : "";
}

// How long each step stays on screen before the next one.
const HERO_DURATIONS = { 1: 1800, 2: 2100, 3: 1600, 4: 2100, 5: 3900 };

function initHeroDemo() {
  const root = document.querySelector("[data-hero-demo]");
  if (!(root instanceof HTMLElement)) return;

  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const pills = [...root.querySelectorAll("[data-hero-goto]")];
  let timer = 0;

  const go = (step, autoplay = !mq.matches) => {
    clearTimeout(timer);
    setHeroStep(root, step);
    for (const pill of pills) {
      if (Number(pill.getAttribute("data-hero-goto")) === step) pill.setAttribute("aria-current", "step");
      else pill.removeAttribute("aria-current");
    }
    if (autoplay) timer = setTimeout(() => go(step === 5 ? 1 : step + 1), HERO_DURATIONS[step]);
  };

  for (const pill of pills) {
    pill.addEventListener("click", () => go(Number(pill.getAttribute("data-hero-goto"))));
  }
  go(mq.matches ? 5 : 1);
  mq.addEventListener("change", () => go(mq.matches ? 5 : 1));
}

function initHistoryDemo() {
  const root = document.querySelector("[data-history-demo]");
  if (!(root instanceof HTMLElement)) return;
  const row = root.querySelector("[data-history-new]");
  const note = root.querySelector("[data-history-new-note]");
  const status = root.querySelector("[data-history-status]");
  if (!(row instanceof HTMLElement) || !note) return;
  for (const button of root.querySelectorAll("[data-history-restore]")) {
    button.addEventListener("click", () => {
      const v = button.getAttribute("data-history-restore");
      note.textContent = `Restored version ${v}`;
      row.hidden = false;
      // Replay the entrance on every restore.
      row.classList.remove("vc-history-in");
      void row.offsetWidth;
      row.classList.add("vc-history-in");
      if (status) status.textContent = `Restored version ${v} as a new version.`;
    });
  }
}

function initThemePicker() {
  const target = document.querySelector("[data-theme-target]");
  const picks = [...document.querySelectorAll("[data-theme-pick]")];
  if (!(target instanceof HTMLElement) || picks.length === 0) return;
  for (const pick of picks) {
    pick.addEventListener("click", () => {
      target.dataset.vcTheme = pick.getAttribute("data-theme-pick") || "technical";
      try {
        const vars = JSON.parse(pick.getAttribute("data-theme-vars") || "{}");
        for (const [name, value] of Object.entries(vars)) target.style.setProperty(name, String(value));
      } catch {}
      for (const other of picks) other.setAttribute("aria-pressed", other === pick ? "true" : "false");
    });
  }
}

function initPricingPeriod() {
  const root = document.querySelector("[data-pricing]");
  if (!(root instanceof HTMLElement)) return;
  const buttons = [...root.querySelectorAll("[data-period-pick]")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      root.dataset.period = button.getAttribute("data-period-pick") || "monthly";
      for (const other of buttons) other.setAttribute("aria-pressed", other === button ? "true" : "false");
    });
  }
}

function initKeyLevels() {
  const root = document.querySelector("[data-key-demo]");
  if (!(root instanceof HTMLElement)) return;
  const buttons = [...root.querySelectorAll("[data-key-level]")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      root.dataset.level = button.getAttribute("data-key-level") || "draft";
      for (const other of buttons) other.setAttribute("aria-pressed", other === button ? "true" : "false");
    });
  }
}

function initCopyButtons() {
  for (const button of document.querySelectorAll("[data-copy]")) {
    const label = button.querySelector("[data-copy-label]");
    const original = label?.textContent || "";
    let reset = 0;
    button.addEventListener("click", async () => {
      clearTimeout(reset);
      try {
        await navigator.clipboard.writeText(button.getAttribute("data-copy") || "");
        if (label) label.textContent = "Copied";
      } catch {
        if (label) label.textContent = "Copy failed";
      }
      reset = setTimeout(() => {
        if (label) label.textContent = original;
      }, 1800);
    });
  }
}

function initConnectTabs() {
  const root = document.querySelector("[data-connect-tabs]");
  if (!(root instanceof HTMLElement)) return;
  const tabs = [...root.querySelectorAll("[data-connect-tab]")];
  const copy = root.querySelector("[data-connect-copy]");
  const select = (tab) => {
    const id = tab.getAttribute("data-connect-tab");
    for (const other of tabs) {
      const on = other === tab;
      other.setAttribute("aria-selected", on ? "true" : "false");
      other.tabIndex = on ? 0 : -1;
    }
    for (const panel of root.querySelectorAll("[data-connect-panel]")) {
      const on = panel.getAttribute("data-connect-panel") === id;
      panel.hidden = !on;
      if (on && copy) copy.setAttribute("data-copy", panel.getAttribute("data-copy-text") || "");
    }
  };
  tabs.forEach((tab, i) => {
    tab.tabIndex = i === 0 ? 0 : -1;
    tab.addEventListener("click", () => select(tab));
    // Arrow keys move between tabs, as in any tablist.
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabs[(i + step + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });
}

// Transparent over the hero; a light backing appears once content scrolls under it.
function initHeader() {
  const header = document.querySelector("[data-landing-header]");
  if (!(header instanceof HTMLElement)) return;
  const update = () => {
    if (window.scrollY > 8) header.dataset.scrolled = "";
    else delete header.dataset.scrolled;
  };
  update();
  window.addEventListener("scroll", update, { passive: true });
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
initHeader();
initMobileNav();
initKeyLevels();
initHistoryDemo();
initThemePicker();
initPricingPeriod();
initCopyButtons();
initConnectTabs();
initHeroDemo();
