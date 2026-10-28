document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.classList.contains("vc-subscribe-form")) return;
  if (form.dataset.externalForm === "true") {
    const successEl = form.querySelector("[data-subscribe-success]");
    if (successEl instanceof HTMLElement) {
      successEl.textContent = "Finish signing up in the new tab.";
      successEl.hidden = false;
    }
    return;
  }
  event.preventDefault();
  const siteSlug = form.dataset.siteSlug;
  const emailInput = form.querySelector('input[name="email"]');
  const companyInput = form.querySelector('input[name="company"]');
  const errorEl = form.querySelector("[data-subscribe-error]");
  const successEl = form.querySelector("[data-subscribe-success]");
  if (!(emailInput instanceof HTMLInputElement) || !siteSlug) return;
  const email = emailInput.value.trim().toLowerCase();
  const company = companyInput instanceof HTMLInputElement ? companyInput.value : "";
  if (errorEl instanceof HTMLElement) {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }
  try {
    // Proxied blogs mount under a base path; the form posts through the proxy.
    const apiBase = document.documentElement?.dataset?.vcBase || "";
    const res = await fetch(`${apiBase}/api/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, siteSlug, company }),
    });
    if (res.ok) {
      if (successEl instanceof HTMLElement) successEl.hidden = false;
      form.reset();
      return;
    }
    if (errorEl instanceof HTMLElement) {
      errorEl.hidden = false;
      errorEl.textContent =
        res.status === 400
          ? "Enter a valid email address."
          : res.status === 429
            ? "Too many attempts. Try again later."
            : "Something went wrong. Try again.";
    }
  } catch {
    if (errorEl instanceof HTMLElement) {
      errorEl.hidden = false;
      errorEl.textContent = "Something went wrong. Try again.";
    }
  }
});