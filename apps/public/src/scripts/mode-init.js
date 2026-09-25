// Pre-paint: apply a reader's remembered light/dark choice before first render.
try {
  var m = localStorage.getItem("vc-reader-mode");
  if (m === "light" || m === "dark") document.documentElement.setAttribute("data-vc-reader-mode", m);
} catch (e) {}
