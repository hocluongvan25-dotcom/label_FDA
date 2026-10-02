import { describe, expect, it } from "vitest";
import type {
  ComplianceRule,
  ExtractedField,
  Finding,
  Product,
  RegulatorySource,
} from "../src/lib/types";
import {
  assertPreScreeningLanguageSafe,
  buildPreScreeningSnapshot,
  evaluateTriage,
  mayIssuePreScreening,
  runtimePreScreeningEnabled,
  TRIAGE_POLICY_VERSION,
  type RegulatoryParserQuality,
  type TriageInput,
} from "../src/lib/triage";
import { needsAction } from "../src/lib/utils";

const hash = "a".repeat(64);

function productFixture(): Product {
  return {
    id: "product-tea",
    organization_id: "org-staging-tea",
    name: "Synthetic green tea",
    brand: "Synthetic",
    category: "dry_packaged_tea",
    form: "loose_leaf",
    market: "US",
    channel: ["retail"],
    expected_us_units_12m: 1000,
    employee_fte: 5,
    classification_status: "conventional_food",
    formula: [],
    claims: [],
    package_size: "40 g",
    net_quantity: "1.41 oz (40 g)",
    manufacturer: { name: "Synthetic Co", address: "1 Test Street" },
    packer: { name: "", address: "" },
    distributor: { name: "", address: "" },
    importer: { name: "", address: "" },
    certifications: [],
    exemption_requested: false,
    formula_confirmed: true,
    claims_confirmed: true,
    assigned_to: "",
    created_by: "synthetic",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    color: "sage",
  };
}

function sourceFixture(index: number): RegulatorySource {
  const id = `source-${index + 1}`;
  const snapshotId = `snapshot-${index + 1}`;
  return {
    id,
    source_key: `synthetic-21-cfr-101-${index + 1}`,
    authority: "Synthetic test source",
    agency: "Synthetic QA",
    document_type: "regulation",
    citation: `21 CFR 101.${index + 1}`,
    title: `Synthetic labeling section ${index + 1}`,
    canonical_url: "https://www.ecfr.gov/current/title-21/part-101",
    topic: "food_labeling",
    status: "CURRENT",
    priority: 1,
    retrieved_at: "2026-01-01T00:00:00.000Z",
    effective_from: "2020-01-01",
    effective_to: null,
    effective_date_unknown: false,
    content_hash: hash,
    raw_snapshot_id: snapshotId,
    raw_content_hash: hash,
    issue_date: "2025-01-01",
    parser_version: "synthetic-parser-v1",
    ingestion_status: "ACTIVE",
    content_excerpt: "Synthetic QA only. Not a legal source.",
    approved_by: "synthetic-regulatory-reviewer",
    approved_at: "2026-01-02T00:00:00.000Z",
    version: 1,
    updated_at: "2026-01-02T00:00:00.000Z",
  };
}

function packFixture(): TriageInput {
  const sources = Array.from({ length: 15 }, (_, index) =>
    sourceFixture(index),
  );
  const rules: ComplianceRule[] = sources.map((source, index) => ({
    id: `rule-id-${index + 1}`,
    rule_key: index === 0 ? "CLASS-001" : `TEA-${String(index).padStart(3, "0")}`,
    name: `Synthetic tea rule ${index + 1}`,
    version: 1,
    scope: ["dry_packaged_tea", "tea_bag"],
    condition_json: { type: "synthetic" },
    action_json: {
      severity: "minor",
      human_review: false,
      suggested_action: "Synthetic QA only",
    },
    source_citations: [source.id],
    source_snapshot: [
      { id: source.id, version: source.version, content_hash: source.content_hash },
    ],
    status: "ACTIVE",
    effective_from: "2020-01-01",
    effective_to: null,
    created_by: "synthetic-regulatory-admin",
    approved_by: "synthetic-regulatory-approver",
    definition_hash: "b".repeat(64),
    test_hash: "b".repeat(64),
    test_status: "passed",
    updated_at: "2026-01-03T00:00:00.000Z",
  }));
  const rule_snapshot = rules.map((rule, index) => {
    const source = sources[index];
    return {
      rule_key: rule.rule_key,
      version: rule.version,
      source_versions: [
        {
          id: source.id,
          version: source.version,
          content_hash: source.content_hash,
          snapshot_id: source.raw_snapshot_id!,
          raw_content_hash: source.raw_content_hash,
          issue_date: source.issue_date,
          parser_version: source.parser_version,
        },
      ],
    };
  });
  const parser_quality: RegulatoryParserQuality[] = sources.map((source) => ({
    snapshot_id: source.raw_snapshot_id!,
    status: "ACTIVE",
    parser_version: "synthetic-parser-v1",
    coverage_complete: true,
    citations_valid: true,
    effective_date_unknown: false,
  }));
  const fields: ExtractedField[] = [
    "statement_of_identity",
    "net_quantity",
    "ingredient_list",
    "responsible_party",
  ].map((field, index) => ({
    id: `field-${index + 1}`,
    field,
    value: `Synthetic observed field ${index + 1}`,
    confidence: 0.96,
    evidence: {
      file_id: "synthetic-label",
      page: 1,
      bbox: [0.1, 0.1 + index * 0.1, 0.8, 0.16 + index * 0.1],
      text: `Synthetic observed field ${index + 1}`,
      kind: "observed",
    },
    extraction_model: "synthetic-fixture",
    extracted_at: "2026-01-04T00:00:00.000Z",
  }));
  return {
    product: productFixture(),
    fields,
    findings: [],
    rules,
    sources,
    rule_snapshot,
    parser_quality,
    ocr_confidence: 0.96,
    ocr_pages: 1,
    expected_pages: 1,
    evaluated_at: new Date("2026-02-01T00:00:00.000Z"),
  };
}

function findingFixture(
  severity: Finding["severity"],
  human_review_required = false,
): Finding {
  return {
    id: `finding-${severity}`,
    review_id: "review-synthetic",
    organization_id: "org-staging-tea",
    rule_key: "TEA-001",
    rule_version: 1,
    severity,
    status: "open",
    title: "Synthetic observation",
    description: "Synthetic QA observation only.",
    evidence: [
      {
        file_id: "synthetic-label",
        page: 1,
        bbox: [0.1, 0.1, 0.5, 0.2],
        text: "Synthetic evidence",
        kind: "observed",
      },
    ],
    citation_ids: ["source-2"],
    citation_pending: false,
    suggested_action: "Synthetic QA only",
    ai_confidence: 0.96,
    reasoning_category: "field_presence",
    human_review_required,
    reviewer_comment: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-01-04T00:00:00.000Z",
  };
}

describe("versioned risk-based triage", () => {
  it("routes a qualified low-risk synthetic tea dossier to AUTO_SCREENED without treating it as a pass", () => {
    const decision = evaluateTriage(packFixture());
    expect(decision.policy_version).toBe(TRIAGE_POLICY_VERSION);
    expect(decision.triage_route).toBe("AUTO_SCREENED");
    expect(decision.overall_result).toBe("NO_AUTOMATED_ISSUE_DETECTED");
    expect(decision.report_status).toBe("DISABLED");
    expect(decision.expert_review_status).toBe("NOT_REQUIRED");
    expect(decision.reasons).toEqual([]);
  });

  it("does not put AUTO_SCREENED into the expert action queue", () => {
    expect(needsAction("AI_REVIEW_READY", "AUTO_SCREENED")).toBe(false);
    expect(needsAction("HUMAN_REVIEW", "AUTO_SCREENED")).toBe(true);
    expect(needsAction("REVISION_REQUIRED", "AUTO_SCREENED")).toBe(true);
    expect(needsAction("MANUAL_ESCALATION_REQUIRED", "EXPERT_REVIEW_REQUIRED")).toBe(
      true,
    );
    expect(needsAction("SOURCE_UNAVAILABLE", "BLOCKED_REGULATORY_SOURCE")).toBe(
      true,
    );
  });

  it.each(["minor", "major"] as const)(
    "keeps the process route separate from a %s potential-issues outcome",
    (severity) => {
      const input = packFixture();
      input.findings = [findingFixture(severity)];
      const decision = evaluateTriage(input);
      expect(decision.triage_route).toBe("AUTO_SCREENED");
      expect(decision.overall_result).toBe("POTENTIAL_ISSUES_FOUND");
    },
  );

  it.each([
    ["DRAFT source", (input: TriageInput) => {
      input.sources[0].status = "DRAFT";
      input.sources[0].approved_by = null;
    }, "REGULATORY_SOURCE_DRAFT"],
    ["inactive source", (input: TriageInput) => {
      input.sources[0].status = "SUPERSEDED";
    }, "REGULATORY_SOURCE_INACTIVE"],
    ["rule without a matching approved regression hash", (input: TriageInput) => {
      input.rules[0].test_hash = "stale-test-hash";
    }, "ACTIVE_RULE_APPROVAL_UNVERIFIED"],
    ["unresolved citation", (input: TriageInput) => {
      input.rule_snapshot![0].source_versions = [];
    }, "UNRESOLVED_RULE_SNAPSHOT_CITATION"],
    ["inadequate parser coverage", (input: TriageInput) => {
      input.parser_quality![0].coverage_complete = false;
    }, "REGULATORY_PARSER_COVERAGE_INADEQUATE"],
    ["unresolved paragraph path despite valid citation syntax", (input: TriageInput) => {
      input.parser_quality![0].citations_valid = true;
      input.parser_quality![0].citation_paths_resolved = false;
      input.parser_quality![0].unresolved_citation_count = 4;
    }, "UNRESOLVED_REGULATORY_CITATION"],
    ["unverified eCFR citation precision", (input: TriageInput) => {
      input.parser_quality![0].source_family = "ecfr";
      input.parser_quality![0].citations_valid = true;
    }, "UNRESOLVED_REGULATORY_CITATION"],
    ["unverified parser version", (input: TriageInput) => {
      input.parser_quality![0].parser_version = null;
    }, "REGULATORY_PARSER_VERSION_UNVERIFIED"],
    ["mismatched source snapshot", (input: TriageInput) => {
      input.rule_snapshot![0].source_versions[0].snapshot_id = "stale-snapshot";
    }, "REGULATORY_SOURCE_SNAPSHOT_MISMATCH"],
    ["unknown effective date", (input: TriageInput) => {
      input.sources[0].effective_date_unknown = true;
    }, "REGULATORY_EFFECTIVE_DATE_UNCLEAR"],
  ])("blocks automated issuance for %s", (_name, mutate, reasonCode) => {
    const input = packFixture();
    (mutate as (value: TriageInput) => void)(input);
    const decision = evaluateTriage(input);
    expect(decision.triage_route).toBe("BLOCKED_REGULATORY_SOURCE");
    expect(decision.report_status).toBe("BLOCKED");
    expect(decision.reasons.map((reason) => reason.code)).toContain(reasonCode);
  });

  it("blocks findings whose citations do not resolve to the exact active rule snapshot", () => {
    const input = packFixture();
    const finding = findingFixture("major");
    finding.citation_ids = ["source-not-in-active-rule"];
    input.findings = [finding];
    const decision = evaluateTriage(input);
    expect(decision.triage_route).toBe("BLOCKED_REGULATORY_SOURCE");
    expect(decision.reasons.map((reason) => reason.code)).toContain(
      "UNRESOLVED_FINDING_CITATION",
    );
  });

  it("blocks when the applicable active rule pack or its execution snapshot is incomplete", () => {
    const input = packFixture();
    input.rules = input.rules.slice(0, 14);
    input.rule_snapshot = input.rule_snapshot!.slice(0, 14);
    const decision = evaluateTriage(input);
    expect(decision.triage_route).toBe("BLOCKED_REGULATORY_SOURCE");
    expect(decision.reasons.map((reason) => reason.code)).toContain(
      "ACTIVE_RULE_PACK_INCOMPLETE",
    );
  });

  it("routes missing customer inputs and weak OCR to NEEDS_CUSTOMER_INFORMATION with specific questions", () => {
    const input = packFixture();
    input.product.expected_us_units_12m = null;
    input.ocr_confidence = 0.48;
    const decision = evaluateTriage(input);
    expect(decision.triage_route).toBe("NEEDS_CUSTOMER_INFORMATION");
    expect(decision.overall_result).toBe("INSUFFICIENT_INFORMATION");
    expect(decision.customer_questions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("đơn vị dự kiến bán tại Hoa Kỳ"),
        expect.stringContaining("nhãn rõ nét hơn"),
      ]),
    );
  });

  it.each([
    ["disease", "Helps treat diabetes", "DISEASE_CLAIM_REQUIRES_EXPERT"],
    ["health", "Supports heart health", "HEALTH_CLAIM_REQUIRES_EXPERT"],
  ])("routes %s claims to expert review", (_name, claim, reasonCode) => {
    const input = packFixture();
    input.product.claims = [claim as string];
    const decision = evaluateTriage(input);
    expect(decision.triage_route).toBe("EXPERT_REVIEW_REQUIRED");
    expect(decision.expert_review_status).toBe("PENDING");
    expect(decision.reasons.map((reason) => reason.code)).toContain(reasonCode);
  });

  it("applies exact precedence and preserves reasons when several gates apply together", () => {
    const input = packFixture();
    input.product.category = "other";
    input.product.classification_status = "out_of_scope";
    input.product.expected_us_units_12m = null;
    input.product.claims = ["Helps treat diabetes"];
    input.sources[0].status = "DRAFT";
    input.ocr_confidence = 0.4;
    input.findings = [findingFixture("critical", true)];

    const decision = evaluateTriage(input);
    const gates = new Set(decision.reasons.map((reason) => reason.gate));
    const codes = new Set(decision.reasons.map((reason) => reason.code));
    expect(decision.triage_route).toBe("OUT_OF_SCOPE");
    expect(gates).toEqual(
      new Set([
        "OUT_OF_SCOPE",
        "BLOCKED_REGULATORY_SOURCE",
        "EXPERT_REVIEW_REQUIRED",
        "NEEDS_CUSTOMER_INFORMATION",
      ]),
    );
    expect(codes).toContain("DISEASE_CLAIM_REQUIRES_EXPERT");
    expect(codes).toContain("REGULATORY_SOURCE_DRAFT");
    expect(codes).toContain("EXPECTED_US_VOLUME_MISSING");
    expect(codes).toContain("OCR_CONFIDENCE_LOW");
  });

  it("uses BLOCKED over expert and information gates, and EXPERT over information", () => {
    const blocked = packFixture();
    blocked.sources[0].status = "DRAFT";
    blocked.product.claims = ["Prevents diabetes"];
    blocked.product.expected_us_units_12m = null;
    expect(evaluateTriage(blocked).triage_route).toBe(
      "BLOCKED_REGULATORY_SOURCE",
    );

    const expert = packFixture();
    expert.product.claims = ["Supports heart health"];
    expert.product.expected_us_units_12m = null;
    expect(evaluateTriage(expert).triage_route).toBe(
      "EXPERT_REVIEW_REQUIRED",
    );
  });

  it("does not allow a large risk score to override source hard gates", () => {
    const input = packFixture();
    input.sources[0].status = "DRAFT";
    input.findings = [findingFixture("critical", true), findingFixture("major", true)];
    const decision = evaluateTriage(input);
    expect(decision.risk_score).toBeGreaterThanOrEqual(50);
    expect(decision.triage_route).toBe("BLOCKED_REGULATORY_SOURCE");
    expect(decision.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "CRITICAL_FINDING_REQUIRES_EXPERT",
        "HIGH_RISK_SCORE",
      ]),
    );
  });

  it("creates a separate artifact with PRE_SCREENING_ONLY and rejects prohibited generated wording", () => {
    const input = packFixture();
    const decision = evaluateTriage(input);
    const artifact = buildPreScreeningSnapshot({
      reviewId: "review-synthetic",
      labelVersionId: "label-synthetic",
      decision,
      findings: [],
      ruleSnapshot: input.rule_snapshot,
      generatedAt: new Date("2026-02-01T00:00:00.000Z"),
    });
    expect(artifact.disclaimer_profile).toBe("PRE_SCREENING_ONLY");
    expect(artifact.triage_route).toBe("AUTO_SCREENED");
    expect(artifact.overall_result).toBe("NO_AUTOMATED_ISSUE_DETECTED");
    expect(artifact).not.toHaveProperty("reviewer");
    expect(() =>
      assertPreScreeningLanguageSafe({ summary: "FDA approved" }),
    ).toThrow(/bị cấm/i);
  });

  it("requires both an explicit non-production staging runtime and database allowlist", () => {
    const stagingEnv = {
      REGULATORY_PRE_SCREENING_ENABLED: "true",
      REGULATORY_PRE_SCREENING_ENV: "staging",
      DEPLOYMENT_ENV: "staging",
    };
    expect(runtimePreScreeningEnabled(stagingEnv)).toBe(true);
    expect(
      runtimePreScreeningEnabled({ ...stagingEnv, VERCEL_ENV: "production" }),
    ).toBe(false);
    expect(
      runtimePreScreeningEnabled({ ...stagingEnv, DEPLOYMENT_ENV: "production" }),
    ).toBe(false);
    expect(
      mayIssuePreScreening({
        runtimeEnabled: true,
        databaseEnabled: true,
        organizationId: "org-staging-tea",
        allowedOrganizationIds: ["org-staging-tea"],
      }),
    ).toBe(true);
    expect(
      mayIssuePreScreening({
        runtimeEnabled: true,
        databaseEnabled: false,
        organizationId: "org-staging-tea",
        allowedOrganizationIds: ["org-staging-tea"],
      }),
    ).toBe(false);
  });
});
