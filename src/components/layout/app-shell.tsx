"use client";

import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Brand } from "@/components/layout/brand";
import { SidebarNav, type NavCounts } from "@/components/layout/sidebar-nav";
import { Topbar } from "@/components/layout/topbar";
import type { SessionUser, WorkspaceSummary } from "@/features/workspace/types";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "leadpilot.sidebar.collapsed";

export function AppShell({
  user,
  workspace,
  counts,
  children,
}: {
  user: SessionUser;
  workspace: WorkspaceSummary;
  counts?: NavCounts;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Restore the remembered collapse preference after hydration.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser-only storage
      if (window.localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      // Storage unavailable (private mode); default to expanded.
    }
  }, []);

  // Close the mobile drawer on route change and on Escape.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync drawer to navigation
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Preference just won't persist.
      }
      return next;
    });
  }

  return (
    <div className="flex min-h-dvh bg-app">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-sidebar transition-[width] duration-200 lg:flex",
          collapsed ? "w-[68px]" : "w-[248px]",
        )}
      >
        <div
          className={cn(
            "flex h-16 items-center border-b border-line",
            collapsed ? "justify-center" : "px-5",
          )}
        >
          <Brand collapsed={collapsed} />
        </div>
        <div className={cn("flex-1 overflow-y-auto py-4", collapsed ? "px-2.5" : "px-3")}>
          <SidebarNav collapsed={collapsed} counts={counts} />
        </div>
        <div className={cn("border-t border-line py-3", collapsed ? "px-2.5" : "px-3")}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex h-9 w-full items-center gap-3 rounded-md text-sm text-fg-muted transition-colors hover:bg-hover hover:text-fg",
              collapsed ? "justify-center" : "px-3",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-4" aria-hidden />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn("fixed inset-0 z-40 lg:hidden", mobileOpen ? "" : "pointer-events-none")}
        aria-hidden={!mobileOpen}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/60 transition-opacity duration-200",
            mobileOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setMobileOpen(false)}
        />
        <aside
          id="mobile-nav"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          inert={!mobileOpen}
          className={cn(
            "absolute inset-y-0 left-0 flex w-[272px] max-w-[85vw] flex-col border-r border-line bg-sidebar pt-[env(safe-area-inset-top)] transition-transform duration-200",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex h-16 items-center justify-between border-b border-line px-5">
            <Brand />
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <SidebarNav counts={counts} onNavigate={() => setMobileOpen(false)} />
          </div>
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          workspace={workspace}
          mobileNavOpen={mobileOpen}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
