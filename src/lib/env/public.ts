import { z } from "zod";

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

// NEXT_PUBLIC_ values are inlined at build time, so each must be referenced literally.
function readPublicEnv() {
  return publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
}

/** Returns validated public env, or null when Supabase is not configured yet. */
export function getPublicEnv(): PublicEnv | null {
  const result = readPublicEnv();
  return result.success ? result.data : null;
}

/** Names of missing or invalid public variables, for the setup screen. */
export function getPublicEnvIssues(): string[] {
  const result = readPublicEnv();
  if (result.success) return [];
  return [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
}

export function requirePublicEnv(): PublicEnv {
  const env = getPublicEnv();
  if (!env) {
    throw new Error(
      `Supabase is not configured. Missing or invalid: ${getPublicEnvIssues().join(", ")}`,
    );
  }
  return env;
}
