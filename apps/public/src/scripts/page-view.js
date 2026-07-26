(() => {
  const script = document.currentScript;
  const slug = script instanceof HTMLScriptElement ? script.dataset.postSlug : "";
  const dnt = navigator.doNotTrack === "1" || navigator.doNotTrack === "yes";
  const gpc = navigator.globalPrivacyControl === true;
  if (!slug || dnt || gpc) return;

  let referrerHost = "";
  if (document.referrer) {
    try {
      referrerHost = new URL(document.referrer).hostname;
    } catch {
      referrerHost = "";
    }
  }

  const payload = JSON.stringify({ slug, referrerHost });
  const body = new Blob([payload], { type: "application/json" });
  if (navigator.sendBeacon("/api/analytics/view", body)) return;

  void fetch("/api/analytics/view", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    credentials: "same-origin",
    keepalive: true,
  });
})();
