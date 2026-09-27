const NAV_ACTIVE = "relative text-sm font-medium no-underline transition-colors text-foreground";
const NAV_IDLE =
  "relative text-sm font-medium no-underline transition-colors text-muted-foreground hover:text-foreground";
const UNDERLINE_ON =
  "absolute -bottom-1.5 left-0 h-px w-full origin-left bg-brand-bright transition-transform duration-200 ease-out scale-x-100";
const UNDERLINE_OFF =
  "absolute -bottom-1.5 left-0 h-px w-full origin-left bg-brand-bright transition-transform duration-200 ease-out scale-x-0";

const BADGE_LIVE =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] text-brand-bright ring-1 ring-brand-bright/35";
const BADGE_QUIET =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px] text-foreground/85 ring-1 ring-[color:var(--hairline)]";
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

function initHeroDemo() {
  const root = document.querySelector("[data-hero-demo]");
  if (!(root instanceof HTMLElement)) return;

  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  const clear = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };
  const at = (ms, fn) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const run = () => {
    clear();
    if (mq.matches) {
      setHeroStep(root, 5);
      return;
    }
    setHeroStep(root, 1);
    at(1800, () => setHeroStep(root, 2));
    at(3900, () => setHeroStep(root, 3));
    at(5500, () => setHeroStep(root, 4));
    at(7600, () => setHeroStep(root, 5));
    at(11500, run);
  };

  run();
  mq.addEventListener("change", run);
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

function initCopyPrompt() {
  for (const button of document.querySelectorAll("[data-copy-prompt]")) {
    const label = button.querySelector("[data-copy-label]");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.getAttribute("data-copy-prompt") || "");
        if (label) label.textContent = "Copied";
      } catch {
        if (label) label.textContent = "Copy failed";
      }
      setTimeout(() => {
        if (label) label.textContent = "Copy prompt";
      }, 1800);
    });
  }
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
initCopyPrompt();
initHeroDemo();
