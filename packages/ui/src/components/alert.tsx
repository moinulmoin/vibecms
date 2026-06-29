import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { CheckCircledIcon, CrossCircledIcon, ExclamationTriangleIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import { cn } from "../lib/utils";

const alertVariants = cva(
  "relative flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-sm font-sans ring-1 ring-[color:var(--hairline)]",
  {
    variants: {
      variant: {
        info: "border-border bg-card text-card-foreground",
        success: "border-primary/30 bg-accent text-accent-foreground",
        error: "border-destructive/40 bg-destructive/10 text-foreground",
        warning: "border-amber-500/40 bg-amber-500/10 text-foreground",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const icons = { info: InfoCircledIcon, success: CheckCircledIcon, error: CrossCircledIcon, warning: ExclamationTriangleIcon } as const;

interface AlertProps extends React.ComponentProps<"div">, VariantProps<typeof alertVariants> {
  title?: string;
}

function Alert({ className, variant = "info", title, children, role, ...props }: AlertProps) {
  const resolved = variant ?? "info";
  const Icon = icons[resolved];
  const resolvedRole = role ?? (resolved === "error" || resolved === "warning" ? "alert" : "status");
  return (
    <div
      role={resolvedRole}
      aria-live={resolvedRole === "alert" ? "assertive" : "polite"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? <p className="font-display font-medium leading-snug">{title}</p> : null}
        {children ? (
          <div className="leading-snug text-muted-foreground [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4">
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { Alert, alertVariants };
