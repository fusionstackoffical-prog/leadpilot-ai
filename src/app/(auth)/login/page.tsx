import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { LoginForm } from "@/features/auth/components/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const linkError = params.error === "link";

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-lg font-semibold text-fg">Sign in</h1>
      <p className="mt-1 text-sm text-fg-muted">Access is by invitation only.</p>
      <div className="mt-6">
        <LoginForm next={next} linkError={linkError} />
      </div>
    </Card>
  );
}
