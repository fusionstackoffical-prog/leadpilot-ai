import "server-only";
import { createClient } from "@supabase/supabase-js";
import { requirePublicEnv } from "@/lib/env/public";
import { requireServerEnv } from "@/lib/env/server";
import type { Database } from "@/types/database";

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 * Only for trusted server code (background jobs, signed automation callbacks).
 * Never use it to serve a user request without an explicit authorization check.
 */
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = requirePublicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = requireServerEnv();

  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
