import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_TYPES: EmailOtpType[] = ["magiclink", "invite", "recovery", "email", "signup"];

// Invited users have no password yet; recovery links exist to set a new one.
const SET_PASSWORD_TYPES: EmailOtpType[] = ["invite", "recovery"];

/** Handles links from Supabase auth emails (magic link, invite, recovery). */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const destination = SET_PASSWORD_TYPES.includes(type) ? "/update-password" : next;
      return NextResponse.redirect(new URL(destination, request.url));
    }
  }

  const failure = new URL("/login", request.url);
  failure.searchParams.set("error", "link");
  return NextResponse.redirect(failure);
}
