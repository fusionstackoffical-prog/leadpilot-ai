import { Navigation } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-[#140a00]",
        className,
      )}
      aria-hidden
    >
      <Navigation className="size-4 fill-current" />
    </span>
  );
}

export function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      {collapsed ? (
        <span className="sr-only">LeadPilot AI</span>
      ) : (
        <span className="text-[15px] font-semibold tracking-tight text-fg">
          LeadPilot <span className="text-accent">AI</span>
        </span>
      )}
    </span>
  );
}
