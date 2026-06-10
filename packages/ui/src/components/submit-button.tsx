"use client";

import * as React from "react";
import { ReloadIcon } from "@radix-ui/react-icons";
import { Button, type ButtonProps } from "./button";

export interface SubmitButtonProps extends ButtonProps {
  /** Label shown while the native form submission is in flight. Defaults to children. */
  pendingText?: React.ReactNode;
}

/**
 * Submit button for native (non-React-action) forms. Shows a spinner and
 * prevents double-submit without useFormStatus. It defers locking itself until
 * after the browser has collected the form data, so its own name/value survive.
 */
function SubmitButton({ children, pendingText, onClick, ...props }: SubmitButtonProps) {
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    // Restore interactivity if the user returns via the bfcache.
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const form = event.currentTarget.form;
    if (form && typeof form.checkValidity === "function" && !form.checkValidity()) return;
    window.setTimeout(() => setPending(true), 0);
  };

  return (
    <Button
      type="submit"
      aria-busy={pending || undefined}
      onClick={handleClick}
      {...props}
      disabled={pending || props.disabled}
    >
      {pending ? (
        <>
          <ReloadIcon className="size-4 animate-spin" aria-hidden="true" />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

export { SubmitButton };
