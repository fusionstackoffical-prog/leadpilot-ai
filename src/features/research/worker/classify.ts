import { ResearchConfigError } from "../engine/config.ts";
import { ExtractionError } from "../engine/extract/errors.ts";
import { PayloadError } from "../engine/extract/payload.ts";
import { describeFailure, ResearchFetchError } from "../engine/net/errors.ts";
import { RepositoryError, type RunFailure } from "./types.ts";

/**
 * A run that must not be researched at all (the lead is gone or suppressed, has no website, or
 * the person who asked is no longer a member). Always permanent: retrying cannot change it.
 */
export class RunRejectedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RunRejectedError";
    this.code = code;
  }
}

/**
 * Decides how a failed research run is recorded: which error code, which message and whether
 * it is worth another attempt. The message is stored on the run and shown to workspace members,
 * so it is always written here; a raw error message is never copied into it (it could contain
 * database, storage or network details). The only exceptions are the Phase 3A/3B error classes,
 * whose messages were written for operators and contain no secrets.
 */
export function classifyRunFailure(error: unknown): RunFailure {
  if (error instanceof RunRejectedError) {
    return { code: error.code, message: error.message, retryable: false };
  }
  // Extraction errors are permanent; fetch errors keep their Phase 3A classification.
  if (error instanceof ExtractionError || error instanceof ResearchFetchError) {
    const d = describeFailure(error);
    return { code: d.code, message: d.message, retryable: d.retryable };
  }
  if (error instanceof PayloadError) {
    return {
      code: "payload_invalid",
      message: "The research results could not be packaged for storage.",
      retryable: false,
    };
  }
  if (error instanceof RepositoryError) {
    switch (error.kind) {
      case "storage_rejected":
        return {
          code: "storage_rejected",
          message: "Storage refused the saved page text.",
          retryable: false,
        };
      case "storage_transient":
        return {
          code: "storage_upload_failed",
          message: "The page text could not be saved to storage; this will be retried.",
          retryable: true,
        };
      case "invalid_result":
        return {
          code: "results_rejected",
          message: "The database rejected the research results.",
          retryable: false,
        };
      case "not_found":
        return {
          code: "run_not_found",
          message: "The research run or its company no longer exists.",
          retryable: false,
        };
      case "lease_lost":
        return {
          code: "lease_lost",
          message: "This run was taken over by another worker.",
          retryable: false,
        };
      default:
        return {
          code: "database_unavailable",
          message: "The database could not be reached; this will be retried.",
          retryable: true,
        };
    }
  }
  if (error instanceof ResearchConfigError) {
    return {
      code: "research_not_configured",
      message: "Research is not configured on the server.",
      retryable: true,
    };
  }
  return {
    code: "internal_error",
    message: "An unexpected error stopped this research run.",
    retryable: true,
  };
}
