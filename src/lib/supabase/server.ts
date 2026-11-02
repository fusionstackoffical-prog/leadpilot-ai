import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requirePublicEnv } from "@/lib/env/public";
import type { Database } from "@/types/database";

/** Request-scoped client acting as the signed-in user. All queries are subject to RLS. */
export async function createClient() {
  // Read cookies first so the calling route is always rendered per request.
  const cookieStore = await cookies();
  const env = requirePublicEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The proxy refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
