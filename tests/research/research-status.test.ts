// Research status logic: run and company statuses, the lead_research_summary view's quirks,
// retry guidance, and the readable result of every database function outcome and error.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPANY_STATUS,
  deriveCompanyState,
  describeCancelError,
  describeCancelResult,
  describeCompanyState,
  describeRequestError,
  describeRequestOutcome,
  describeRun,
  isActiveStatus,
  isRunStatus,
  isSuccessfulStatus,
  NOT_RESEARCHED,
  POLL_INTERVAL_MS,
  RUN_STATUS,
  RUN_STATUSES,
  shouldPoll,
  type CompanyStatus,
  type SummaryRow,
} from "../../src/features/research/status.ts";
import type { FetchErrorCode } from "../../src/features/research/engine/net/errors.ts";
import { ExtractionError } from "../../src/features/research/engine/extract/errors.ts";
import { PayloadError } from "../../src/features/research/engine/extract/payload.ts";
import {
  classifyRunFailure,
  RunRejectedError,
} from "../../src/features/research/worker/classify.ts";
import { RepositoryError } from "../../src/features/research/worker/types.ts";

const RUN = "11111111-1111-4111-8111-111111111111";
const OLD = "22222222-2222-4222-8222-222222222222";
const T = "2026-11-04T10:00:00.000Z";

const row = (over: Partial<SummaryRow> = {}): SummaryRow => ({
  active_run_id: null,
  active_run_status: null,
  last_finished_run_id: null,
  last_finished_status: null,
  last_researched_at: null,
  last_successful_run_id: null,
  ...over,
});

describe("run statuses", () => {
  it("has a label and tone for each of the six database statuses", () => {
    assert.deepEqual(
      [...RUN_STATUSES],
      ["queued", "running", "completed", "completed_with_warnings", "failed", "cancelled"],
    );
    assert.deepEqual(
      RUN_STATUSES.map((s) => RUN_STATUS[s].label),
      ["Queued", "Running", "Completed", "Completed with warnings", "Failed", "Cancelled"],
    );
    for (const status of RUN_STATUSES) assert.ok(RUN_STATUS[status].tone, status);
    // Failure and success must never share a tone.
    assert.notEqual(RUN_STATUS.failed.tone, RUN_STATUS.completed.tone);
  });

  it("classifies active, successful and valid statuses", () => {
    assert.deepEqual(RUN_STATUSES.filter(isActiveStatus), ["queued", "running"]);
    assert.deepEqual(RUN_STATUSES.filter(isSuccessfulStatus), [
      "completed",
      "completed_with_warnings",
    ]);
    for (const status of RUN_STATUSES) assert.equal(isRunStatus(status), true);
    for (const bad of ["", "done", "QUEUED", null, undefined, 3, {}])
      assert.equal(isRunStatus(bad), false);
    assert.equal(isActiveStatus(null), false);
    assert.equal(isSuccessfulStatus(undefined), false);
  });

  it("has a label for every company status, including Cancelled", () => {
    const expected: Record<CompanyStatus, string> = {
      not_researched: "Not researched",
      queued: "Queued",
      running: "Running",
      researched: "Researched",
      researched_with_warnings: "Researched with warnings",
      failed: "Failed",
      cancelled: "Cancelled",
    };
    for (const [status, label] of Object.entries(expected)) {
      assert.equal(COMPANY_STATUS[status as CompanyStatus].label, label);
    }
  });
});

describe("polling rule", () => {
  it("polls every 8 seconds, only while a run is active and the tab is visible", () => {
    assert.equal(POLL_INTERVAL_MS, 8_000);
    assert.equal(shouldPoll(true, "visible"), true);
    assert.equal(shouldPoll(true, "hidden"), false);
    assert.equal(shouldPoll(true, "prerender"), false);
    assert.equal(shouldPoll(false, "visible"), false);
    assert.equal(shouldPoll(false, "hidden"), false);
  });
});

describe("deriveCompanyState", () => {
  it("is 'not researched' with no summary row, or an empty one", () => {
    for (const input of [null, undefined, row()]) {
      assert.deepEqual(deriveCompanyState(input), NOT_RESEARCHED);
    }
  });

  it("shows a queued or running run as the headline, with the run id", () => {
    for (const status of ["queued", "running"] as const) {
      const s = deriveCompanyState(row({ active_run_id: RUN, active_run_status: status }));
      assert.equal(s.status, status);
      assert.equal(s.active, true);
      assert.equal(s.activeRunId, RUN);
      assert.equal(s.hasEarlierResult, false);
    }
  });

  it("keeps earlier results available while new research is active", () => {
    const s = deriveCompanyState(
      row({
        active_run_id: RUN,
        active_run_status: "running",
        last_finished_run_id: OLD,
        last_finished_status: "completed",
        last_successful_run_id: OLD,
        last_researched_at: T,
      }),
    );
    assert.equal(s.status, "running");
    assert.equal(s.hasEarlierResult, true);
    assert.equal(s.lastResearchedAt, T);
    assert.equal(s.lastSuccessfulRunId, OLD);
  });

  it("maps a finished run to Researched / Researched with warnings", () => {
    const ok = deriveCompanyState(
      row({
        last_finished_run_id: RUN,
        last_finished_status: "completed",
        last_successful_run_id: RUN,
        last_researched_at: T,
      }),
    );
    assert.equal(ok.status, "researched");
    assert.equal(ok.active, false);
    assert.equal(ok.lastResearchedAt, T);
    const warn = deriveCompanyState(
      row({
        last_finished_run_id: RUN,
        last_finished_status: "completed_with_warnings",
        last_successful_run_id: RUN,
        last_researched_at: T,
      }),
    );
    assert.equal(warn.status, "researched_with_warnings");
  });

  it("a failed latest run with no earlier success is simply failed", () => {
    const s = deriveCompanyState(
      row({ last_finished_run_id: RUN, last_finished_status: "failed" }),
    );
    assert.equal(s.status, "failed");
    assert.equal(s.hasEarlierResult, false);
    assert.equal(s.lastResearchedAt, null);
    assert.equal(s.lastSuccessfulRunId, null);
  });

  it("a failed latest run does NOT hide an older successful result", () => {
    // What the view returns: research_status says "failed" although a successful run exists.
    const s = deriveCompanyState(
      row({
        research_status: "failed",
        last_finished_run_id: RUN,
        last_finished_status: "failed",
        last_successful_run_id: OLD,
        last_researched_at: T,
      }),
    );
    assert.equal(s.status, "failed");
    assert.equal(s.hasEarlierResult, true);
    assert.equal(s.lastSuccessfulRunId, OLD);
    assert.equal(s.lastResearchedAt, T, "the last SUCCESSFUL research time is kept");
    assert.equal(s.latestFinishedRunId, RUN);
    assert.equal(s.latestFinishedStatus, "failed");
  });

  it("derives Cancelled from last_finished_status, which the view's own status never reports", () => {
    const none = deriveCompanyState(
      row({ last_finished_run_id: RUN, last_finished_status: "cancelled" }),
    );
    assert.equal(none.status, "cancelled");
    assert.equal(none.hasEarlierResult, false);

    // With an older success the view says "researched"; the headline must still say cancelled.
    const withEarlier = deriveCompanyState(
      row({
        research_status: "researched",
        last_finished_run_id: RUN,
        last_finished_status: "cancelled",
        last_successful_run_id: OLD,
        last_researched_at: T,
      }),
    );
    assert.equal(withEarlier.status, "cancelled");
    assert.equal(withEarlier.hasEarlierResult, true);
    assert.equal(withEarlier.lastResearchedAt, T);
  });

  it("active work beats a failed or cancelled earlier attempt", () => {
    for (const finished of ["failed", "cancelled"]) {
      const s = deriveCompanyState(
        row({ active_run_id: RUN, active_run_status: "queued", last_finished_status: finished }),
      );
      assert.equal(s.status, "queued");
      assert.equal(s.latestFinishedStatus, finished);
    }
  });

  it("ignores unknown statuses instead of guessing, and the view's own research_status", () => {
    assert.equal(
      deriveCompanyState(row({ last_finished_status: "weird" })).status,
      "not_researched",
    );
    assert.equal(deriveCompanyState(row({ active_run_status: "weird" })).status, "not_researched");
    assert.equal(
      deriveCompanyState(row({ research_status: "researched" })).status,
      "not_researched",
    );
  });
});

describe("describeCompanyState", () => {
  const states: CompanyStatus[] = [
    "not_researched",
    "queued",
    "running",
    "researched",
    "researched_with_warnings",
    "failed",
    "cancelled",
  ];

  it("gives every status a headline and a plain-language detail", () => {
    for (const status of states) {
      const d = describeCompanyState({ ...NOT_RESEARCHED, status });
      assert.ok(d.headline.length > 0 && d.detail.length > 0, status);
      assert.doesNotMatch(d.headline + d.detail, /undefined|null|\[object/);
    }
  });

  it("is honest that the worker is started manually while queued", () => {
    assert.match(describeCompanyState({ ...NOT_RESEARCHED, status: "queued" }).detail, /manually/);
  });

  it("says earlier results remain when the latest attempt failed or was cancelled", () => {
    for (const status of ["failed", "cancelled"] as const) {
      const without = describeCompanyState({ ...NOT_RESEARCHED, status });
      const withEarlier = describeCompanyState({
        ...NOT_RESEARCHED,
        status,
        hasEarlierResult: true,
      });
      assert.match(withEarlier.detail, /still shown/);
      assert.doesNotMatch(without.detail, /still shown/);
    }
  });

  it("never claims research happened when none has", () => {
    assert.match(
      describeCompanyState(NOT_RESEARCHED).detail,
      /Nothing has been looked up or inferred/,
    );
  });
});

describe("describeRun and retry guidance", () => {
  const failed = (error_code: string | null, attempts = 1, max_attempts = 3) =>
    describeRun({ status: "failed", attempts, max_attempts, error_code });

  it("describes every status", () => {
    const base = { attempts: 0, max_attempts: 3, error_code: null };
    const labels = RUN_STATUSES.map((status) => describeRun({ ...base, status }).label);
    assert.deepEqual(
      labels,
      RUN_STATUSES.map((s) => RUN_STATUS[s].label),
    );
  });

  it("a queued run waiting for its first attempt has no retry; after a failed attempt a retry is automatic", () => {
    const first = describeRun({ status: "queued", attempts: 0, max_attempts: 3, error_code: null });
    assert.equal(first.retry, null);
    const again = describeRun({
      status: "queued",
      attempts: 1,
      max_attempts: 3,
      error_code: "http_status",
    });
    assert.deepEqual(again.retry, {
      permitted: false,
      automatic: true,
      text: "A retry is scheduled automatically.",
    });
    assert.match(again.detail ?? "", /attempt 1 of 3/);
  });

  it("a running run shows its attempt number and offers no retry", () => {
    const d = describeRun({ status: "running", attempts: 2, max_attempts: 3, error_code: null });
    assert.match(d.detail ?? "", /attempt 2 of 3/);
    assert.equal(d.retry, null);
  });

  it("completed runs need no retry; a warned run says so", () => {
    assert.equal(
      describeRun({ status: "completed", attempts: 1, max_attempts: 3, error_code: null }).retry,
      null,
    );
    const w = describeRun({
      status: "completed_with_warnings",
      attempts: 1,
      max_attempts: 3,
      error_code: null,
    });
    assert.match(w.detail ?? "", /warnings/);
    assert.equal(w.retry, null);
  });

  it("a cancelled run can simply be started again", () => {
    const d = describeRun({
      status: "cancelled",
      attempts: 1,
      max_attempts: 3,
      error_code: "cancelled",
    });
    assert.equal(d.retry?.permitted, true);
    assert.equal(d.retry?.automatic, false);
  });

  it("does NOT permit a retry while the company's own data is the problem", () => {
    for (const code of ["no_website", "invalid_url", "lead_suppressed", "lead_not_found"]) {
      const d = failed(code);
      assert.equal(d.retry?.permitted, false, code);
      assert.match(d.retry?.text ?? "", /isn't permitted until this is fixed/);
    }
  });

  it("permits a retry after temporary problems, and says it may succeed", () => {
    for (const code of [
      "http_status",
      "timeout",
      "connection_failed",
      "dns_temporary",
      "database_unavailable",
      "internal_error",
      "lease_expired",
    ]) {
      const d = failed(code);
      assert.equal(d.retry?.permitted, true, code);
      assert.match(d.retry?.text ?? "", /may succeed/);
    }
  });

  it("permits a retry after a website problem but warns it is unlikely to help", () => {
    for (const code of [
      "robots_disallowed",
      "dns_not_found",
      "outside_boundary",
      "blocked_address",
      "page_unparseable",
    ]) {
      const d = failed(code);
      assert.equal(d.retry?.permitted, true, code);
      assert.match(d.retry?.text ?? "", /unlikely to help/);
    }
  });

  it("handles a missing or unknown error code without inventing a reason", () => {
    for (const code of [null, "something_new", ""]) {
      const d = failed(code);
      assert.equal(d.retry?.permitted, true);
      assert.match(d.detail ?? "", /^The run didn't finish./);
    }
  });

  it("notes when all attempts were used", () => {
    assert.match(failed("timeout", 3, 3).detail ?? "", /attempt 3 of 3 used/);
    assert.doesNotMatch(failed("timeout", 1, 3).detail ?? "", /used/);
  });

  it("treats an unrecognised stored status as failed rather than crashing", () => {
    assert.equal(
      describeRun({ status: "mystery", attempts: 0, max_attempts: 3, error_code: null }).label,
      "Failed",
    );
  });

  it("explains every code the fetcher can produce (except cancel, which is not a failure)", () => {
    // Record<FetchErrorCode, true> fails to compile if the fetcher gains a code not listed here.
    const all: Record<FetchErrorCode, true> = {
      invalid_url: true,
      blocked_address: true,
      dns_not_found: true,
      dns_temporary: true,
      connect_timeout: true,
      timeout: true,
      connection_failed: true,
      tls_error: true,
      too_many_redirects: true,
      redirect_blocked: true,
      outside_boundary: true,
      robots_disallowed: true,
      robots_unavailable: true,
      http_status: true,
      unsupported_content_type: true,
      response_too_large: true,
      decode_error: true,
      cancelled: true,
    };
    for (const code of Object.keys(all).filter((c) => c !== "cancelled")) {
      assert.doesNotMatch(
        failed(code).detail ?? "",
        /^The run didn't finish./,
        `${code} has no guidance`,
      );
    }
  });

  it("explains every code the worker itself records", () => {
    const errors: unknown[] = [
      new RunRejectedError("lead_not_found", "x"),
      new RunRejectedError("lead_suppressed", "x"),
      new RunRejectedError("no_website", "x"),
      new RunRejectedError("requester_not_authorized", "x"),
      new ExtractionError("page_unparseable", "x"),
      new ExtractionError("crawl_deadline_exceeded", "x"),
      new PayloadError("x"),
      new Error("anything"),
      ...(
        [
          "storage_rejected",
          "storage_transient",
          "invalid_result",
          "not_found",
          "lease_lost",
          "transient",
        ] as const
      ).map((kind) => new RepositoryError(kind, "x")),
    ];
    for (const error of errors) {
      const { code } = classifyRunFailure(error);
      assert.doesNotMatch(
        failed(code).detail ?? "",
        /^The run didn't finish./,
        `${code} has no guidance`,
      );
    }
    // Codes the database writes itself.
    assert.doesNotMatch(failed("lease_expired").detail ?? "", /^The run didn't finish./);
  });
});

describe("request_lead_research outcomes", () => {
  it("queued is a success that says research starts when the worker is run", () => {
    const r = describeRequestOutcome("queued");
    assert.equal(r.status, "success");
    assert.match(r.message, /worker/);
  });

  it("duplicate and already-active requests are informational, not errors", () => {
    assert.equal(describeRequestOutcome("duplicate_request").status, "info");
    assert.match(describeRequestOutcome("duplicate_request").message, /Reload the page/);
    assert.equal(describeRequestOutcome("already_active").status, "info");
    assert.match(describeRequestOutcome("already_active").message, /already queued or running/);
  });

  it("not_found and limit_reached are errors with a clear reason", () => {
    const nf = describeRequestOutcome("not_found");
    assert.equal(nf.status, "error");
    assert.match(nf.message, /suppressed/);
    const lim = describeRequestOutcome("limit_reached");
    assert.equal(lim.status, "error");
    assert.match(lim.message, /200 active runs/);
    assert.match(lim.message, /300 new runs in 24 hours/);
  });

  it("an unknown or missing outcome is a generic error, never a success", () => {
    for (const outcome of ["surprise", "", null, undefined]) {
      const r = describeRequestOutcome(outcome);
      assert.equal(r.status, "error");
      assert.match(r.message, /couldn't be started/);
    }
  });

  it("maps database errors by code without exposing details", () => {
    assert.match(describeRequestError("42501").message, /permission/);
    assert.match(describeRequestError("22023").message, /Reload the page/);
    for (const code of ["XX000", "", null, undefined, "23505"]) {
      assert.equal(describeRequestError(code).status, "error");
      assert.match(describeRequestError(code).message, /couldn't be started/);
    }
  });
});

describe("cancel_research_run results", () => {
  it("cancelled and cancel_requested are successes", () => {
    assert.deepEqual(describeCancelResult("cancelled"), {
      status: "success",
      message: "Research cancelled.",
    });
    const r = describeCancelResult("cancel_requested");
    assert.equal(r.status, "success");
    assert.match(r.message, /next checkpoint/);
  });

  it("an already-finished run is reported as such, not as an error", () => {
    for (const status of ["completed", "completed_with_warnings", "failed"]) {
      const r = describeCancelResult(status);
      assert.equal(r.status, "info", status);
      assert.match(r.message, /already finished/);
    }
  });

  it("an active or unknown answer is not trusted as confirmation", () => {
    for (const result of ["queued", "running", "weird", "", null, undefined]) {
      assert.equal(describeCancelResult(result).status, "error", String(result));
    }
  });

  it("maps database errors: permission, not found, generic", () => {
    assert.match(
      describeCancelError("42501").message,
      /requested this research, or a workspace owner or admin/,
    );
    assert.match(describeCancelError("P0002").message, /wasn't found/);
    for (const code of ["XX000", "", null, undefined]) {
      assert.equal(describeCancelError(code).status, "error");
      assert.match(describeCancelError(code).message, /couldn't be cancelled/);
    }
  });
});
