import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResearchConfigError } from "../../src/features/research/engine/config.ts";
import { ExtractionError } from "../../src/features/research/engine/extract/errors.ts";
import { PayloadError } from "../../src/features/research/engine/extract/payload.ts";
import {
  describeFailure,
  ResearchFetchError,
  statusError,
} from "../../src/features/research/engine/net/errors.ts";
import {
  classifyRunFailure,
  RunRejectedError,
} from "../../src/features/research/worker/classify.ts";
import {
  RepositoryError,
  type RepositoryErrorKind,
} from "../../src/features/research/worker/types.ts";

describe("classifyRunFailure", () => {
  it("keeps the Phase 3A classification of fetch errors", () => {
    const cases = [
      statusError(503, "https://acme-co.com/", "30", 0),
      new ResearchFetchError("dns_not_found", "The domain acme-co.com does not exist"),
      new ResearchFetchError("outside_boundary", "acme.com redirects to other.com"),
      new ResearchFetchError("robots_disallowed", "robots.txt does not allow this"),
      new ResearchFetchError("blocked_address", "This address is not allowed"),
    ];
    for (const error of cases) {
      const d = describeFailure(error);
      assert.deepEqual(classifyRunFailure(error), {
        code: d.code,
        message: d.message,
        retryable: d.retryable,
      });
    }
    assert.equal(classifyRunFailure(cases[0]).retryable, true);
    assert.equal(classifyRunFailure(cases[2]).retryable, false);
  });

  it("treats extraction failures as permanent", () => {
    for (const code of ["page_unparseable", "crawl_deadline_exceeded"] as const) {
      assert.deepEqual(classifyRunFailure(new ExtractionError(code, "message")), {
        code,
        message: "message",
        retryable: false,
      });
    }
  });

  it("treats results that cannot be packaged as permanent, with a fixed message", () => {
    const f = classifyRunFailure(new PayloadError("Evidence text for https://x/ is too large"));
    assert.equal(f.code, "payload_invalid");
    assert.equal(f.retryable, false);
    assert.doesNotMatch(f.message, /https:\/\/x/);
  });

  it("classifies repository failures by kind", () => {
    const expected: Record<RepositoryErrorKind, [string, boolean]> = {
      storage_rejected: ["storage_rejected", false],
      storage_transient: ["storage_upload_failed", true],
      invalid_result: ["results_rejected", false],
      not_found: ["run_not_found", false],
      lease_lost: ["lease_lost", false],
      transient: ["database_unavailable", true],
    };
    for (const [kind, [code, retryable]] of Object.entries(expected)) {
      const f = classifyRunFailure(new RepositoryError(kind as RepositoryErrorKind, "internal"));
      assert.equal(f.code, code, kind);
      assert.equal(f.retryable, retryable, kind);
    }
  });

  it("rejects runs that must not be researched, permanently, with their own message", () => {
    assert.deepEqual(classifyRunFailure(new RunRejectedError("no_website", "No website.")), {
      code: "no_website",
      message: "No website.",
      retryable: false,
    });
  });

  it("treats an unexpected error as retryable and never repeats its message", () => {
    const secret = "postgres://user:hunter2@internal-db/prod";
    for (const error of [
      new Error(secret),
      new TypeError(secret),
      secret,
      { message: secret },
      null,
    ]) {
      const f = classifyRunFailure(error);
      assert.deepEqual(f, {
        code: "internal_error",
        message: "An unexpected error stopped this research run.",
        retryable: true,
      });
    }
  });

  it("never leaks repository messages into the stored failure", () => {
    for (const kind of [
      "transient",
      "lease_lost",
      "not_found",
      "invalid_result",
      "storage_rejected",
      "storage_transient",
    ] as const) {
      const f = classifyRunFailure(new RepositoryError(kind, 'relation "research_runs" hunter2'));
      assert.doesNotMatch(f.message, /relation|research_runs|hunter2/);
    }
  });

  it("maps a missing research configuration without exposing its details", () => {
    const f = classifyRunFailure(new ResearchConfigError("RESEARCH_BOT_CONTACT_URL is not set"));
    assert.equal(f.code, "research_not_configured");
    assert.doesNotMatch(f.message, /RESEARCH_BOT/);
  });

  it("always fits the database column limits", () => {
    const errors = [
      new Error("x"),
      new RepositoryError("transient", "x"),
      new RunRejectedError("lead_not_found", "x"),
      new ExtractionError("page_unparseable", "x"),
      new PayloadError("x"),
    ];
    for (const e of errors) {
      const f = classifyRunFailure(e);
      assert.ok(f.code.length >= 1 && f.code.length <= 100);
      assert.ok(f.message.length >= 1 && f.message.length <= 2000);
    }
  });
});
