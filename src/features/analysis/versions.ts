/**
 * Version labels recorded on every analysis run (lead_analysis_runs.prompt_version / schema_version)
 * and in the input hash. They must match migration 010's format rule
 * `^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$`.
 *
 * Change PROMPT_VERSION whenever the system instructions, the catalogue definitions or the evidence
 * layout change, and SCHEMA_VERSION whenever the model's JSON answer format changes. The database
 * refuses to analyze the same research twice with the same provider, model and versions, so a new
 * version is how an improved analysis of old research is requested.
 */
export const PROMPT_VERSION = "analysis-prompt-v1";
export const SCHEMA_VERSION = "analysis-schema-v1";

/** Version of the evidence pack layout; part of the input hash. */
export const PACK_VERSION = "pack-v1";

/** The format migration 010 enforces on prompt_version and schema_version. */
export const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/;
