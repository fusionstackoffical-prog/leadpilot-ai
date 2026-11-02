import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("mb-1.5 block text-xs font-medium text-fg-secondary", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-line bg-app px-3 text-sm text-fg placeholder:text-fg-muted",
        "transition-colors outline-none hover:border-line-strong focus:border-accent focus-visible:outline-none",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-md border border-line bg-app px-3 text-sm text-fg",
        "transition-colors outline-none hover:border-line-strong focus:border-accent",
        className,
      )}
      {...props}
    />
  );
}

export function FormMessage({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: React.ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        tone === "error"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-success/30 bg-success/10 text-success",
      )}
    >
      {children}
    </p>
  );
}
