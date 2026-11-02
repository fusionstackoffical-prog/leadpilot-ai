"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { UserMenu } from "@/components/layout/user-menu";
import { findNavItem } from "@/config/navigation";
import type { SessionUser, WorkspaceSummary } from "@/features/workspace/types";

export function Topbar({
  user,
  workspace,
  mobileNavOpen,
  onOpenMobileNav,
}: {
  user: SessionUser;
  workspace: WorkspaceSummary;
  mobileNavOpen: boolean;
  onOpenMobileNav: () => void;
}) {
  const pathname = usePathname();
  const page = findNavItem(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-app/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          aria-controls="mobile-nav"
          aria-expanded={mobileNavOpen}
          className="-ml-1 flex size-9 items-center justify-center rounded-md text-fg-secondary hover:bg-hover hover:text-fg lg:hidden"
        >
          <Menu className="size-5" aria-hidden />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg sm:text-lg">
            {page?.title ?? "LeadPilot AI"}
          </h1>
          {page ? (
            <p className="hidden truncate text-xs text-fg-muted sm:block">{page.subtitle}</p>
          ) : null}
        </div>

        <UserMenu user={user} workspace={workspace} />
      </div>
    </header>
  );
}
