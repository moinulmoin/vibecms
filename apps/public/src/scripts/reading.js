// Reading niceties for public posts: ToC scroll-spy, image lightbox, and
// closing the mobile outline pill after a jump. Progressive: the page reads
// fine without it.
(() => {
  const links = Array.from(document.querySelectorAll("[data-vc-toc-link]"));
  if (links.length > 0 && "IntersectionObserver" in window) {
    const ids = [...new Set(links.map((a) => a.getAttribute("data-vc-toc-link")))];
    const headings = ids.map((id) => document.getElementById(id)).filter(Boolean);
    const visible = new Set();
    const setActive = (id) => {
      for (const a of links) {
        if (a.getAttribute("data-vc-toc-link") === id) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = headings.find((h) => visible.has(h.id));
        if (first) {
          setActive(first.id);
          return;
        }
        // Between headings: keep the last one scrolled past.
        let current = null;
        for (const h of headings) {
          if (h.getBoundingClientRect().top < 80) current = h.id;
        }
        if (current) setActive(current);
      },
      { rootMargin: "0px 0px -65% 0px", threshold: 0 },
    );
    headings.forEach((h) => observer.observe(h));
  }

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
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
