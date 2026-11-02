import { CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Card } from "@/components/ui/card";
import { getPublicEnvIssues } from "@/lib/env/public";
import { getServerEnvIssues } from "@/lib/env/server";

export const metadata: Metadata = { title: "Setup required" };

const REQUIRED = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", scope: "public" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", scope: "public" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", scope: "server only" },
] as const;

/** Shown when Supabase isn't configured. Reports which variables are missing, never their values. */
export default async function SetupPage() {
  // Evaluate env at request time, not at build time.
  await connection();
  const missing = new Set([...getPublicEnvIssues(), ...getServerEnvIssues()]);
  if (missing.size === 0) redirect("/");

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-lg font-semibold text-fg">Connect Supabase</h1>
      <p className="mt-1 text-sm text-fg-muted">
        LeadPilot AI isn&apos;t connected to a database yet, so nothing can be shown.
      </p>

      <ul className="mt-6 space-y-2">
        {REQUIRED.map((item) => {
          const ok = !missing.has(item.name);
          return (
            <li
              key={item.name}
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-app px-3 py-2"
            >
              <span className="min-w-0">
                <code className="block truncate font-mono text-xs text-fg">{item.name}</code>
                <span className="text-[11px] text-fg-muted">{item.scope}</span>
              </span>
              {ok ? (
                <span className="flex items-center gap-1 text-xs text-success">
                  <CheckCircle2 className="size-3.5" aria-hidden /> Set
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-danger">
                  <XCircle className="size-3.5" aria-hidden /> Missing
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <ol className="mt-6 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-fg-secondary">
        <li>Create a project at supabase.com.</li>
        <li>Copy .env.example to .env.local and fill in the values from Project Settings → API.</li>
        <li>Apply the migrations in supabase/migrations (see docs/SETUP.md).</li>
        <li>Restart the dev server.</li>
      </ol>
    </Card>
  );
}
