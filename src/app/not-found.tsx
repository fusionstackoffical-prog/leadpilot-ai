import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="text-lg font-semibold text-fg">Page not found</h1>
      <p className="text-sm text-fg-muted">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link href="/" className={buttonClasses({ className: "mt-2" })}>
        Back to overview
      </Link>
    </div>
  );
}
