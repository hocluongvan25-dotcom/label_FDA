import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GuidanceReviewSummary, RegulatorySource } from "../src/lib/types";
import {
  guidanceApprovalBlockers,
  guidanceChecklistKeys,
  guidanceChecklistLabels,
  guidanceReviewInputSchema,
  guidanceReviewIsFresh,
  isGuidanceDocument,
  missingGuidanceChecklist,
  translateGuidanceError,
} from "../src/lib/regulatory-guidance";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/0004_guidance_expert_review.sql",
);

function source(
  overrides: Partial<RegulatorySource> = {},
): RegulatorySource & { expert_review?: GuidanceReviewSummary | null } {
  return {
    id: "b0000000-0000-4000-8000-000000000001",
    source_key: "fda-label-claims",
    authority: "FDA",
    agency: "FDA",
    document_type: "guidance",
    citation: "FDA Label Claims Guidance v2",
    title: "Guidance for Industry: Label Claims",
    canonical_url: "https://www.fda.gov/guidance",
    topic: "claims",
    status: "DRAFT",
    priority: 4,
    retrieved_at: "2026-10-05T00:00:00.000Z",
    effective_from: null,
    effective_to: null,
    content_hash: "0".repeat(64),
    content_excerpt: "a".repeat(120),
    approved_by: null,
    approved_at: null,
    version: 1,
    updated_at: "2026-10-05T00:00:00.000Z",
    raw_snapshot_id: null,
    ...overrides,
  };
}

function checklist(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...Object.fromEntries(guidanceChecklistKeys.map((k) => [k, "true"])),
    ...extra,
  };
}

function review(
  overrides: Partial<GuidanceReviewSummary> = {},
): GuidanceReviewSummary {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    source_id: "b0000000-0000-4000-8000-000000000001",
    reviewer: "c71d1b04-4793-4a3a-b823-4b55f963dc4b",
    guidance_status: "final",
    binding_effect: "non_binding",
    scope_note: "Áp dụng cho claim trên nhãn thực phẩm đóng gói sẵn.",
    checklist: checklist(),
    source_version: 1,
    content_hash: "0".repeat(64),
    created_at: "2026-10-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("guidance document detection", () => {
  it("treats guidance/guideline documents as guidance", () => {
    expect(isGuidanceDocument("guidance")).toBe(true);
    expect(isGuidanceDocument("FDA Guidance")).toBe(true);
    expect(isGuidanceDocument("Guidance for Industry")).toBe(true);
    expect(isGuidanceDocument("guideline")).toBe(true);
  });
  it("leaves regulations on the normal workflow", () => {
    expect(isGuidanceDocument("regulation")).toBe(false);
    expect(isGuidanceDocument("21 CFR 101.13")).toBe(false);
    expect(isGuidanceDocument(null)).toBe(false);
  });
});

describe("guidance expert-review input", () => {
  it("accepts a complete attestation", () => {
    const parsed = guidanceReviewInputSchema.safeParse({
      checklist: checklist(),
      guidance_status: "final",
      binding_effect: "non_binding",
      scope_note: "Áp dụng cho claim dinh dưỡng trên nhãn thực phẩm đóng gói.",
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects a short scope note", () => {
    const parsed = guidanceReviewInputSchema.safeParse({
      checklist: checklist(),
      guidance_status: "final",
      binding_effect: "non_binding",
      scope_note: "quá ngắn",
    });
    expect(parsed.success).toBe(false);
  });
  it("names every missing checklist item", () => {
    const parsed = guidanceReviewInputSchema.safeParse({
      checklist: { document_identity: "true" },
      guidance_status: "final",
      binding_effect: "non_binding",
      scope_note: "Áp dụng cho claim dinh dưỡng trên nhãn thực phẩm đóng gói.",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join("."));
      expect(missing).toContain("checklist.official_url");
      expect(missing).toContain("checklist.affected_rules");
      expect(parsed.error.issues.length).toBe(guidanceChecklistKeys.length - 1);
    }
    expect(missingGuidanceChecklist({ document_identity: "true" }).length).toBe(
      guidanceChecklistKeys.length - 1,
    );
  });
  it("requires an explicit acknowledgement for draft guidance", () => {
    const base = {
      checklist: checklist(),
      binding_effect: "non_binding",
      scope_note: "Áp dụng cho claim dinh dưỡng trên nhãn thực phẩm đóng gói.",
      guidance_status: "draft",
    } as const;
    expect(guidanceReviewInputSchema.safeParse(base).success).toBe(false);
    expect(
      guidanceReviewInputSchema.safeParse({
        ...base,
        checklist: checklist({ draft_guidance_ack: "true" }),
      }).success,
    ).toBe(true);
  });
});

describe("approval blockers for FDA guidance", () => {
  it("does not apply to regulations", () => {
    expect(
      guidanceApprovalBlockers({
        source: source({ document_type: "regulation" }),
        actorId: "admin-b",
        affectedRules: 3,
        regressionFresh: false,
      }),
    ).toEqual([]);
  });
  it("blocks when no expert review exists", () => {
    const blockers = guidanceApprovalBlockers({
      source: source(),
      actorId: "admin-b",
      affectedRules: 0,
      regressionFresh: false,
    });
    expect(blockers.length).toBe(1);
    expect(blockers[0]).toContain("đánh giá chuyên gia");
  });
  it("blocks a stale review (content changed after the review)", () => {
    const blockers = guidanceApprovalBlockers({
      source: source({
        version: 2,
        content_hash: "1".repeat(64),
        expert_review: review(),
      }),
      actorId: "admin-b",
      affectedRules: 0,
      regressionFresh: false,
    });
    expect(blockers[0]).toContain("đã cũ");
  });
  it("blocks self-approval by the expert reviewer", () => {
    const blockers = guidanceApprovalBlockers({
      source: source({ expert_review: review() }),
      actorId: "c71d1b04-4793-4a3a-b823-4b55f963dc4b",
      affectedRules: 0,
      regressionFresh: false,
    });
    expect(blockers[0]).toContain("Regulatory Admin khác");
  });
  it("blocks withdrawn or superseded guidance", () => {
    for (const status of ["withdrawn", "superseded"])
      expect(
        guidanceApprovalBlockers({
          source: source({ expert_review: review({ guidance_status: status }) }),
          actorId: "admin-b",
          affectedRules: 0,
          regressionFresh: false,
        })[0],
      ).toContain("thu hồi");
  });
  it("blocks draft guidance without the non-binding acknowledgement", () => {
    expect(
      guidanceApprovalBlockers({
        source: source({
          expert_review: review({
            guidance_status: "draft",
            checklist: checklist(),
          }),
        }),
        actorId: "admin-b",
        affectedRules: 0,
        regressionFresh: false,
      })[0],
    ).toContain("Draft guidance");
  });
  it("refuses to treat FDA guidance as legally binding", () => {
    expect(
      guidanceApprovalBlockers({
        source: source({
          expert_review: review({ binding_effect: "binding" }),
        }),
        actorId: "admin-b",
        affectedRules: 0,
        regressionFresh: false,
      })[0],
    ).toContain("không ràng buộc");
  });
  it("requires a fresh regression when active rules cite the source", () => {
    expect(
      guidanceApprovalBlockers({
        source: source({ expert_review: review() }),
        actorId: "admin-b",
        affectedRules: 2,
        regressionFresh: false,
      })[0],
    ).toContain("regression");
    expect(
      guidanceApprovalBlockers({
        source: source({ expert_review: review() }),
        actorId: "admin-b",
        affectedRules: 2,
        regressionFresh: true,
      }),
    ).toEqual([]);
  });
  it("lets a second admin approve a fully reviewed guidance document", () => {
    expect(
      guidanceApprovalBlockers({
        source: source({ expert_review: review() }),
        actorId: "admin-b",
        affectedRules: 0,
        regressionFresh: false,
      }),
    ).toEqual([]);
  });
  it("routes API snapshot sources to the ingestion workflow", () => {
    expect(
      guidanceApprovalBlockers({
        source: source({ raw_snapshot_id: "d".repeat(36) }),
        actorId: "admin-b",
        affectedRules: 0,
        regressionFresh: false,
      })[0],
    ).toContain("Kho tri thức pháp quy");
  });
});

describe("guidance review freshness", () => {
  it("only accepts a review of the current version and hash", () => {
    expect(guidanceReviewIsFresh(source(), review())).toBe(true);
    expect(guidanceReviewIsFresh(source(), null)).toBe(false);
    expect(
      guidanceReviewIsFresh(source(), review({ source_version: 2 })),
    ).toBe(false);
    expect(
      guidanceReviewIsFresh(source(), review({ content_hash: "f".repeat(64) })),
    ).toBe(false);
  });
});

describe("server error translation", () => {
  it("explains the SQL guards in Vietnamese", () => {
    expect(translateGuidanceError("FDA guidance requires an expert review record before approval")).toContain(
      "đánh giá chuyên gia",
    );
    expect(
      translateGuidanceError("A second Regulatory Admin, not the expert reviewer, must approve this guidance"),
    ).toContain("không được tự phê duyệt");
    expect(translateGuidanceError("Something else entirely")).toBe(
      "Something else entirely",
    );
  });
});

describe("migration 0004 stays in sync with the client checklist", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  it("enforces exactly the client checklist keys", () => {
    for (const key of guidanceChecklistKeys) expect(sql).toContain(key);
    // The SQL array lists the required keys in one place.
    const array = /unnest\(array\[([^\]]+)\]\)\s*k\s*where\s*checklist->>k/.exec(
      sql,
    );
    expect(array).not.toBeNull();
    const keys = (array?.[1] ?? "")
      .split(",")
      .map((k) => k.trim().replaceAll("'", ""));
    expect(keys.sort()).toEqual([...guidanceChecklistKeys].sort());
  });
  it("labels every checklist key in Vietnamese", () => {
    for (const key of guidanceChecklistKeys)
      expect(guidanceChecklistLabels[key].length).toBeGreaterThan(10);
  });
  it("keeps approval independent and refuses binding guidance", () => {
    expect(sql).toContain("vexim_review_guidance_source");
    expect(sql).toContain("vexim_record_guidance_regression");
    expect(sql).toContain("not the expert reviewer, must approve this guidance");
    expect(sql).toContain("record it as non-binding");
    expect(sql).toContain("app_legacy_approve_source(sid)");
  });
});
