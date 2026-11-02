import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const integerFormat = new Intl.NumberFormat("en-US");

export function formatCount(value: number) {
  return integerFormat.format(value);
}

const usdFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatUsd(value: number) {
  return usdFormat.format(value);
}

/** Returns null when the denominator is zero so callers never show a fabricated rate. */
export function formatRate(numerator: number, denominator: number): string | null {
  if (denominator <= 0) return null;
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function initials(nameOrEmail: string) {
  const base = nameOrEmail.split("@")[0] ?? "";
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return letters.toUpperCase() || "?";
}
