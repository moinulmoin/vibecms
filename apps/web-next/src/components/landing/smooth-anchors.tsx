"use client";

import { useEffect } from "react";

// Smooth in-page section navigation for the landing nav.
// rwsdk sets history.scrollRestoration = "manual" and drives navigation through
// RSC, which suppresses the browser's native (and CSS smooth) fragment scroll on
// hash links. So we intercept in-page anchor clicks and scroll the window
// ourselves - window.scrollTo with smooth behavior is reliable here.
export function SmoothAnchors() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target as Element | null;
      const link = target?.closest('a[href^="#"]') as HTMLAnchorElement | null;
      const hash = link?.getAttribute("href");
      if (!hash || hash === "#") return;

      const section = document.getElementById(hash.slice(1));
      if (!section) return;

      event.preventDefault();
      const header = document.querySelector("header");
      const offset = (header instanceof HTMLElement ? header.offsetHeight : 0) + 16;
      const top = section.getBoundingClientRect().top + window.scrollY - offset;
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      window.scrollTo({ top, behavior: prefersReducedMotion ? "auto" : "smooth" });
      history.pushState(null, "", hash);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}
