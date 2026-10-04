import { describe, expect, it } from "vitest";
import { createSeedData, refreshDraftOnlyDemoFixture } from "../src/lib/seed";
import { approvalIssues } from "../src/lib/reports";
import {
  DEMO_REVIEW_CASE_REFERENCE,
  DEMO_REVIEW_ID,
  isSyntheticDemoReview,
} from "../src/lib/demo-review";
import type { AppData } from "../src/lib/types";

const RULE_KEYS = [
  "IDENTITY-001",
  "NETQTY-001",
  "INGREDIENT-001",
  "NUTRITION-001",
  "NUTRITION-002",
  "ALLERGEN-001",
  "ALLERGEN-002",
  "CLAIM-001",
  "CLAIM-002",
  "CLAIM-003",
  "FORMULA-001",
  "LABEL-001",
  "LABEL-002",
  "PARTY-001",
  "CLASS-001",
];

describe("in-memory DRAFT-only tea demo fixture", () => {
  it("contains exactly 15 open expert prompts with no OCR, triage, or sign-off", () => {
    const data = createSeedData();
    const review = data.reviews.find((item) => item.id === DEMO_REVIEW_ID)!;
    const label = data.labelVersions.find(
      (item) => item.id === review.label_version_id,
    )!;
    const product = data.products.find(
      (item) => item.id === review.product_id,
    )!;
    const findings = data.findings.filter(
      (item) => item.review_id === review.id,
    );

    expect(isSyntheticDemoReview(review)).toBe(true);
    expect(review).toMatchObject({
      idempotency_key: DEMO_REVIEW_CASE_REFERENCE,
      status: "HUMAN_REVIEW",
      progress: 100,
      pipeline: [],
      approved_by: null,
      approved_at: null,
      approval_comment: null,
      overall_result: "NOT_ASSESSED",
      report_status: "NOT_ISSUED",
      expert_review_status: "PENDING",
      triage_evaluated_at: null,
      collaboration_status: "not_shared",
    });
    expect(
      data.reviewParticipants?.filter((party) => party.review_id === review.id),
    ).toHaveLength(1);
    expect(
      data.reviewParticipants?.find((party) => party.review_id === review.id)
        ?.party_role,
    ).toBe("label_owner");
    expect(
      data.partyDecisions?.some((decision) => decision.review_id === review.id),
    ).toBe(false);
    expect(review.triage_route).toBe("EXPERT_REVIEW_REQUIRED");
    expect(review.triage_reasons).toEqual([]);
    expect(review.rule_snapshot).toHaveLength(15);
    expect(review.missing_information).toEqual(
      expect.arrayContaining([
        expect.stringContaining("không có tác vụ OCR"),
        expect.stringContaining("15 bộ quy tắc trà đang ở DRAFT"),
      ]),
    );
    expect(data.reports.some((report) => report.review_id === review.id)).toBe(
      false,
    );
    expect(
      data.preScreeningReports?.some(
        (report) => report.review_id === review.id,
      ),
    ).not.toBe(true);
    expect(
      data.requests.some((request) => request.review_id === review.id),
    ).toBe(false);

    expect(product.formula_confirmed).toBe(false);
    expect(product.claims_confirmed).toBe(false);
    expect(label.extracted_fields).toEqual([]);
    expect(label.original_files).toMatchObject([
      {
        id: "10000000-0000-4000-8000-000000000001",
        name: "lotus-front-v2.svg",
        mime_type: "image/svg+xml",
        size: 3130,
        storage_path: "demo-static/lotus-front-v2.svg",
        sha256:
          "f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177",
        scan_status: "dev_unscanned",
      },
      {
        id: "10000000-0000-4000-8000-000000000002",
        name: "lotus-back-v2.svg",
        mime_type: "image/svg+xml",
        size: 2253,
        storage_path: "demo-static/lotus-back-v2.svg",
        sha256:
          "ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02",
        scan_status: "dev_unscanned",
      },
    ]);

    expect(data.rules).toHaveLength(15);
    expect(
      data.rules.every(
        (rule) =>
          rule.status === "DRAFT" &&
          rule.test_status === "pending" &&
          rule.approved_by === null &&
          rule.effective_from === null,
      ),
    ).toBe(true);
    expect(
      data.sources.every(
        (source) =>
          source.status === "DRAFT" &&
          source.content_hash === null &&
          source.retrieved_at === null &&
          source.approved_by === null,
      ),
    ).toBe(true);

    expect(findings).toHaveLength(15);
    expect(findings.map((finding) => finding.rule_key).sort()).toEqual(
      [...RULE_KEYS].sort(),
    );
    expect(
      findings.every(
        (finding) =>
          finding.status === "open" &&
          finding.citation_pending &&
          finding.human_review_required &&
          finding.ai_confidence === null &&
          finding.reviewer_comment === null &&
          finding.reviewed_by === null &&
          finding.reviewed_at === null &&
          finding.title.startsWith("[DEMO · DRAFT]") &&
          finding.suggested_action.startsWith("GỢI Ý QUY TẮC DRAFT") &&
          finding.evidence.length === 1 &&
          finding.evidence[0].kind === "dossier" &&
          finding.evidence[0].bbox === null &&
          finding.evidence[0].text.includes("CHƯA CHẠY OCR"),
      ),
    ).toBe(true);
    expect(approvalIssues(data, review)).toContain(
      "Bộ quy tắc đã thay đổi hoặc hết hiệu lực. Hãy chạy lại lượt rà soát trước khi ký duyệt.",
    );
  });

  it("migrates only saved demo tea data and removes old sign-off artifacts", () => {
    const seeded = createSeedData();
    const legacy: AppData = structuredClone(seeded);
    const review = legacy.reviews.find((item) => item.id === DEMO_REVIEW_ID)!;
    const otherReviewBefore = structuredClone(
      legacy.reviews.find((item) => item.id !== DEMO_REVIEW_ID)!,
    );
    const otherFindingsBefore = structuredClone(
      legacy.findings.filter((item) => item.review_id !== DEMO_REVIEW_ID),
    );
    const report = {
      ...structuredClone(legacy.reports[0]),
      id: "50000000-0000-4000-8000-000000000099",
      review_id: DEMO_REVIEW_ID,
    };
    legacy.reports.push(report);
    legacy.requests.push({
      id: "70000000-0000-4000-8000-000000000099",
      review_id: DEMO_REVIEW_ID,
      organization_id: review.organization_id,
      message: "Legacy demo request",
      requested_documents: [],
      status: "open",
      created_by: "demo-reviewer",
      created_at: new Date().toISOString(),
    });
    legacy.preScreeningReports = [
      {
        id: "90000000-0000-4000-8000-000000000099",
        review_id: DEMO_REVIEW_ID,
        organization_id: review.organization_id,
        product_id: review.product_id,
        label_version_id: review.label_version_id,
        triage_run_id: "triage-demo",
        version: 1,
        disclaimer_profile: "PRE_SCREENING_ONLY",
        snapshot: {},
        created_at: new Date().toISOString(),
      },
    ];
    review.idempotency_key = "seed-0";
    review.status = "COMPLETED";
    review.triage_route = "AUTO_SCREENED";
    review.triage_evaluated_at = new Date().toISOString();
    review.approved_by = "demo-reviewer";
    review.approved_at = new Date().toISOString();
    review.approval_comment = "Legacy synthetic sign-off";
    review.pipeline = seeded.reviews[1].pipeline;
    const ownerParticipant = legacy.reviewParticipants!.find(
      (party) => party.review_id === DEMO_REVIEW_ID,
    )!;
    const unrelatedParticipant = legacy.reviewParticipants!.find(
      (party) => party.review_id !== DEMO_REVIEW_ID,
    )!;
    legacy.reviewParticipants!.push({
      ...ownerParticipant,
      id: "90000000-0000-4000-8000-000000000098",
      organization_id: legacy.organizations[1].id,
      organization_name_snapshot: legacy.organizations[1].name,
      party_role: "commercial_importer",
      status: "invited",
      activated_by: null,
      activated_at: null,
    });
    legacy.partyDecisions = [
      {
        id: "91000000-0000-4000-8000-000000000098",
        review_id: DEMO_REVIEW_ID,
        label_version_id: review.label_version_id,
        participant_id: ownerParticipant.id,
        party_role: "label_owner",
        decision: "accepted",
        comment: "Legacy synthetic sign-off",
        proposed_changes: [],
        label_bundle_sha256: "a".repeat(64),
        actor_id: ownerParticipant.activated_by!,
        actor_name_snapshot: "Demo Owner",
        created_at: new Date().toISOString(),
      },
      {
        id: "91000000-0000-4000-8000-000000000099",
        review_id: unrelatedParticipant.review_id,
        label_version_id: legacy.reviews.find(
          (item) => item.id === unrelatedParticipant.review_id,
        )!.label_version_id,
        participant_id: unrelatedParticipant.id,
        party_role: "label_owner",
        decision: "accepted",
        comment: "Keep unrelated decision history",
        proposed_changes: [],
        label_bundle_sha256: "b".repeat(64),
        actor_id: unrelatedParticipant.activated_by!,
        actor_name_snapshot: "Demo Owner",
        created_at: new Date().toISOString(),
      },
    ];
    legacy.rules = legacy.rules.map((rule) => ({
      ...rule,
      status: "ACTIVE",
      test_status: "passed",
      approved_by: "demo-regulatory",
    }));
    legacy.sources = legacy.sources.map((source) => ({
      ...source,
      status: "CURRENT",
      content_hash: "d".repeat(64),
      approved_by: "demo-regulatory",
    }));
    legacy.audit.unshift(
      {
        id: "80000000-0000-4000-8000-000000000099",
        organization_id: review.organization_id,
        actor_id: "demo-reviewer",
        actor_name: "Demo Reviewer",
        action: "report.approved",
        entity_type: "report",
        entity_id: report.id,
        description: "Legacy synthetic report approval",
        metadata: { demo: true },
        created_at: new Date().toISOString(),
      },
      {
        id: "80000000-0000-4000-8000-000000000098",
        organization_id: null,
        actor_id: "demo-reviewer",
        actor_name: "Demo Reviewer",
        action: "source.updated",
        entity_type: "source",
        entity_id: legacy.sources[0].id,
        description: "Keep unrelated local registry history",
        metadata: { demo: true },
        created_at: new Date().toISOString(),
      },
    );

    const refreshed = refreshDraftOnlyDemoFixture(legacy, seeded);
    const refreshedReview = refreshed.reviews.find(
      (item) => item.id === DEMO_REVIEW_ID,
    )!;

    expect(refreshedReview).toEqual(
      seeded.reviews.find((item) => item.id === DEMO_REVIEW_ID),
    );
    expect(
      refreshed.findings.filter((item) => item.review_id === DEMO_REVIEW_ID),
    ).toEqual(
      seeded.findings.filter((item) => item.review_id === DEMO_REVIEW_ID),
    );
    expect(
      refreshed.reports.some((item) => item.review_id === DEMO_REVIEW_ID),
    ).toBe(false);
    expect(
      refreshed.preScreeningReports?.some(
        (item) => item.review_id === DEMO_REVIEW_ID,
      ),
    ).toBe(false);
    expect(
      refreshed.requests.some((item) => item.review_id === DEMO_REVIEW_ID),
    ).toBe(false);
    expect(refreshed.rules.every((rule) => rule.status === "DRAFT")).toBe(true);
    expect(refreshed.sources.every((source) => source.status === "DRAFT")).toBe(
      true,
    );
    expect(refreshed.audit.some((entry) => entry.entity_id === report.id)).toBe(
      false,
    );
    expect(
      refreshed.audit.some(
        (entry) => entry.id === "80000000-0000-4000-8000-000000000098",
      ),
    ).toBe(true);
    expect(
      refreshed.reviews.find((item) => item.id === otherReviewBefore.id),
    ).toEqual(otherReviewBefore);
    expect(
      refreshed.reviewParticipants?.filter(
        (party) => party.review_id === DEMO_REVIEW_ID,
      ),
    ).toEqual(
      seeded.reviewParticipants?.filter(
        (party) => party.review_id === DEMO_REVIEW_ID,
      ),
    );
    expect(
      refreshed.reviewParticipants?.some(
        (party) => party.id === "90000000-0000-4000-8000-000000000098",
      ),
    ).toBe(false);
    expect(refreshed.partyDecisions).toEqual([
      expect.objectContaining({
        id: "91000000-0000-4000-8000-000000000099",
        review_id: unrelatedParticipant.review_id,
      }),
    ]);
    expect(
      refreshed.findings.filter((item) => item.review_id !== DEMO_REVIEW_ID),
    ).toEqual(otherFindingsBefore);
  });
});
