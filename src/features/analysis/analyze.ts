import type { FitLevel, OpportunityCategory } from "./catalogue.ts";
import { buildEvidencePack, type PackStats, type ResearchFindingInput } from "./evidence-pack.ts";
import { classifyIssues, type Issue } from "./issues.ts";
import { RESULT_LIMITS, RUN_LIMITS } from "./limits.ts";
import { parseModelOutput } from "./output-schema.ts";
import { buildAnalysisPrompt, buildRepairPrompt, type AnalysisPrompt } from "./prompt.ts";
import {
  isProviderErrorCode,
  ProviderError,
  type AnalysisProvider,
  type GenerateResponse,
  type WorkerErrorCode,
} from "./provider.ts";
import { validateOutput } from "./validate.ts";
import { PROMPT_VERSION, SCHEMA_VERSION } from "./versions.ts";

/**
 * Analyzes ONE completed research run: evidence pack -> model -> parse -> validate, with at most
 * one repair attempt. Pure application logic: no database, no network (the provider is injected),
 * no environment, no clock besides the timeout timer.
 *
 * Returns either
 *  - `ok: true` with `result`, shaped EXACTLY like the p_result argument of
 *    public.worker_complete_analysis_run (migration 010), or
 *  - `ok: false` with one of the error codes a worker may report to public.worker_fail_analysis_run,
 *    and the usage already spent (so a failed attempt's cost can still be recorded).
 *
 * Neither outcome ever contains raw provider text or a raw exception: a failure is a code only.
 */

export type Usage = { input_tokens: number; output_tokens: number; cost_usd: number };

/** One opportunity exactly as worker_complete_analysis_run reads it. */
export type ResultOpportunity = {
  category: OpportunityCategory;
  fit_level: FitLevel;
  rationale: string;
  confidence: number;
  supporting_finding_ids: string[];
  missing_information: string[];
  uncertainty: string;
};

/** The p_result argument of worker_complete_analysis_run. Exactly these keys, no others. */
export type CompletionResult = {
  ai: { provider: string; model: string };
  /** SHA-256 hex of the evidence pack. */
  input_hash: string;
  input_finding_count: number;
  usage: Usage;
  warning_codes: string[];
  /** In rank order: rank 1 first. */
  opportunities: ResultOpportunity[];
};

/** Extra information for the caller. NOT part of the database call. */
export type AnalysisMeta = {
  /** 1, or 2 when the answer was repaired. */
  attempts: 1 | 2;
  promptVersion: string;
  schemaVersion: string;
  /** Per category: does the opportunity rest on an unconfirmed candidate? (The database computes this too.) */
  basedOnUnconfirmed: Partial<Record<OpportunityCategory, boolean>>;
  pack: PackStats;
};

export type AnalyzeSuccess = { ok: true; result: CompletionResult; meta: AnalysisMeta };

export type AnalyzeFailure = {
  ok: false;
  code: WorkerErrorCode;
  /** What was spent before failing; pass it to worker_fail_analysis_run. */
  usage: Usage;
  attempts: number;
  /** True when the caller's own signal ended the analysis. */
  aborted?: true;
};

export type AnalyzeResult = AnalyzeSuccess | AnalyzeFailure;

export type AnalyzeInput = {
  /** The findings of ONE completed research run. */
  findings: readonly ResearchFindingInput[];
  provider: AnalysisProvider;
  /** The caller's own cancellation (for example a lost lease). */
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** system + user text above this fails with input_too_large instead of calling the model. */
  maxPromptChars?: number;
};

const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,49}$/;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;

const ZERO: Usage = { input_tokens: 0, output_tokens: 0, cost_usd: 0 };

function add(total: Usage, response: GenerateResponse): Usage {
  const whole = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const cost =
    typeof response.usage?.costUsd === "number" && Number.isFinite(response.usage.costUsd)
      ? Math.max(0, response.usage.costUsd)
      : 0;
  return {
    input_tokens: total.input_tokens + whole(response.usage?.inputTokens),
    output_tokens: total.output_tokens + whole(response.usage?.outputTokens),
    // numeric(12,6) in the database
    cost_usd: Math.round((total.cost_usd + cost) * 1e6) / 1e6,
  };
}

const fail = (
  code: WorkerErrorCode,
  usage: Usage,
  attempts: number,
  aborted?: true,
): AnalyzeFailure => ({ ok: false, code, usage, attempts, ...(aborted ? { aborted } : {}) });

type CallOutcome =
  { ok: true; response: GenerateResponse } | { ok: false; code: WorkerErrorCode; aborted?: true };

/** One provider call with a timeout and the caller's cancellation. Never throws. */
async function callProvider(
  provider: AnalysisProvider,
  prompt: AnalysisPrompt,
  maxOutputTokens: number,
  timeoutMs: number,
  parent: AbortSignal | undefined,
): Promise<CallOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();
  if (parent?.aborted) return { ok: false, code: "internal_error", aborted: true };
  parent?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  // Guarantees this function returns when aborted, even if the provider ignores the signal.
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

  try {
    const response = await Promise.race([
      provider.generate(
        { system: prompt.system, messages: prompt.messages, maxOutputTokens },
        controller.signal,
      ),
      aborted,
    ]);
    return { ok: true, response };
  } catch (error) {
    if (timedOut) return { ok: false, code: "provider_timeout" };
    if (parent?.aborted) return { ok: false, code: "internal_error", aborted: true };
    if (error instanceof ProviderError && isProviderErrorCode(error.code)) {
      return { ok: false, code: error.code };
    }
    return { ok: false, code: "internal_error" };
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
}

export async function analyzeResearch(input: AnalyzeInput): Promise<AnalyzeResult> {
  const { provider } = input;
  const timeoutMs = input.timeoutMs ?? RUN_LIMITS.defaultTimeoutMs;
  const maxOutputTokens = input.maxOutputTokens ?? RUN_LIMITS.defaultMaxOutputTokens;
  const maxPromptChars = input.maxPromptChars ?? RUN_LIMITS.maxPromptChars;

  if (!PROVIDER_ID.test(provider.id)) return fail("internal_error", ZERO, 0);

  const built = buildEvidencePack(input.findings);
  if (!built.ok) return fail(built.code, ZERO, 0);
  const { pack } = built;

  const first = buildAnalysisPrompt(pack);
  const promptChars =
    first.system.length + first.messages.reduce((n, m) => n + m.content.length, 0);
  if (promptChars > maxPromptChars) return fail("input_too_large", ZERO, 0);

  let usage = ZERO;
  let prompt = first;
  let lastIssues: Issue[] = [];

  for (let attempt = 1; attempt <= 1 + RUN_LIMITS.maxRepairAttempts; attempt++) {
    const call = await callProvider(provider, prompt, maxOutputTokens, timeoutMs, input.signal);
    if (!call.ok) return fail(call.code, usage, attempt, call.aborted);
    const { response } = call;
    usage = add(usage, response);

    // The model name is stored in the database; refuse anything its format rule would refuse.
    if (!MODEL_NAME.test(String(response.model))) return fail("internal_error", usage, attempt);

    const parsed = parseModelOutput(response.text);
    let issues: Issue[];
    if (parsed.ok) {
      const checked = validateOutput(parsed.value, pack);
      if (checked.ok) {
        const warningCodes = [
          ...(pack.stats.droppedByCap > 0 || pack.stats.truncated > 0
            ? ["evidence_truncated"]
            : []),
          ...(pack.stats.redactions.emails +
            pack.stats.redactions.urls +
            pack.stats.redactions.phones >
          0
            ? ["contact_data_redacted"]
            : []),
          ...(attempt > 1 ? ["output_repaired"] : []),
        ].sort();

        return {
          ok: true,
          result: {
            ai: { provider: provider.id, model: response.model },
            input_hash: pack.inputHash,
            input_finding_count: pack.items.length,
            usage,
            warning_codes: warningCodes.slice(0, RESULT_LIMITS.maxWarningCodes),
            opportunities: checked.opportunities.map((o) => ({
              category: o.category,
              fit_level: o.fit_level,
              rationale: o.rationale,
              confidence: o.confidence,
              supporting_finding_ids: o.findingIds,
              missing_information: o.missing_information,
              uncertainty: o.uncertainty,
            })),
          },
          meta: {
            attempts: attempt === 1 ? 1 : 2,
            promptVersion: PROMPT_VERSION,
            schemaVersion: SCHEMA_VERSION,
            basedOnUnconfirmed: Object.fromEntries(
              checked.opportunities.map((o) => [o.category, o.basedOnUnconfirmed]),
            ),
            pack: pack.stats,
          },
        };
      }
      issues = checked.issues;
    } else {
      issues = parsed.issues;
    }

    lastIssues = issues;
    // The single repair request carries only fixed words about what was wrong, never model text.
    prompt = buildRepairPrompt(pack, issues);
  }

  return fail(classifyIssues(lastIssues), usage, 1 + RUN_LIMITS.maxRepairAttempts);
}
