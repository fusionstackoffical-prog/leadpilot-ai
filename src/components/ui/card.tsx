import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("rounded-card border border-line bg-card", className)} {...props} />
  );
}

type CardHeaderProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function CardHeader({ title, description, icon, actions, className }: CardHeaderProps) {
  return (
    <header className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? <span className="mt-0.5 text-fg-muted">{icon}</span> : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}
