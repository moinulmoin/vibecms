"use client";

import { useEffect } from "react";

export function TokenCookieClearer() {
  useEffect(() => {
    void fetch("/app/settings/token-created/clear", { method: "post", credentials: "same-origin" });
  }, []);

  return null;
}
