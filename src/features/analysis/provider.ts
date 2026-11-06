/**
 * The provider boundary. The analysis core talks to a model only through this interface, so the
 * real adapter (a later step) and the mock are interchangeable, and the core can be tested without
 * a network. This file has no network code and reads no environment variables.
 */

export type PromptMessage = { role: "user" | "assistant"; content: string };

export type GenerateRequest = {
  /** Fixed instructions. Never contains evidence. */
  system: string;
  messages: readonly PromptMessage[];
  maxOutputTokens: number;
};

export type ProviderUsage = { inputTokens: number; outputTokens: number; costUsd: number };

export type GenerateResponse = {
  /** The model's raw answer. The core parses it and never returns it to a caller. */
  text: string;
  model: string;
  usage: ProviderUsage;
};

export interface AnalysisProvider {
  /** Recorded as lead_analysis_runs.provider ('gemini' later; 'mock' now). */
  readonly id: string;
  generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResponse>;
}

/**
 * Error codes a worker may report to the database (migration 010: worker_fail_analysis_run). The
 * database itself sets 'cancelled' and 'lease_expired', so they are not in this list.
 */
export const WORKER_ERROR_CODES = [
  "provider_not_configured",
  "provider_unavailable",
  "provider_rate_limited",
  "provider_timeout",
  "provider_rejected",
  "invalid_output",
  "evidence_check_failed",
  "input_too_large",
  "no_usable_findings",
  "budget_exceeded",
  "unsupported_request",
  "research_not_usable",
  "lead_not_found",
  "lead_suppressed",
  "internal_error",
] as const;
export type WorkerErrorCode = (typeof WORKER_ERROR_CODES)[number];

/** The codes a provider adapter may throw. */
export const PROVIDER_ERROR_CODES = [
  "provider_not_configured",
  "provider_unavailable",
  "provider_rate_limited",
  "provider_timeout",
  "provider_rejected",
  "budget_exceeded",
  "internal_error",
] as const satisfies readonly WorkerErrorCode[];
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export function isProviderErrorCode(value: unknown): value is ProviderErrorCode {
  return typeof value === "string" && (PROVIDER_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * What an adapter throws. Only the code is used: the message is for developers and is never
 * returned, stored or logged by the core, so a provider's raw error text cannot leak.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;

  constructor(code: ProviderErrorCode, message: string = code) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}
