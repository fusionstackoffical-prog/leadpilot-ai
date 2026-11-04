/**
 * Failures of the extraction itself (not of fetching). Both are permanent for this run:
 * retrying the same website would hit the same limit again.
 */
export type ExtractionErrorCode = "page_unparseable" | "crawl_deadline_exceeded";

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly retryable = false;
  readonly url: string | undefined;

  constructor(
    code: ExtractionErrorCode,
    message: string,
    options: { url?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ExtractionError";
    this.code = code;
    this.url = options.url;
  }
}
