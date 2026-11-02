import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-line text-center",
        compact ? "gap-1.5 px-4 py-6" : "gap-2 px-6 py-10",
        className,
      )}
    >
      <span className="flex size-9 items-center justify-center rounded-md border border-line bg-elevated text-fg-muted">
        <Icon className="size-4" aria-hidden />
      </span>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <div className="max-w-sm text-xs text-fg-muted">{description}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-6 py-10 text-center"
    >
      <AlertTriangle className="size-5 text-danger" aria-hidden />
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <div className="max-w-md text-xs text-fg-secondary">{description}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-elevated", className)} aria-hidden />;
}
