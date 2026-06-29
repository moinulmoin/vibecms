"use client";

import { useEffect, useState } from "react";

const navItems = [
  ["Features", "features"],
  ["Agents", "agents"],
  ["Pricing", "pricing"],
  ["FAQ", "faq"],
] as const;

export function HeaderNav() {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = navItems
      .map(([, id]) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // a section is "active" once its middle crosses the viewport center
      { rootMargin: "-45% 0px -45% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="hidden items-center gap-8 md:flex">
      {navItems.map(([label, id]) => {
        const isActive = active === id;
        return (
          <a
            key={id}
            href={`#${id}`}
            aria-current={isActive ? "true" : undefined}
            className={[
              "relative text-sm font-medium no-underline transition-colors",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {label}
            <span
              className={[
                "absolute -bottom-1.5 left-0 h-px w-full origin-left bg-brand-bright transition-transform duration-200 ease-out",
                isActive ? "scale-x-100" : "scale-x-0",
              ].join(" ")}
              aria-hidden="true"
            />
          </a>
        );
      })}
    </nav>
  );
}
