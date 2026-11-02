"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requirePublicEnv } from "@/lib/env/public";
import type { Database } from "@/types/database";

export function createClient() {
  const env = requirePublicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
