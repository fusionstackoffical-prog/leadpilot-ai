"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPublicEnv } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/server";

// `email` is echoed back so the field survives React's automatic form reset.
export type AuthFormState = { status: "idle" | "error" | "sent"; message?: string; email?: string };

function submittedEmail(formData: FormData) {
  const value = formData.get("email");
  return typeof value === "string" ? value.slice(0, 254) : "";
}

const emailSchema = z.email("Enter a valid email address.").max(254);

/** Only allow same-origin relative redirects after login. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function signInWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = z
    .object({ email: emailSchema, password: z.string().min(1, "Enter your password.") })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });

  const email = submittedEmail(formData);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message, email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  // Same message for unknown user and wrong password, to avoid account enumeration.
  if (error) return { status: "error", message: "Incorrect email or password.", email };

  redirect(safeNext(formData.get("next")));
}

export async function sendMagicLink(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = submittedEmail(formData);
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message, email };

  const origin =
    getPublicEnv()?.NEXT_PUBLIC_SITE_URL ?? `https://${(await headers()).get("host") ?? ""}`;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      // Invite-only: never create accounts from the login form.
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(safeNext(formData.get("next")))}`,
    },
  });

  // Rate limits are worth surfacing; "user not found" is not (enumeration).
  if (error && error.status === 429) {
    return { status: "error", message: "Too many requests. Wait a minute and try again.", email };
  }

  return {
    status: "sent",
    message: "If an account exists for that email, a sign-in link is on its way.",
    email,
  };
}

export type UpdatePasswordState = { status: "idle" | "error"; message?: string };

const MIN_PASSWORD_LENGTH = 10;

const updatePasswordSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      .max(72, "Use 72 characters or fewer.")
      .regex(/[A-Za-z]/, "Include at least one letter.")
      .regex(/\d/, "Include at least one number."),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, { message: "Passwords don't match." });

/** Sets a password for the signed-in user (after an invite or recovery link). */
export async function updatePassword(
  _prev: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=link");

  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const message =
      error.code === "same_password"
        ? "Choose a password different from your current one."
        : error.code === "weak_password"
          ? "That password is too weak. Choose a longer or less common one."
          : error.code === "reauthentication_needed"
            ? "For security, request a new link and try again."
            : "Could not update your password. Request a new link and try again.";
    return { status: "error", message };
  }

  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
