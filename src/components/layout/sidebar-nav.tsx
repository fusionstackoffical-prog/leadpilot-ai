"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavItemActive } from "@/config/navigation";
import { cn } from "@/lib/utils";

export type NavCounts = Partial<Record<"pendingApprovals" | "followUpsDue", number>>;

export function SidebarNav({
  collapsed = false,
  counts = {},
  onNavigate,
}: {
  collapsed?: boolean;
  counts?: NavCounts;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);
        const count = item.badgeKey ? counts[item.badgeKey] : undefined;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={collapsed ? item.label : undefined}
            className={cn(
              "group relative flex h-9 items-center gap-3 rounded-md text-sm transition-colors duration-150",
              collapsed ? "justify-center px-0" : "px-3",
              active
                ? "bg-accent-soft font-medium text-fg"
                : "text-fg-secondary hover:bg-hover hover:text-fg",
            )}
          >
            {active ? (
              <span
                className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-accent"
                aria-hidden
              />
            ) : null}
            <Icon
              className={cn(
                "size-4 shrink-0",
                active ? "text-accent" : "text-fg-muted group-hover:text-fg-secondary",
              )}
              aria-hidden
            />
            {collapsed ? (
              <span className="sr-only">{item.label}</span>
            ) : (
              <span className="truncate">{item.label}</span>
            )}
            {/* Badges render only when a real count exists. */}
            {count && count > 0 ? (
              collapsed ? (
                <span
                  className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent"
                  aria-label={`${count} pending`}
                />
              ) : (
                <span className="tabular ml-auto rounded bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-[#140a00]">
                  {count}
                </span>
              )
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
