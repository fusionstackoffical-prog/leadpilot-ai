// Reads migration 010 (read-only) so tests can prove the analysis core agrees with the database.
// The migration is never modified; if its text changes, these helpers follow it.
import { readFileSync } from "node:fs";

const SQL = readFileSync(
  new URL("../../supabase/migrations/20261105000010_ai_analysis.sql", import.meta.url),
  "utf8",
);

export const migrationSql = SQL;

/** The quoted values of the first `<column> in ( ... )` list after `after` in the SQL. */
function quotedList(after: string, column: string): string[] {
  const start = SQL.indexOf(after);
  if (start < 0) throw new Error(`migration text not found: ${after}`);
  const m = new RegExp(`${column}\\s+in\\s*\\(([^)]*)\\)`).exec(SQL.slice(start));
  if (!m) throw new Error(`no "${column} in (...)" after: ${after}`);
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

export const migrationCategories = () =>
  quotedList("create table public.lead_opportunities", "category");
export const migrationFitLevels = () =>
  quotedList("create table public.lead_opportunities", "fit_level");
/** The check constraint on lead_analysis_runs.error_code (every code the database can store). */
export const migrationStoredErrorCodes = () =>
  quotedList("create table public.lead_analysis_runs", "error_code");

/** The codes worker_fail_analysis_run accepts from a worker. */
export function migrationWorkerErrorCodes(): string[] {
  const start = SQL.indexOf("create or replace function public.worker_fail_analysis_run");
  const m = /p_error_code not in \(([^)]*)\)/.exec(SQL.slice(start));
  if (!m) throw new Error("worker_fail_analysis_run code list not found");
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

/** The text of a regular-expression literal such as `prompt_version ~ '...'`. */
export function migrationPattern(column: string): string {
  const m = new RegExp(`${column}\\s*~\\s*'([^']*)'`).exec(SQL);
  if (!m) throw new Error(`no pattern for ${column}`);
  return m[1];
}

export function migrationNumber(re: RegExp): number {
  const m = re.exec(SQL);
  if (!m) throw new Error(`migration text not found: ${re}`);
  return Number(m[1]);
}

/** The keys worker_complete_analysis_run reads from p_result. */
export function migrationResultKeys(): {
  top: string[];
  usage: string[];
  ai: string[];
  opportunity: string[];
} {
  const start = SQL.indexOf("create or replace function public.worker_complete_analysis_run");
  const end = SQL.indexOf("create or replace function public.worker_fail_analysis_run");
  const body = SQL.slice(start, end);
  const top = new Set<string>();
  for (const m of body.matchAll(/p_result\s*(?:->>?)\s*'([a-z_]+)'/g)) top.add(m[1]);
  const nested = (name: string) =>
    new Set(
      [...body.matchAll(new RegExp(`p_result #>> '\\{${name},([a-z_]+)\\}'`, "g"))].map(
        (m) => m[1],
      ),
    );
  const usage = nested("usage");
  const ai = nested("ai");
  for (const key of ["usage", "ai"]) top.add(key);
  const opportunity = new Set(
    [...body.matchAll(/v_item\s*(?:->>?)\s*'([a-z_]+)'/g)].map((m) => m[1]),
  );
  return {
    top: [...top].sort(),
    usage: [...usage].sort(),
    ai: [...ai].sort(),
    opportunity: [...opportunity].sort(),
  };
}
