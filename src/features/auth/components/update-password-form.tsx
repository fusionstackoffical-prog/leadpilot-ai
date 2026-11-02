"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/form";
import { updatePassword, type UpdatePasswordState } from "@/features/auth/actions";

const initial: UpdatePasswordState = { status: "idle" };

export function UpdatePasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(updatePassword, initial);

  return (
    <form action={action} className="space-y-4">
      {/* Lets password managers associate the new password with the account. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      <div>
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={72}
          required
        />
        <p className="mt-1.5 text-xs text-fg-muted">
          At least 10 characters, including a letter and a number.
        </p>
      </div>
      <div>
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          maxLength={72}
          required
        />
      </div>
      {state.status === "error" && state.message ? (
        <FormMessage tone="error">{state.message}</FormMessage>
      ) : null}
      <Button type="submit" variant="primary" className="w-full justify-center" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Save password
      </Button>
    </form>
  );
}
