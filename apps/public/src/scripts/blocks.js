// Progressive enhancement for generated Markdown blocks (@vc/content renderer).
// Everything reads fine without this script; it only adds:
//  - tabs: `.vc-tabs > section.vc-tab[data-vc-tab]` stacks become an ARIA
//    tablist; the chosen label syncs across groups and visits (localStorage).
//  - diagrams: `pre[data-vc-mermaid]` becomes an SVG. Mermaid is a same-origin
//    asset (data-mermaid-src on this script) loaded only when a diagram nears
//    the viewport, rendered with securityLevel "strict" and themed from the
//    blog's --vc-* tokens; re-rendered when the color scheme changes.
// Keep in sync with apps/dashboard/.../editor/use-block-enhancers.ts.
(() => {
  const script = document.currentScript;
  const mermaidSrc = (script && script.dataset.mermaidSrc) || "";
  const STORE = "vc:tabs";
  const MERMAID_MAX_CHARS = 5000;
  const state = new WeakMap();
  let seq = 0;

  // ── Tabs ─────────────────────────────────────────────────────────────
  const norm = (s) => String(s || "").trim().toLowerCase();

  function readPrefs() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) || "[]");
      return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
    } catch {
      return [];
    }
  }

  function writePref(label) {
    try {
      const prefs = [label, ...readPrefs().filter((l) => l !== label)].slice(0, 12);
      localStorage.setItem(STORE, JSON.stringify(prefs));
    } catch {
      // Private mode / blocked storage: the choice just isn't remembered.
    }
  }

  function show(group, index, focus) {
    const s = state.get(group);
    if (!s) return;
    s.buttons.forEach((b, i) => {
      const on = i === index;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      s.panels[i].hidden = !on;
    });
    if (focus) s.buttons[index].focus();
  }

  function choose(group, index) {
    const s = state.get(group);
    const button = s.buttons[index];
    const label = norm(button.textContent);
    const before = button.getBoundingClientRect().top;
    writePref(label);
    show(group, index, true);
    for (const other of document.querySelectorAll(".vc-tabs[data-vc-tabs-ready]")) {
      if (other === group) continue;
      const o = state.get(other);
      const i = o ? o.buttons.findIndex((b) => norm(b.textContent) === label) : -1;
      if (i !== -1) show(other, i, false);
    }
    // Groups above may have changed height; keep the clicked tab still.
    const delta = button.getBoundingClientRect().top - before;
    if (Math.abs(delta) > 1) window.scrollBy(0, delta);
  }

  function setupTabs(root) {
    const prefs = readPrefs();
    for (const group of root.querySelectorAll(".vc-tabs")) {
      const panels = [...group.children].filter((el) => el.matches("section.vc-tab"));
      if (!panels.length) continue;
      const id = `vc-tabs-${++seq}`;
      const list = document.createElement("div");
      list.className = "vc-tablist";
      list.setAttribute("role", "tablist");
      const buttons = panels.map((panel, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.id = `${id}-tab-${i}`;
        b.textContent = panel.dataset.vcTab || `Tab ${i + 1}`;
        b.setAttribute("role", "tab");
        b.setAttribute("aria-controls", `${id}-panel-${i}`);
        panel.id = `${id}-panel-${i}`;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", b.id);
        panel.tabIndex = 0;
        list.append(b);
        return b;
      });
      group.prepend(list);
      group.setAttribute("data-vc-tabs-ready", "");
      state.set(group, { buttons, panels });

      let initial = 0;
      for (const p of prefs) {
        const i = buttons.findIndex((b) => norm(b.textContent) === p);
        if (i !== -1) {
          initial = i;
          break;
        }
      }
      show(group, initial, false);

      list.addEventListener("click", (event) => {
        const i = buttons.indexOf(event.target.closest("button"));
        if (i !== -1) choose(group, i);
      });
      list.addEventListener("keydown", (event) => {
        const current = buttons.indexOf(document.activeElement);
        if (current === -1) return;
        const last = buttons.length - 1;
        const next =
          event.key === "ArrowRight" ? (current === last ? 0 : current + 1)
          : event.key === "ArrowLeft" ? (current === 0 ? last : current - 1)
          : event.key === "Home" ? 0
          : event.key === "End" ? last
          : -1;
        if (next === -1) return;
        event.preventDefault();
        choose(group, next);
      });
    }
  }

  /**
   * Opens every hidden tab panel around the element a `#fragment` points at
   * (a TOC link to a heading in an inactive tab). Returns the element when a
   * panel had to be opened, so the caller can scroll to it.
   */
  function revealFragment(hash) {
    if (!hash || hash.length < 2) return null;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // Malformed escapes: use the raw fragment.
    }
    const target = document.getElementById(id);
    if (!target) return null;
    let opened = false;
    for (let panel = target.closest("section.vc-tab"); panel; panel = panel.parentElement?.closest("section.vc-tab")) {
      if (!panel.hidden) continue;
      const group = panel.parentElement;
      const s = group && state.get(group);
      const i = s ? s.panels.indexOf(panel) : -1;
      if (i === -1) continue;
      show(group, i, false);
      opened = true;
    }
    return opened ? target : null;
  }

  function setupFragments() {
    if (!document.querySelector(".vc-tabs[data-vc-tabs-ready]")) return;
    // Initial load: the browser's fragment scroll found a hidden element.
    revealFragment(location.hash)?.scrollIntoView();
    // Back/forward or typed fragments.
    window.addEventListener("hashchange", () => revealFragment(location.hash)?.scrollIntoView());
    // In-page links (also same-hash clicks, which fire no hashchange): open the
    // panel before the default navigation scrolls to the target.
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
        if (link) revealFragment(link.hash);
      },
      true,
    );
  }

  // ── Diagrams ─────────────────────────────────────────────────────────
  let mermaidPromise = null;

  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(window.mermaid);
    if (!mermaidSrc) return Promise.reject(new Error("mermaid unavailable"));
    mermaidPromise ??= new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = mermaidSrc;
      s.async = true;
      s.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error("mermaid missing")));
      s.onerror = () => reject(new Error("mermaid failed to load"));
      document.head.append(s);
    });
    return mermaidPromise;
  }

  let ctx = null;
  /** Resolves a --vc-* token (oklch, light-dark) to #rrggbb for Mermaid. */
  function tokenHex(el, token, fallback) {
    const probe = document.createElement("span");
    probe.style.color = `var(${token}, ${fallback})`;
    el.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    if (!ctx) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    }
    if (!ctx) return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = fallback;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }

  function diagramTheme(el) {
    const bg = tokenHex(el, "--vc-bg", "#ffffff");
    const fg = tokenHex(el, "--vc-fg", "#1f1f1f");
    const muted = tokenHex(el, "--vc-muted", "#f4f4f4");
    const mutedFg = tokenHex(el, "--vc-muted-fg", "#6b6b6b");
    const border = tokenHex(el, "--vc-border", "#dddddd");
    const n = parseInt(bg.slice(1), 16);
    const luminance = (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    return {
      darkMode: luminance < 0.5,
      background: bg,
      fontFamily: getComputedStyle(el).fontFamily,
      fontSize: "14px",
      primaryColor: muted,
      primaryTextColor: fg,
      primaryBorderColor: border,
      secondaryColor: muted,
      tertiaryColor: bg,
      lineColor: mutedFg,
      textColor: fg,
      mainBkg: muted,
      nodeBorder: border,
      clusterBkg: bg,
      clusterBorder: border,
      titleColor: fg,
      edgeLabelBackground: bg,
      noteBkgColor: muted,
      noteTextColor: fg,
      noteBorderColor: border,
      actorBkg: muted,
      actorBorder: border,
      actorTextColor: fg,
      actorLineColor: mutedFg,
      signalColor: fg,
      signalTextColor: fg,
      labelBoxBkgColor: muted,
      labelBoxBorderColor: border,
      labelTextColor: fg,
      loopTextColor: fg,
    };
  }

  const rendered = new WeakMap();

  async function renderDiagrams(root) {
    const pres = [...root.querySelectorAll("pre[data-vc-mermaid]")];
    if (!pres.length) return;
    const mermaid = await loadMermaid();
    for (const pre of pres) {
      const figure = pre.closest(".vc-diagram") || pre.parentElement;
      const source = pre.textContent || "";
      if (!figure || source.length > MERMAID_MAX_CHARS) continue;
      const theme = diagramTheme(figure);
      const signature = `${JSON.stringify(theme)}\u0000${source}`;
      if (rendered.get(pre) === signature) continue;
      rendered.set(pre, signature);
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        maxTextSize: MERMAID_MAX_CHARS,
        suppressErrorRendering: true,
        theme: "base",
        themeVariables: theme,
      });
      const id = `vc-mermaid-${++seq}`;
      let out = figure.querySelector(":scope > .vc-diagram-svg");
      try {
        const { svg } = await mermaid.render(id, source);
        if (!out) {
          out = document.createElement("div");
          out.className = "vc-diagram-svg";
          figure.append(out);
        }
        // Mermaid "strict" output: labels are sanitized, click handlers disabled.
        out.innerHTML = svg;
        // Wide diagrams scroll on phones instead of shrinking to unreadable text.
        const svgEl = out.querySelector("svg");
        const natural = parseFloat(svgEl?.style.maxWidth || "");
        if (svgEl && natural > 0) svgEl.style.minWidth = `${Math.min(natural, 480)}px`;
        pre.hidden = true;
        figure.setAttribute("data-vc-diagram-ready", "");
      } catch {
        // Invalid diagram: keep the readable source.
        document.getElementById(`d${id}`)?.remove();
        out?.remove();
        pre.hidden = false;
        figure.removeAttribute("data-vc-diagram-ready");
      }
    }
  }

  let queue = Promise.resolve();
  const schedule = () => {
    queue = queue.then(() => renderDiagrams(document)).catch(() => undefined);
  };

  function setupDiagrams() {
    const figures = document.querySelectorAll("pre[data-vc-mermaid]");
    if (!figures.length) return;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      schedule();
      let timer = 0;
      const rerender = () => {
        clearTimeout(timer);
        timer = setTimeout(schedule, 60);
      };
      window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", rerender);
      new MutationObserver(rerender).observe(document.documentElement, {
        attributes: true,
        subtree: true,
        attributeFilter: ["data-vc-mode", "data-vc-theme", "data-vc-reader-mode"],
      });
    };
    if (!("IntersectionObserver" in window)) return start();
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: "800px 0px" },
    );
    figures.forEach((f) => io.observe(f));
  }

  function init() {
    setupTabs(document);
    setupFragments();
    setupDiagrams();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
