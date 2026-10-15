"use client";

import * as React from "react";
import { Check, Copy, X } from "lucide-react";
import { Button, type ButtonProps } from "./button";
import { Textarea } from "./textarea";

export interface CopyButtonProps extends Omit<ButtonProps, "value" | "children"> {
  value: string;
  label?: string;
  copiedLabel?: string;
  /** Shown on the button when nothing reached the clipboard. */
  failedLabel?: string;
  /** Render only the icon (label still announced for screen readers). */
  iconOnly?: boolean;
}

type CopyStatus = "idle" | "copied" | "failed";

/** Legacy fallback. Only `true` from execCommand means the text was copied. */
function copyWithExecCommand(value: string): boolean {
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy") === true;
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    previousFocus?.focus();
  }
  return copied;
}

/** Resolves true only once the text is known to be on the clipboard. */
async function writeToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Permission denied or no secure context: try the legacy path.
    }
  }
  return copyWithExecCommand(value);
}

const PANEL_WIDTH = 352;
const VIEWPORT_MARGIN = 8;

/** Fixed coordinates under the button, flipped above it when the panel would run off the bottom. */
function panelPosition(button: HTMLElement, panel: HTMLElement): React.CSSProperties {
  const rect = button.getBoundingClientRect();
  const height = panel.offsetHeight + 6;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN));
  if (rect.bottom + height > window.innerHeight && rect.top > height) {
    return { left, bottom: window.innerHeight - rect.top + 6 };
  }
  return { left, top: rect.bottom + 6 };
}

function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  failedLabel = "Couldn't copy",
  iconOnly = false,
  variant = "outline",
  size = "sm",
  ...props
}: CopyButtonProps) {
  const [status, setStatus] = React.useState<CopyStatus>("idle");
  const [position, setPosition] = React.useState<React.CSSProperties>({});
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const fieldRef = React.useRef<HTMLTextAreaElement>(null);
  const resetTimer = React.useRef<number | undefined>(undefined);
  const messageId = React.useId();

  React.useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const failed = status === "failed";

  const dismiss = React.useCallback(() => {
    setStatus("idle");
    buttonRef.current?.focus();
  }, []);

  // The manual-copy field stays on screen (and follows the button) until dismissed.
  React.useLayoutEffect(() => {
    if (!failed || !buttonRef.current || !panelRef.current) return;
    const button = buttonRef.current;
    const panel = panelRef.current;
    const place = () => setPosition(panelPosition(button, panel));
    // Window capture runs before the document-capture Escape listener of an
    // enclosing Radix Sheet/Dialog, so Escape closes only this panel.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof Node) || !panel.contains(event.target)) return;
      event.stopPropagation();
      event.preventDefault();
      dismiss();
    };
    place();
    fieldRef.current?.focus();
    fieldRef.current?.select();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [failed, dismiss]);

  const copy = async () => {
    window.clearTimeout(resetTimer.current);
    if (await writeToClipboard(value)) {
      setStatus("copied");
      resetTimer.current = window.setTimeout(() => setStatus("idle"), 2000);
    } else {
      setStatus("failed");
    }
  };

  const text = status === "copied" ? copiedLabel : failed ? failedLabel : label;
  const Icon = status === "copied" ? Check : failed ? X : Copy;

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant={variant}
        size={size}
        onClick={copy}
        aria-label={iconOnly ? text : undefined}
        aria-describedby={failed ? messageId : undefined}
        {...props}
      >
        <Icon className={failed ? "size-4 text-destructive" : "size-4"} aria-hidden="true" />
        <span className={iconOnly ? "sr-only" : undefined} aria-live="polite">{text}</span>
      </Button>
      {failed ? (
        <div
          ref={panelRef}
          data-slot="copy-button-fallback"
          className="fixed z-50 grid w-[min(22rem,calc(100vw-1rem))] gap-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-menu"
          style={position}
        >
          <div className="flex items-start justify-between gap-2">
            <p id={messageId} role="alert" className="text-sm text-destructive">
              Couldn't copy. Select the text below and copy it manually.
            </p>
            <Button type="button" variant="ghost" size="icon" className="-mr-1.5 -mt-1.5 size-7 shrink-0" onClick={dismiss}>
              <X aria-hidden="true" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
          {/* Textarea, not an input: multi-line snippets keep their line breaks. */}
          <Textarea
            ref={fieldRef}
            readOnly
            value={value}
            rows={Math.min(value.split("\n").length, 8)}
            aria-labelledby={messageId}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-0 resize-none font-mono text-xs"
          />
        </div>
      ) : null}
    </>
  );
}

export { CopyButton };
