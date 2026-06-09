"use client";

import * as React from "react";
import { Button, type ButtonProps } from "./button";

export interface ConfirmSubmitProps extends ButtonProps {
  /** Label shown after the first (arming) click. e.g. "Confirm archive". */
  confirmLabel: React.ReactNode;
  /** Short explanation announced when armed. */
  helperText?: string;
  /** Milliseconds before the armed state resets. */
  armedTimeoutMs?: number;
}

/**
 * Two-step submit for destructive actions inside native forms. The first click
 * arms (prevents submit, relabels, refocuses); the second click submits. No
 * blocking window.confirm, no extra page.
 */
function ConfirmSubmit({
  children,
  confirmLabel,
  helperText,
  armedTimeoutMs = 5000,
  variant = "destructive",
  onClick,
  ...props
}: ConfirmSubmitProps) {
  const [armed, setArmed] = React.useState(false);
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), armedTimeoutMs);
    return () => window.clearTimeout(timer);
  }, [armed, armedTimeoutMs]);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (!armed) {
      event.preventDefault();
      setArmed(true);
      requestAnimationFrame(() => ref.current?.focus());
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button ref={ref} type="submit" variant={variant} onClick={handleClick} {...props}>
        {armed ? confirmLabel : children}
      </Button>
      {armed && helperText ? (
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {helperText}
        </span>
      ) : null}
    </span>
  );
}

export { ConfirmSubmit };
