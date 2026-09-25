// Reading niceties for public posts: ToC scroll-spy, reader light/dark toggle,
// article actions (share, copy as Markdown), image lightbox, and closing the
// mobile outline pill after a jump. Progressive: the page reads fine without it.
(() => {
  const root = document.documentElement;

  // ── ToC scroll-spy ────────────────────────────────────────────────────────
  // Active = the last heading whose top has crossed the trigger line. The line
  // equals the page's scroll-padding-top, so the highlighted entry always
  // matches where a clicked anchor lands.
  const links = Array.from(document.querySelectorAll("[data-vc-toc-link]"));
  if (links.length > 0) {
    const ids = [...new Set(links.map((a) => a.getAttribute("data-vc-toc-link")))];
    const headings = ids.map((id) => document.getElementById(id)).filter(Boolean);
    const triggerLine = () => (parseFloat(getComputedStyle(root).scrollPaddingTop) || 0) + 8;
    let frame = 0;
    let lastActive = null;
    const update = () => {
      frame = 0;
      let active = null;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom && headings.length > 0) {
        active = headings[headings.length - 1].id;
      } else {
        const line = triggerLine();
        for (const heading of headings) {
          if (heading.getBoundingClientRect().top <= line) active = heading.id;
          else break;
        }
      }
      if (active === lastActive) return;
      lastActive = active;
      for (const a of links) {
        if (a.getAttribute("data-vc-toc-link") === active) a.setAttribute("aria-current", "location");
        else a.removeAttribute("aria-current");
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    update();
  }

  // ── Reader light/dark toggle ─────────────────────────────────────────────
  // The owner's mode is the default; a reader's choice is remembered here and
  // applied pre-paint by the inline script in Base.astro.
  const currentScheme = () => {
    const forced = root.getAttribute("data-vc-reader-mode");
    if (forced === "light" || forced === "dark") return forced;
    const owner = root.getAttribute("data-vc-mode");
    if (owner === "light" || owner === "dark") return owner;
    // "system": the root's color-scheme is "light dark", so ask the OS.
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };

  async function writeText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard copy was rejected");
  }

  function flash(button, text) {
    const label = button.dataset.label || button.textContent;
    button.dataset.label = label;
    button.textContent = text;
    button.setAttribute("data-state", "done");
    window.setTimeout(() => {
      button.textContent = label;
      button.removeAttribute("data-state");
    }, 1800);
  }

  document.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;

    const toggle = event.target.closest("[data-vc-mode-toggle]");
    if (toggle) {
      const next = currentScheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-vc-reader-mode", next);
      try {
        localStorage.setItem("vc-reader-mode", next);
      } catch {}
      return;
    }

    const action = event.target.closest("[data-vc-action]");
    if (action instanceof HTMLButtonElement) {
      const url = action.getAttribute("data-vc-url") || location.href;
      try {
        if (action.dataset.vcAction === "share") {
          if (navigator.share) {
            await navigator.share({ title: document.title, url });
            return;
          }
          await writeText(url);
          flash(action, "Link copied");
        } else if (action.dataset.vcAction === "copy-markdown") {
          const res = await fetch(url, { headers: { accept: "text/markdown" } });
          if (!res.ok) throw new Error(String(res.status));
          await writeText(await res.text());
          flash(action, "Copied");
        }
      } catch (error) {
        if (error && error.name === "AbortError") return;
        flash(action, "Couldn’t copy");
      }
      return;
    }

    const tocLink = event.target.closest("details [data-vc-toc-link]");
    if (tocLink) tocLink.closest("details")?.removeAttribute("open");

    const img = event.target.closest("img[data-zoomable]");
    if (!(img instanceof HTMLImageElement) || typeof HTMLDialogElement !== "function") return;
    if (img.naturalWidth && img.naturalWidth <= img.clientWidth * 1.1) return;
    const dialog = document.createElement("dialog");
    dialog.className = "vc-lightbox";
    const full = document.createElement("img");
    full.src = img.currentSrc || img.src;
    full.alt = img.alt;
    dialog.appendChild(full);
    dialog.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
  });
})();
