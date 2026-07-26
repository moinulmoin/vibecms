(() => {
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

  document.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('[data-vc-copy="code"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;

    const frame = button.closest("[data-vc-code-frame]");
    const code = frame?.querySelector("pre code") ?? frame?.querySelector("pre");
    if (!code) return;

    const label = button.textContent || "Copy";
    button.disabled = true;
    button.setAttribute("aria-live", "polite");
    try {
      await writeText(code.textContent || "");
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    } finally {
      window.setTimeout(() => {
        button.textContent = label;
        button.disabled = false;
      }, 1600);
    }
  });
})();
