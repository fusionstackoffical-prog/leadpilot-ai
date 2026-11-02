import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnvIssues(): string[] {
  const result = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
  });
  if (result.success) return [];
  return [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
}

export function requireServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
  });
  if (!result.success) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing or invalid.");
  }
  return result.data;
}
