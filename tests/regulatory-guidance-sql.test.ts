import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { actor, call, createDatabase, ids } from "./helpers/database";
import { guidanceChecklistKeys } from "../src/lib/regulatory-guidance";

/**
 * The dedicated FDA-guidance workflow lives in SQL (migration 0004). These tests
 * run the real migrations on PGlite so a broken guard fails here, not in
 * production. No test fabricates an approval: every approval below is performed
 * by the second Regulatory Admin after a real expert review.
 */
let db: PGlite;
beforeAll(async () => {
  db = await createDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("reset role;begin");
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});
async function query<T = Record<string, unknown>>(
  sql: string,
  args: unknown[] = [],
) {
  const r = await db.query<T>(sql, args);
  return r.rows;
}
const fullChecklist = Object.fromEntries(
  guidanceChecklistKeys.map((k) => [k, "true"]),
);
const scopeNote =
  "Áp dụng cho claim dinhưỡng trên nhãn thực phẩm đóng gói sẵn, không áp dụng cho thực phẩm bổ sung.";
async function sourceDraft(overrides: Record<string, unknown> = {}) {
  await actor(db, ids.regA);
  const id = randomUUID();
  // vexim_save_source derives the hash from the stored excerpt (sha256).
  const excerpt = overrides.content_excerpt
    ? String(overrides.content_excerpt)
    : "This guidance describes how FDA intends to apply nutrient content claim requirements. ".repeat(
        2,
      );
  const hash = createHash("sha256").update(excerpt).digest("hex");
  await call(db, "vexim_save_source", [
    {
      id,
      source_key: `test-guidance-${id.slice(0, 8)}`,
      authority: "FDA",
      agency: "FDA",
      document_type: "guidance",
      citation: "FDA Label Claims Guidance v2",
      title: "Guidance for Industry: Label Claims",
      canonical_url: "https://www.fda.gov/guidance-label-claims",
      topic: "claims",
      priority: 4,
      retrieved_at: new Date().toISOString(),
      effective_from: null,
      effective_to: null,
      content_hash: hash,
      content_excerpt: excerpt,
      ...overrides,
    },
  ]);
  return { id, hash };
}
async function expectReject(fn: () => Promise<unknown>, pattern: RegExp) {
  await expect(fn()).rejects.toThrow(pattern);
}
/** Raw SQL that must fail, without aborting the surrounding test transaction. */
async function expectSqlReject(sql: string, pattern: RegExp) {
  await db.exec("savepoint sql_reject");
  let failed = false;
  try {
    await db.exec(sql);
  } catch (e) {
    failed = true;
    expect(String((e as Error).message)).toMatch(pattern);
  } finally {
    await db.exec(
      "rollback to savepoint sql_reject; release savepoint sql_reject",
    );
  }
  expect(failed).toBe(true);
}

describe("FDA guidance expert review (0004)", () => {
  it("refuses approval before an expert review exists", async () => {
    const { id } = await sourceDraft();
    await actor(db, ids.regB);
    await expectReject(
      () => call(db, "vexim_approve_source", [id]),
      /expert review record/i,
    );
  });

  it("rejects an incomplete checklist and a short scope note", async () => {
    const { id } = await sourceDraft();
    await actor(db, ids.regA);
    await expectReject(
      () =>
        call(db, "vexim_review_guidance_source", [
          id,
          { ...fullChecklist, affected_rules: "false" },
          "final",
          "non_binding",
          scopeNote,
        ]),
      /checklist item/i,
    );
    await expectReject(
      () =>
        call(db, "vexim_review_guidance_source", [
          id,
          fullChecklist,
          "final",
          "non_binding",
          "quá ngắn",
        ]),
      /scope note/i,
    );
  });

  it("requires the non-binding acknowledgement for draft guidance", async () => {
    const { id } = await sourceDraft();
    await actor(db, ids.regA);
    await expectReject(
      () =>
        call(db, "vexim_review_guidance_source", [
          id,
          fullChecklist,
          "draft",
          "non_binding",
          scopeNote,
        ]),
      /non-binding acknowledgement/i,
    );
  });

  it("keeps approval independent: the reviewer cannot approve", async () => {
    const { id } = await sourceDraft();
    await actor(db, ids.regA);
    await call(db, "vexim_review_guidance_source", [
      id,
      fullChecklist,
      "final",
      "non_binding",
      scopeNote,
    ]);
    await expectReject(
      () => call(db, "vexim_approve_source", [id]),
      /not the expert reviewer/i,
    );
  });

  it("approves after an independent review by a second admin", async () => {
    const { id, hash } = await sourceDraft();
    await actor(db, ids.regA);
    await call(db, "vexim_review_guidance_source", [
      id,
      fullChecklist,
      "final",
      "non_binding",
      scopeNote,
    ]);
    await actor(db, ids.regB);
    await call(db, "vexim_approve_source", [id]);
    const rows = await query(
      "select status,approved_by,ingestion_status,content_hash from public.regulatory_sources where id=$1",
      [id],
    );
    expect(rows[0].status).toBe("CURRENT");
    expect(rows[0].approved_by).toBe(ids.regB);
    expect(rows[0].ingestion_status).toBe("ACTIVE");
    expect(rows[0].content_hash).toBe(hash);
    const audit = await query(
      "select action from public.audit_logs where entity_id=$1 order by created_at",
      [id],
    );
    expect(audit.map((a) => a.action)).toContain(
      "regulatory.guidance_reviewed",
    );
    expect(audit.map((a) => a.action)).toContain(
      "regulatory.guidance_approved",
    );
  });

  it("invalidates the review when the source content changes", async () => {
    const { id } = await sourceDraft();
    await actor(db, ids.regA);
    await call(db, "vexim_review_guidance_source", [
      id,
      fullChecklist,
      "final",
      "non_binding",
      scopeNote,
    ]);
    const nextHash = createHash("sha256").update("changed").digest("hex");
    await call(db, "vexim_save_source", [
      {
        id,
        source_key: `test-guidance-${id.slice(0, 8)}`,
        authority: "FDA",
        agency: "FDA",
        document_type: "guidance",
        citation: "FDA Label Claims Guidance v2",
        title: "Guidance for Industry: Label Claims",
        canonical_url: "https://www.fda.gov/guidance-label-claims",
        topic: "claims",
        priority: 4,
        retrieved_at: new Date().toISOString(),
        effective_from: null,
        effective_to: null,
        content_hash: nextHash,
        content_excerpt: "Revised guidance body. ".repeat(6),
      },
    ]);
    await actor(db, ids.regB);
    await expectReject(
      () => call(db, "vexim_approve_source", [id]),
      /expert review is stale/i,
    );
  });

  it("refuses to record FDA guidance as legally binding", async () => {
    const { id } = await sourceDraft();
    await actor(db, ids.regA);
    await call(db, "vexim_review_guidance_source", [
      id,
      fullChecklist,
      "final",
      "binding",
      scopeNote,
    ]);
    await actor(db, ids.regB);
    await expectReject(
      () => call(db, "vexim_approve_source", [id]),
      /record it as non-binding/i,
    );
  });

  it("leaves regulations on the normal two-person workflow", async () => {
    const { id } = await sourceDraft({ document_type: "regulation" });
    await expectReject(
      () =>
        call(db, "vexim_review_guidance_source", [
          id,
          fullChecklist,
          "final",
          "non_binding",
          scopeNote,
        ]),
      /guidance documents only/i,
    );
    await actor(db, ids.regB);
    await call(db, "vexim_approve_source", [id]);
    const rows = await query(
      "select status,ingestion_status from public.regulatory_sources where id=$1",
      [id],
    );
    expect(rows[0].status).toBe("CURRENT");
    expect(rows[0].ingestion_status).toBeNull();
  });

  it("stores expert reviews append-only", async () => {
    const { id } = await sourceDraft();
    await actor(db, ids.regA);
    await call(db, "vexim_review_guidance_source", [
      id,
      fullChecklist,
      "final",
      "non_binding",
      scopeNote,
    ]);
    // Row level security already blocks staff from editing the ledger directly.
    await expectSqlReject(
      "update public.regulatory_guidance_reviews set guidance_status='withdrawn'",
      /permission denied/i,
    );
    // Even with RLS bypassed, the trigger refuses to rewrite history.
    await actor(db, null, "service_role");
    await expectSqlReject(
      "update public.regulatory_guidance_reviews set guidance_status='withdrawn'",
      /append-only/i,
    );
    await expectSqlReject(
      "delete from public.regulatory_guidance_reviews",
      /append-only/i,
    );
  });

  it("only lets the service role record a regression result", async () => {
    const { id, hash } = await sourceDraft();
    await actor(db, ids.regA);
    await expectReject(
      () =>
        call(db, "vexim_record_guidance_regression", [
          id,
          hash,
          [],
          [],
          ids.regA,
        ]),
      /permission denied for function vexim_record_guidance_regression/i,
    );
    await actor(db, null, "service_role");
    const result = await call<{ passed: boolean }>(
      db,
      "vexim_record_guidance_regression",
      [id, hash, [], [], ids.regA],
    );
    // An empty result set is never a passing regression.
    expect(result.passed).toBe(false);
  });
});
