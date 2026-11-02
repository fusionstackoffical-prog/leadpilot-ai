import { Info } from "lucide-react";

/**
 * Accessible metric definition tooltip. Uses CSS only (hover and keyboard focus),
 * so it works in Server Components.
 */
export function InfoTip({ label, children }: { label: string; children: string }) {
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        aria-label={`How ${label} is calculated`}
        className="rounded text-fg-muted transition-colors hover:text-fg-secondary focus-visible:text-fg-secondary"
      >
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute top-full left-1/2 z-30 mt-2 w-60 -translate-x-1/2 rounded-md border border-line bg-elevated px-3 py-2 text-xs leading-relaxed font-normal text-fg-secondary opacity-0 shadow-lg shadow-black/40 transition-opacity group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}
