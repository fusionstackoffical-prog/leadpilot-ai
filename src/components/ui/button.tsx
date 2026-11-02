import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-[#140a00] hover:bg-accent-hover font-semibold",
  secondary: "border border-line bg-elevated text-fg hover:border-line-strong hover:bg-hover",
  ghost: "text-fg-secondary hover:bg-hover hover:text-fg",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
};

const sizes: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-9 gap-2 px-4 text-sm",
  icon: "size-9 justify-center",
};

export type ButtonProps = ComponentProps<"button"> & { variant?: Variant; size?: Size };

export function buttonClasses({
  variant = "secondary",
  size = "md",
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    "inline-flex items-center rounded-md font-medium whitespace-nowrap transition-colors duration-150",
    "disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({ variant, size, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses({ variant, size, className })} {...props} />;
}
