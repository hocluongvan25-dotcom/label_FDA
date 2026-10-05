import { describe, expect, it } from "vitest";
import {
  REQUIRED_ACTIVE_RULES,
  explainPipelineBlockers,
  formatAge,
  type PipelineDiagnostics,
} from "../src/lib/pipeline-status";
import type { Review, ReviewJob } from "../src/lib/types";

const now = new Date("2026-01-01T10:00:00.000Z");
const iso = (offsetSeconds: number) =>
  new Date(now.getTime() + offsetSeconds * 1000).toISOString();

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "review-1",
    organization_id: "org-1",
    product_id: "product-1",
    label_version_id: "label-1",
    review_scope: "us_federal_food_labeling_mvp",
    status: "PROCESSING",
    progress: 0,
    assigned_to: "",
    created_at: iso(-600),
    updated_at: iso(-600),
    due_at: iso(86400),
    pipeline: [],
    error_message: null,
    idempotency_key: "label-1:us-labeling-v1",
    approved_by: null,
    approved_at: null,
    approval_comment: null,
    ...overrides,
  };
}
function job(overrides: Partial<ReviewJob> = {}): ReviewJob {
  return {
    id: "job-1",
    status: "queued",
    attempts: 1,
    current_stage: "validation",
    locked_until: null,
    next_run_at: iso(-600),
    last_error: null,
    created_at: iso(-600),
    updated_at: iso(-600),
    ...overrides,
  };
}
const diagnostics = (overrides: Partial<PipelineDiagnostics> = {}) =>
  ({
    scanner_configured: true,
    rules_active: REQUIRED_ACTIVE_RULES,
    rules_total: REQUIRED_ACTIVE_RULES,
    sources_current: 12,
    worker_last_activity: null,
    queue: {
      queued: 1,
      running: 0,
      dead_letter: 0,
      oldest_queued_age_seconds: 600,
    },
    ...overrides,
  }) as PipelineDiagnostics;

const ids = (blocks: { id: string }[]) => blocks.map((b) => b.id);

describe("explainPipelineBlockers", () => {
  it("stays silent in demo mode, where the browser runs the pipeline itself", () => {
    expect(
      explainPipelineBlockers({
        review: review(),
        diagnostics: diagnostics({ scanner_configured: false }),
        mode: "demo",
        now,
      }),
    ).toEqual([]);
  });

  it("reports a queued job that no worker has ever picked up", () => {
    const blocks = explainPipelineBlockers({
      review: review({ job: job() }),
      diagnostics: diagnostics(),
      mode: "supabase",
      now,
    });
    expect(ids(blocks)).toContain("worker-missing");
    const missing = blocks.find((b) => b.id === "worker-missing")!;
    expect(missing.tone).toBe("error");
    expect(missing.detail).toMatch(/10 phút/);
    expect(missing.action).toMatch(/worker/);
  });

  it("does not complain about a job that was queued seconds ago", () => {
    const blocks = explainPipelineBlockers({
      review: review({ job: job({ updated_at: iso(-5) }) }),
      diagnostics: diagnostics({
        queue: {
          queued: 1,
          running: 0,
          dead_letter: 0,
          oldest_queued_age_seconds: 5,
        },
      }),
      mode: "supabase",
      now,
    });
    expect(ids(blocks)).not.toContain("worker-missing");
    expect(ids(blocks)).not.toContain("worker-queued");
  });

  it("distinguishes a busy worker from a missing one", () => {
    const blocks = explainPipelineBlockers({
      review: review({ job: job() }),
      diagnostics: diagnostics({ worker_last_activity: iso(-120) }),
      mode: "supabase",
      now,
    });
    expect(ids(blocks)).toContain("worker-queued");
    expect(blocks.find((b) => b.id === "worker-queued")!.detail).toMatch(
      /đang có 1 tác vụ chờ/,
    );
  });

  it("flags a lost lease when a running job stops heartbeating", () => {
    const blocks = explainPipelineBlockers({
      review: review({
        job: job({ status: "running", locked_until: iso(-30) }),
      }),
      diagnostics: diagnostics(),
      mode: "supabase",
      now,
    });
    expect(ids(blocks)).toContain("lease-expired");
    expect(blocks.find((b) => b.id === "lease-expired")!.tone).toBe("warning");
  });

  it("surfaces the worker's own error message on retry and dead-letter", () => {
    const message = "Malware scanner chưa được cấu hình.";
    const retry = explainPipelineBlockers({
      review: review({
        job: job({ status: "retry", attempts: 2, last_error: message }),
      }),
      diagnostics: diagnostics({ scanner_configured: false }),
      mode: "supabase",
      now,
    });
    expect(ids(retry)).toContain("job-failed");
    expect(retry.find((b) => b.id === "job-failed")!.detail).toContain(message);
    // The scanner is already explained by the error itself; no duplicate card.
    expect(ids(retry)).not.toContain("scanner-missing");

    const dead = explainPipelineBlockers({
      review: review({
        job: job({ status: "dead_letter", last_error: message }),
      }),
      diagnostics: diagnostics(),
      mode: "supabase",
      now,
    });
    expect(ids(dead)).toContain("dead-letter");
  });

  it("warns about a missing scanner before the first failure", () => {
    const blocks = explainPipelineBlockers({
      review: review({ job: job({ updated_at: iso(-5) }) }),
      diagnostics: diagnostics({
        scanner_configured: false,
        queue: {
          queued: 1,
          running: 0,
          dead_letter: 0,
          oldest_queued_age_seconds: 5,
        },
      }),
      mode: "supabase",
      now,
    });
    expect(ids(blocks)).toContain("scanner-missing");
    expect(blocks.find((b) => b.id === "scanner-missing")!.action).toMatch(
      /CLAMAV_HOST/,
    );
  });

  it("explains the inactive rule set while the review is open", () => {
    const blocks = explainPipelineBlockers({
      review: review({ job: job({ updated_at: iso(-5) }) }),
      diagnostics: diagnostics({ rules_active: 0, rules_total: 15 }),
      mode: "supabase",
      now,
    });
    const rules = blocks.find((b) => b.id === "rules-inactive")!;
    expect(rules.title).toContain("0/15");
    expect(rules.detail).toMatch(/không được trả kết luận/);
  });

  it("does not nag about rules once the review is final", () => {
    expect(
      ids(
        explainPipelineBlockers({
          review: review({ status: "COMPLETED", job: null }),
          diagnostics: diagnostics({ rules_active: 0 }),
          mode: "supabase",
          now,
        }),
      ),
    ).toEqual([]);
  });

  it("hides rule counts from customers, who cannot read the registry", () => {
    expect(
      ids(
        explainPipelineBlockers({
          review: review({ job: job({ updated_at: iso(-5) }) }),
          diagnostics: diagnostics({ rules_active: 0, rules_total: 0 }),
          rulesVisible: false,
          mode: "supabase",
          now,
        }),
      ),
    ).toEqual([]);
  });

  it("explains a failed pipeline-owned status, not only PROCESSING", () => {
    const blocks = explainPipelineBlockers({
      review: review({
        status: "PROCESSING_FAILED",
        job: job({ status: "retry", attempts: 3, last_error: "OCR timeout." }),
      }),
      diagnostics: diagnostics(),
      mode: "supabase",
      now,
    });
    expect(ids(blocks)).toContain("job-failed");
  });

  it("reports a PROCESSING review without a queue row", () => {
    const blocks = explainPipelineBlockers({
      review: review({ job: null }),
      diagnostics: diagnostics(),
      mode: "supabase",
      now,
    });
    expect(ids(blocks)).toContain("no-job");
  });
});

describe("formatAge", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatAge(45)).toBe("45 giây");
    expect(formatAge(120)).toBe("2 phút");
    expect(formatAge(3900)).toBe("1 giờ 5 phút");
  });
});
