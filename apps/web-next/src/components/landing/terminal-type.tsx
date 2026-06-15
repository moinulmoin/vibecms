"use client";

import { useEffect, useState } from "react";

const COMMAND = 'vibecms posts.publish --slug "shipping-with-mcp"';
const CHAR_MS = 55;
const HOLD_MS = 2800;

export function TerminalType() {
  const [text, setText] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setText(COMMAND);
      return;
    }

    let index = 0;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let typeTimer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (index <= COMMAND.length) {
        setText(COMMAND.slice(0, index));
        index += 1;
        typeTimer = setTimeout(tick, CHAR_MS);
      } else {
        holdTimer = setTimeout(() => {
          index = 0;
          setText("");
          typeTimer = setTimeout(tick, CHAR_MS);
        }, HOLD_MS);
      }
    };

    typeTimer = setTimeout(tick, CHAR_MS);

    return () => {
      clearTimeout(typeTimer);
      clearTimeout(holdTimer);
    };
  }, [reducedMotion]);

  return (
    <>
      <span id="vc-term">{text}</span>
      <span
        className="ml-0.5 inline-block h-3.5 w-[7px] align-[-3px] bg-brand-bright animate-vc-blink"
        aria-hidden="true"
      />
    </>
  );
}