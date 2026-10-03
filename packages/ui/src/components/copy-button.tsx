"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "./button";

export interface CopyButtonProps extends Omit<ButtonProps, "value" | "children"> {
  value: string;
  label?: string;
  copiedLabel?: string;
  /** Render only the icon (label still announced for screen readers). */
  iconOnly?: boolean;
}

function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  iconOnly = false,
  variant = "outline",
  size = "sm",
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
      } catch {
        // Clipboard unavailable; nothing else to do.
      }
      document.body.removeChild(textarea);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button type="button" variant={variant} size={size} onClick={copy} aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined} {...props}>
      {copied ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
      {iconOnly ? (
        <span className="sr-only" aria-live="polite">{copied ? copiedLabel : label}</span>
      ) : (
        <span aria-live="polite">{copied ? copiedLabel : label}</span>
      )}
    </Button>
  );
}

export { CopyButton };
