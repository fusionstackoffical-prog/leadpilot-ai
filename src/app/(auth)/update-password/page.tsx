import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { UpdatePasswordForm } from "@/features/auth/components/update-password-form";
import { getSessionUser } from "@/features/workspace/queries";

export const metadata: Metadata = { title: "Set password" };

/** Reached from invite and recovery links after /auth/confirm has verified the token. */
export default async function UpdatePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?error=link");

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-lg font-semibold text-fg">Set a new password</h1>
      <p className="mt-1 text-sm text-fg-muted">
        For <span className="text-fg-secondary">{user.email}</span>
      </p>
      <div className="mt-6">
        <UpdatePasswordForm email={user.email} />
      </div>
    </Card>
  );
}
