"use client";

import { ChevronDown, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/features/auth/actions";
import type { SessionUser, WorkspaceSummary } from "@/features/workspace/types";
import { cn, initials } from "@/lib/utils";

export function UserMenu({ user, workspace }: { user: SessionUser; workspace: WorkspaceSummary }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const displayName = user.fullName ?? user.email;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-md py-1 pr-2 pl-1 transition-colors hover:bg-hover"
      >
        <span className="flex size-8 items-center justify-center rounded-md border border-line bg-elevated text-xs font-semibold text-fg">
          {initials(displayName)}
        </span>
        <span className="hidden min-w-0 text-left md:block">
          <span className="block max-w-40 truncate text-sm leading-4 font-medium text-fg">
            {displayName}
          </span>
          <span className="block max-w-40 truncate text-[11px] text-fg-muted">
            {workspace.name}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 text-fg-muted transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-line bg-elevated p-1.5 shadow-xl shadow-black/50"
        >
          <div className="border-b border-line px-2.5 pt-1.5 pb-2.5">
            <p className="truncate text-sm font-medium text-fg">{displayName}</p>
            <p className="truncate text-xs text-fg-muted">{user.email}</p>
            <p className="mt-1.5 text-[11px] text-fg-muted">
              {workspace.name} · <span className="capitalize">{workspace.role}</span>
            </p>
          </div>
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-fg-secondary hover:bg-hover hover:text-fg"
          >
            <Settings className="size-4" aria-hidden />
            Settings
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-fg-secondary hover:bg-hover hover:text-fg"
            >
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
