"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormMessage, Input, Label } from "@/components/ui/form";
import { sendMagicLink, signInWithPassword, type AuthFormState } from "@/features/auth/actions";

const initial: AuthFormState = { status: "idle" };

export function LoginForm({ next, linkError }: { next: string; linkError: boolean }) {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [passwordState, passwordAction, passwordPending] = useActionState(
    signInWithPassword,
    initial,
  );
  const [linkState, linkAction, linkPending] = useActionState(sendMagicLink, initial);

  const state = mode === "password" ? passwordState : linkState;
  const pending = mode === "password" ? passwordPending : linkPending;

  return (
    <div className="space-y-4">
      {linkError && state.status === "idle" ? (
        <FormMessage tone="error">
          That sign-in link is invalid or has expired. Request a new one.
        </FormMessage>
      ) : null}

      <form action={mode === "password" ? passwordAction : linkAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={state.email}
            required
          />
        </div>

        {mode === "password" ? (
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
        ) : null}

        {state.status === "error" && state.message ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        {state.status === "sent" && state.message ? (
          <FormMessage tone="success">{state.message}</FormMessage>
        ) : null}

        <Button
          type="submit"
          variant="primary"
          className="w-full justify-center"
          disabled={pending}
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {mode === "password" ? "Sign in" : "Email me a sign-in link"}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => setMode(mode === "password" ? "link" : "password")}
        className="w-full text-center text-xs text-fg-secondary underline-offset-4 hover:text-fg hover:underline"
      >
        {mode === "password" ? "Use a sign-in link instead" : "Use a password instead"}
      </button>
    </div>
  );
}
