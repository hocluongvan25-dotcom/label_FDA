import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { actor, call, createDatabase, ids } from "./helpers/database";

const reviewId = "30000000-0000-4000-8000-000000000001";
const organizationId = "a0000000-0000-4000-8000-000000000001";
const productId = "d0000000-0000-4000-8000-000000000001";
const labelVersionId = "20000000-0000-4000-8000-000000000001";
const frontFileId = "10000000-0000-4000-8000-000000000001";
const ruleKeys = [
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

let db: PGlite;
beforeAll(async () => {
  db = await createDatabase();
});
afterAll(async () => {
  await db?.close();
});

describe("isolated demo review seed", () => {
  it("is idempotent, review-only, and exposes only the two pinned SVG samples", async () => {
    const seedSql = await readFile("supabase/seed.sql", "utf8");
    const flagsBefore = await db.query(
      "select * from public.triage_feature_flags order by singleton",
    );

    await db.exec(seedSql);
    await db.exec(seedSql);

    const flagsAfter = await db.query(
      "select * from public.triage_feature_flags order by singleton",
    );
    expect(flagsAfter.rows).toEqual(flagsBefore.rows);
    expect(flagsAfter.rows[0]).toMatchObject({ pre_screening_enabled: false });

    const review = await db.query<{
      id: string;
      organization_id: string;
      product_id: string;
      label_version_id: string;
      idempotency_key: string;
      status: string;
      triage_evaluated_at: string | null;
      overall_result: string;
      report_status: string;
      expert_review_status: string;
      rule_snapshot: { rule_key: string }[];
      dossier_snapshot: { demo_fixture?: boolean; demo_notice?: string };
      approved_by: string | null;
      approved_at: string | null;
      approval_comment: string | null;
    }>("select * from public.reviews where id=$1", [reviewId]);
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]).toMatchObject({
      id: reviewId,
      organization_id: organizationId,
      product_id: productId,
      label_version_id: labelVersionId,
      idempotency_key: "SRD-ANHIEN-LOTUS-DEMO-001",
      status: "HUMAN_REVIEW",
      triage_evaluated_at: null,
      overall_result: "NOT_ASSESSED",
      report_status: "NOT_ISSUED",
      expert_review_status: "PENDING",
      approved_by: null,
      approved_at: null,
      approval_comment: null,
    });
    expect(review.rows[0].rule_snapshot).toHaveLength(15);
    expect(review.rows[0].dossier_snapshot).toMatchObject({
      demo_fixture: true,
      demo_notice: expect.stringContaining("No OCR job"),
    });

    const product = await db.query<{ name: string; brand: string }>(
      "select name,brand from public.products where id=$1",
      [productId],
    );
    expect(product.rows).toEqual([
      { name: "Trà sen túi lọc", brand: "AN NHIÊN" },
    ]);

    const files = await db.query<{
      storage_path: string;
      mime_type: string;
      scan_status: string;
      size: number;
      sha256: string;
    }>(
      "select storage_path,mime_type,scan_status,size,sha256 from public.label_files where label_version_id=$1 order by storage_path",
      [labelVersionId],
    );
    expect(files.rows).toEqual([
      {
        storage_path: "demo-static/lotus-back-v2.svg",
        mime_type: "image/svg+xml",
        scan_status: "dev_unscanned",
        size: 2253,
        sha256:
          "ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02",
      },
      {
        storage_path: "demo-static/lotus-front-v2.svg",
        mime_type: "image/svg+xml",
        scan_status: "dev_unscanned",
        size: 3130,
        sha256:
          "f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177",
      },
    ]);
    const extracted = await db.query<{ count: number }>(
      "select count(*)::int as count from public.extracted_fields where label_version_id=$1",
      [labelVersionId],
    );
    expect(extracted.rows[0].count).toBe(0);

    const findings = await db.query<{
      rule_key: string;
      status: string;
      citation_pending: boolean;
      human_review_required: boolean;
      ai_confidence: number | null;
      reviewer_comment: string | null;
    }>(
      "select rule_key,status,citation_pending,human_review_required,ai_confidence,reviewer_comment from public.findings where review_id=$1 order by rule_key",
      [reviewId],
    );
    expect(findings.rows).toHaveLength(15);
    expect(findings.rows.map((finding) => finding.rule_key).sort()).toEqual(
      [...ruleKeys].sort(),
    );
    expect(
      findings.rows.every(
        (finding) =>
          finding.status === "open" &&
          finding.citation_pending &&
          finding.human_review_required &&
          finding.ai_confidence === null &&
          finding.reviewer_comment === null,
      ),
    ).toBe(true);

    const rules = await db.query<{ status: string }>(
      "select status from public.compliance_rules where rule_key=any($1::text[]) order by rule_key",
      [ruleKeys],
    );
    expect(rules.rows).toHaveLength(15);
    expect(rules.rows.every((rule) => rule.status === "DRAFT")).toBe(true);

    const artifactCounts = await db.query<{
      reports: number;
      pre_screening: number;
      triage_runs: number;
      jobs: number;
    }>(
      `select
        (select count(*)::int from public.reports where review_id=$1) as reports,
        (select count(*)::int from public.pre_screening_reports where review_id=$1) as pre_screening,
        (select count(*)::int from public.review_triage_runs where review_id=$1) as triage_runs,
        (select count(*)::int from public.pipeline_jobs where review_id=$1) as jobs`,
      [reviewId],
    );
    expect(artifactCounts.rows[0]).toEqual({
      reports: 0,
      pre_screening: 0,
      triage_runs: 0,
      jobs: 0,
    });

    const storageObjects = await db.query<{ count: number }>(
      "select count(*)::int as count from storage.objects where name like 'demo-static/%'",
    );
    expect(storageObjects.rows[0].count).toBe(0);

    await db.exec("begin");
    await actor(db, ids.reviewer);
    await call(db, "vexim_log_file_access", [frontFileId, "view"]);
    await expect(
      call(db, "vexim_log_file_access", [frontFileId, "signed_url"]),
    ).rejects.toThrow(/not stored in Supabase Storage/i);
    await expect(
      call(db, "vexim_retry_review", [reviewId, "ocr"]),
    ).rejects.toThrow(/view-only; pipeline reruns are disabled/i);
    await db.exec("reset role; commit");

    const demoAccessLog = await db.query<{ count: number }>(
      "select count(*)::int as count from public.audit_logs where entity_id=$1 and action='file.view'",
      [labelVersionId],
    );
    expect(demoAccessLog.rows[0].count).toBe(1);

    await expect(
      db.query(
        `insert into public.label_files (
          id,label_version_id,organization_id,name,mime_type,size,storage_path,
          sha256,page_count,scan_status,kind
        ) values ($1,$2,$3,'unapproved.svg','image/svg+xml',3130,
          'demo-static/unapproved.svg',$4,1,'dev_unscanned','original')`,
        [randomUUID(), labelVersionId, organizationId, "0".repeat(64)],
      ),
    ).rejects.toThrow(/label_files_mime_type_check/i);
  });
});
