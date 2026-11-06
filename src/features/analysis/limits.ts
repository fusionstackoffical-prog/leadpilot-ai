/**
 * Limits shared by the AI analysis core. The result limits mirror migration 010
 * (supabase/migrations/20261105000010_ai_analysis.sql); tests/analysis/migration-contract.test.ts
 * reads the migration and fails if they ever drift apart.
 */

/** What one analysis may contain (migration 010: lead_opportunities and worker_complete_analysis_run). */
export const RESULT_LIMITS = {
  /** One opportunity per category, and rank 1-6. */
  maxOpportunities: 6,
  /** lead_opportunities.supporting_finding_ids has at most 20 entries. */
  maxReferences: 20,
  /** rationale is 1-2000 characters. */
  maxRationaleChars: 2000,
  /** uncertainty is 1-1000 characters. */
  maxUncertaintyChars: 1000,
  /** missing_information has at most 10 items of 1-300 characters. */
  maxMissingItems: 10,
  maxMissingItemChars: 300,
  /** lead_analysis_runs.warning_codes has at most 20 entries. */
  maxWarningCodes: 20,
} as const;

/**
 * A calibration guard that is NOT in the database: at most this many "strong" fits per analysis.
 * "Recommend everything as a strong fit" is the signature of an injected instruction and of an
 * uncalibrated answer; a real company rarely has more than three strong fits among six categories.
 */
export const MAX_STRONG_FITS = 3;

/** How much evidence one analysis reads. Keeps prompts small, cheap and predictable. */
export const PACK_LIMITS = {
  maxItems: 120,
  /** No single topic (e.g. a site with 80 services) may crowd out the others. */
  maxPerTopic: 25,
  maxValueChars: 300,
  maxQuoteChars: 240,
  /** Total characters of values and quotes in one pack. */
  maxPackChars: 40_000,
} as const;

/** Limits of one analysis run (a call, and its single repair). */
export const RUN_LIMITS = {
  /** Larger model answers are refused outright. */
  maxOutputChars: 30_000,
  /** system + user text; above this the run fails with input_too_large instead of calling the model. */
  maxPromptChars: 60_000,
  defaultTimeoutMs: 60_000,
  defaultMaxOutputTokens: 2_000,
  /** At most one repair attempt after the first answer is rejected. */
  maxRepairAttempts: 1,
} as const;
