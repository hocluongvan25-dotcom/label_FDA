import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import {
  actor,
  call,
  createDatabase,
  ids,
  productDraft,
  submit,
} from "./helpers/database";
import { RULE_CATALOG } from "../src/lib/regulatory";
import type {
  ComplianceRule,
  RegulatorySource,
  Report,
  VeximReviewRequest,
} from "../src/lib/types";
let db: PGlite;
beforeAll(async () => {
  db = await createDatabase();
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("reset role; begin");
});
afterEach(async () => {
  await db.exec("rollback; reset role");
});
async function query(sql: string, args: unknown[] = []) {
  await db.exec("savepoint test_query");
  try {
    const result = await db.query<Record<string, unknown>>(sql, args);
    await db.exec("release savepoint test_query");
    return result;
  } catch (e) {
    await db.exec(
      "rollback to savepoint test_query; release savepoint test_query",
    );
    throw e;
  }
}
async function currentRegistry() {
  await actor(db, ids.regA);
  const rows = (
    await db.query<RegulatorySource>("select * from public.regulatory_sources")
  ).rows;
  // FDA Guidance stays DRAFT until parser output receives its dedicated expert review.
  // These generic registry lifecycle tests use only regulation sources as synthetic fixtures.
  const promotable = rows.filter(
    (source) =>
      !(source.authority === "FDA" && source.document_type === "guidance"),
  );
  for (const source of promotable)
    await call(db, "vexim_save_source", [
      {
        ...source,
        content_excerpt:
          "SYNTHETIC QA TEXT ONLY. Not a legal source. This PostgreSQL fixture checks hashes, independent approvals, source versioning and report gates.",
        retrieved_at: new Date().toISOString(),
        effective_from: null,
        effective_to: null,
      },
    ]);
  await actor(db, ids.regB);
  for (const source of promotable)
    await call(db, "vexim_approve_source", [source.id]);
}
async function activateRules() {
  await currentRegistry();
  await actor(db, ids.regA);
  const rules = (
    await db.query<ComplianceRule>("select * from public.compliance_rules")
  ).rows;
  const currentSourceIds = new Set(
    (
      await db.query<{ id: string }>(
        "select id from public.regulatory_sources where status='CURRENT' and approved_by is not null",
      )
    ).rows.map((source) => source.id),
  );
  const fallbackCitation = (
    await db.query<{ id: string }>(
      "select id from public.regulatory_sources where status='CURRENT' and authority='eCFR' order by source_key limit 1",
    )
  ).rows[0]?.id;
  if (!fallbackCitation)
    throw new Error("Synthetic eCFR fixture is unavailable.");
  for (const rule of rules) {
    const citations = rule.source_citations.filter((id) =>
      currentSourceIds.has(id),
    );
    await call(db, "vexim_save_rule", [
      {
        ...rule,
        source_citations: citations.length ? citations : [fallbackCitation],
      },
    ]);
  }
  await actor(db, null, "service_role");
  for (const rule of rules) {
    const fresh = (
      await db.query<ComplianceRule>(
        "select * from public.compliance_rules where id=$1",
        [rule.id],
      )
    ).rows[0];
    const refs = await call(db, "app_source_refs", [
      `{${fresh.source_citations.join(",")}}`,
    ]);
    await call(db, "vexim_record_rule_test", [
      fresh.id,
      fresh.definition_hash,
      refs,
      RULE_CATALOG.map((r) => ({ rule_key: r.rule_key, passed: true })),
      ids.regA,
    ]);
  }
  await actor(db, ids.regB);
  for (const rule of rules) await call(db, "vexim_approve_rule", [rule.id]);
}
async function readyReview() {
  const state = await submit(db);
  await activateRules();
  await actor(db, null, "service_role");
  const job = await call<{ id: string }>(db, "vexim_claim_job", [
    "test-worker",
  ]);
  await call(db, "vexim_mark_file_scanned", [
    job.id,
    "test-worker",
    state.label.original_files[0].id,
    "clean",
    1,
  ]);
  const rules = (
    await db.query<ComplianceRule>(
      "select * from public.compliance_rules order by rule_key",
    )
  ).rows;
  const refs = rules.map((r) => ({
    rule_key: r.rule_key,
    version: r.version,
    source_versions: r.source_snapshot,
  }));
  await call(db, "vexim_complete_rules", [
    job.id,
    "test-worker",
    [],
    refs,
    "{}",
    "AI_REVIEW_READY",
  ]);
  return { ...state, job, refs };
}
async function createVeximRequest(state: Awaited<ReturnType<typeof readyReview>>) {
  await actor(db, ids.customerA);
  const request = await call<VeximReviewRequest>(
    db,
    "vexim_create_review_request",
    [state.review.id],
  );
  return request;
}
async function startVeximRequest(request: VeximReviewRequest) {
  await actor(db, ids.reviewer);
  return call<VeximReviewRequest>(db, "vexim_start_review_request", [request.id]);
}

describe("PostgreSQL migrations and tenant/RBAC boundaries", () => {
  it("seeds 12 DRAFT sources and 15 DRAFT rules without fabricated legal hashes", async () => {
    await actor(db, null, "service_role");
    const sources = (
      await db.query<Record<string, unknown>>(
        "select status,content_hash,retrieved_at from public.regulatory_sources",
      )
    ).rows;
    expect(sources).toHaveLength(12);
    expect(
      sources.every(
        (s) =>
          s.status === "DRAFT" &&
          s.content_hash === null &&
          s.retrieved_at === null,
      ),
    ).toBe(true);
    const rules = (
      await db.query<Record<string, unknown>>(
        "select * from public.compliance_rules",
      )
    ).rows;
    expect(rules).toHaveLength(15);
    const diseaseRule = (
      await db.query<{ action_json: Record<string, unknown> }>(
        "select action_json from public.compliance_rules where rule_key='CLAIM-001'",
      )
    ).rows[0];
    expect(diseaseRule.action_json.severity).toBe("information");
    expect(diseaseRule.action_json.suggested_action).toContain(
      "không kết luận vi phạm",
    );
  });
  it("keeps pre-screening off by default and requires a staging-only system-admin allowlist", async () => {
    await actor(db, null, "service_role");
    expect(await call(db, "vexim_pre_screening_allowed", [ids.orgA])).toBe(
      false,
    );

    await actor(db, ids.admin);
    await call(db, "vexim_set_triage_pre_screening", [
      true,
      "staging",
      [ids.orgA],
    ]);
    await actor(db, null, "service_role");
    expect(await call(db, "vexim_pre_screening_allowed", [ids.orgA])).toBe(
      true,
    );
    expect(await call(db, "vexim_pre_screening_allowed", [ids.orgB])).toBe(
      false,
    );

    await actor(db, ids.admin);
    await expect(
      call(db, "vexim_set_triage_pre_screening", [
        true,
        "production",
        [ids.orgA],
      ]),
    ).rejects.toThrow(/staging/i);
  });
  it("persists AUTO_SCREENED only as a separate pre-screening artifact behind the staging allowlist", async () => {
    const state = await submit(db);
    await actor(db, ids.admin);
    await call(db, "vexim_set_triage_pre_screening", [
      true,
      "staging",
      [ids.orgA],
    ]);
    await actor(db, null, "service_role");
    const job = await call<{ id: string }>(db, "vexim_claim_job", [
      "triage-artifact-test",
    ]);
    await call(db, "vexim_mark_file_scanned", [
      job.id,
      "triage-artifact-test",
      state.label.original_files[0].id,
      "clean",
      1,
    ]);
    const evaluatedAt = new Date().toISOString();
    const triage = {
      triage_route: "AUTO_SCREENED",
      overall_result: "NO_AUTOMATED_ISSUE_DETECTED",
      report_status: "PRE_SCREENING_ISSUED",
      expert_review_status: "NOT_REQUIRED",
      policy_version: "risk-based-triage/1.0.0",
      risk_score: 0,
      evaluated_at: evaluatedAt,
      reasons: [],
      customer_questions: [],
    };
    const artifact = {
      schema_version: "pre-screening/1.0.0",
      disclaimer_profile: "PRE_SCREENING_ONLY",
      triage_route: "AUTO_SCREENED",
      overall_result: "NO_AUTOMATED_ISSUE_DETECTED",
      disclaimer: {
        vi: "Chỉ là kết quả sàng lọc sơ bộ tự động.",
        en: "Automated pre-screening only.",
      },
      findings: [],
    };
    await call(db, "vexim_complete_triage", [
      job.id,
      "triage-artifact-test",
      [],
      [],
      "{}",
      triage,
      artifact,
    ]);
    const review = (
      await db.query<Record<string, unknown>>(
        "select status,triage_route,overall_result,report_status,expert_review_status from public.reviews where id=$1",
        [state.review.id],
      )
    ).rows[0];
    expect(review).toMatchObject({
      status: "AI_REVIEW_READY",
      triage_route: "AUTO_SCREENED",
      overall_result: "NO_AUTOMATED_ISSUE_DETECTED",
      report_status: "PRE_SCREENING_ISSUED",
      expert_review_status: "NOT_REQUIRED",
    });
    expect(
      (await db.query("select * from public.pre_screening_reports")).rows,
    ).toHaveLength(1);
    expect((await db.query("select * from public.reports")).rows).toHaveLength(
      0,
    );
    await expect(
      query("delete from public.pre_screening_reports where review_id=$1", [
        state.review.id,
      ]),
    ).rejects.toThrow(/append-only/);
  });
  it("ignores spoofed staff roles in auth user metadata", async () => {
    await actor(db, ids.customerA);
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select staff_role from public.profiles where id=$1",
          [ids.customerA],
        )
      ).rows[0].staff_role,
    ).toBeNull();
  });
  it("isolates products, dossiers and customer registries", async () => {
    const { product } = await submit(db);
    await actor(db, ids.customerB);
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select * from public.products where id=$1",
          [product.id],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select * from public.compliance_rules",
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select * from public.regulatory_sources",
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      call(db, "vexim_save_product", [
        { ...productDraft(ids.orgA), id: product.id },
      ]),
    ).rejects.toThrow(/Tenant access denied/);
  });
  it("unaffiliated customers cannot exploit nullable staff roles to edit another organization", async () => {
    await actor(db, ids.outsider);
    expect(await call(db, "app_can_read_org", [ids.orgA])).toBe(false);
    expect(await call(db, "app_can_admin_org", [ids.orgA])).toBe(false);
    await expect(
      call(db, "vexim_save_organization", [
        { id: ids.orgA, name: "Hijack", contact_email: "evil@test.example" },
      ]),
    ).rejects.toThrow(/admin required/);
    await expect(
      call(db, "vexim_add_invited_member", [
        ids.orgA,
        ids.outsider,
        "customer_admin",
      ]),
    ).rejects.toThrow();
  });
  it("blocks customer direct writes, audit tampering and privileged helper calls", async () => {
    const { product } = await submit(db);
    await expect(
      query("update public.products set name=$1 where id=$2", [
        "Tamper",
        product.id,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(call(db, "app_product_json", [product.id])).rejects.toThrow(
      /permission denied/,
    );
    await actor(db, null, "service_role");
    await expect(
      query("update public.audit_logs set action='tampered'"),
    ).rejects.toThrow(/append-only/);
  });
  it("blocks anonymous reads and worker calls", async () => {
    await actor(db, null, "anon");
    await expect(query("select * from public.products")).rejects.toThrow(
      /permission denied/,
    );
    await expect(call(db, "vexim_claim_job", ["rogue"])).rejects.toThrow(
      /permission denied/,
    );
  });
  it("does not grant a system admin legal-authoring or reviewer approval rights", async () => {
    await actor(db, ids.admin);
    await expect(
      call(db, "vexim_save_rule", [RULE_CATALOG[0]]),
    ).rejects.toThrow(/Insufficient role/);
    await expect(
      call(db, "vexim_approve_report", [
        randomUUID(),
        randomUUID(),
        "This is not FDA approval.",
      ]),
    ).rejects.toThrow(/Insufficient role/);
  });
  it("allows contributor uploads but never approval", async () => {
    await actor(db, ids.contributor);
    const product = await call<{ id: string }>(db, "vexim_save_product", [
      productDraft(),
    ]);
    expect(product.id).toBeTruthy();
    await expect(
      call(db, "vexim_approve_report", [
        randomUUID(),
        randomUUID(),
        "Reviewed the label by a contributor.",
      ]),
    ).rejects.toThrow(/Insufficient role/);
  });
  it("requires confirmed invitations and protects the last active customer admin", async () => {
    await actor(db, ids.customerA);
    await call(db, "vexim_add_invited_member", [
      ids.orgA,
      ids.outsider,
      "customer_contributor",
    ]);
    await actor(db, null, "service_role");
    await db.query<Record<string, unknown>>(
      "update auth.users set email_confirmed_at=null where id=$1",
      [ids.outsider],
    );
    await actor(db, ids.outsider);
    await call(db, "vexim_accept_memberships");
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select * from public.organization_members",
        )
      ).rows,
    ).toHaveLength(0);
    await actor(db, null, "service_role");
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select status from public.organization_members where user_id=$1",
          [ids.outsider],
        )
      ).rows[0].status,
    ).toBe("invited");
    await db.query<Record<string, unknown>>(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [ids.outsider],
    );
    await actor(db, ids.outsider);
    await call(db, "vexim_accept_memberships");
    expect(await call(db, "app_can_read_org", [ids.orgA])).toBe(true);
    await actor(db, ids.customerA);
    const member = (
      await db.query<Record<string, unknown>>(
        "select id from public.organization_members where user_id=$1",
        [ids.customerA],
      )
    ).rows[0];
    await expect(
      call(db, "vexim_set_member_status", [member.id, "locked"]),
    ).rejects.toThrow(/cannot self-lock|last active/i);
  });
});

describe("Immutable intake and private Storage policies", () => {
  it("makes review submission idempotent and freezes the submitted dossier", async () => {
    const state = await submit(db);
    const again = await call<{ id: string }>(db, "vexim_submit_review", [
      state.label.id,
      "different-idempotency",
    ]);
    expect(again.id).toBe(state.review.id);
    await call(db, "vexim_save_product", [
      {
        ...productDraft(),
        id: state.product.id,
        name: "Changed current product",
      },
    ]);
    const r = (
      await db.query<{ dossier_snapshot: { name: string } }>(
        "select dossier_snapshot from public.reviews where id=$1",
        [state.review.id],
      )
    ).rows[0];
    expect(r.dossier_snapshot.name).toBe("Green tea");
    await actor(db, null, "service_role");
    await expect(
      query("update public.reviews set dossier_snapshot='{}' where id=$1", [
        state.review.id,
      ]),
    ).rejects.toThrow(/immutable/);
  });
  it("rejects incomplete intake and missing uploaded originals", async () => {
    await actor(db, ids.customerA);
    const p = await call<{ id: string }>(db, "vexim_save_product", [
      { ...productDraft(), brand: "" },
    ]);
    const l = await call<{ id: string }>(db, "vexim_create_label_version", [
      p.id,
      [
        {
          id: randomUUID(),
          name: "a.png",
          mime_type: "image/png",
          size: 100,
          sha256: "a".repeat(64),
          page_count: 1,
        },
      ],
    ]);
    await expect(
      call(db, "vexim_submit_review", [l.id, "missing"]),
    ).rejects.toThrow(/Incomplete intake/);
    await call(db, "vexim_save_product", [{ ...productDraft(), id: p.id }]);
    await expect(
      call(db, "vexim_submit_review", [l.id, "missing"]),
    ).rejects.toThrow(/upload incomplete/);
  });
  it("preserves supplied manifest IDs and blocks original overwrite/delete", async () => {
    const state = await submit(db);
    await actor(db, null, "service_role");
    await expect(
      query("update public.label_files set sha256=$1 where id=$2", [
        "b".repeat(64),
        state.label.original_files[0].id,
      ]),
    ).rejects.toThrow(/immutable/);
    await expect(
      query("delete from public.label_files where id=$1", [
        state.label.original_files[0].id,
      ]),
    ).rejects.toThrow(/immutable/);
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select id from public.label_files where id=$1",
          [state.label.original_files[0].id],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("hides unscanned and cross-tenant Storage objects, including dev bypasses", async () => {
    const state = await submit(db);
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select * from storage.objects where bucket_id='label-originals'",
        )
      ).rows,
    ).toHaveLength(0);
    await actor(db, null, "service_role");
    const job = await call<{ id: string }>(db, "vexim_claim_job", [
      "scan-worker",
    ]);
    await call(db, "vexim_mark_file_scanned", [
      job.id,
      "scan-worker",
      state.label.original_files[0].id,
      "dev_unscanned",
      1,
    ]);
    await actor(db, ids.customerA);
    expect(
      (await db.query<Record<string, unknown>>("select * from storage.objects"))
        .rows,
    ).toHaveLength(0);
    await expect(
      call(db, "vexim_log_file_access", [
        state.label.original_files[0].id,
        "signed_url",
      ]),
    ).rejects.toThrow(/unavailable/);
    await actor(db, null, "service_role");
    await call(db, "vexim_mark_file_scanned", [
      job.id,
      "scan-worker",
      state.label.original_files[0].id,
      "clean",
      1,
    ]);
    await actor(db, ids.customerA);
    expect(
      (await db.query<Record<string, unknown>>("select * from storage.objects"))
        .rows,
    ).toHaveLength(1);
    await actor(db, ids.customerB);
    expect(
      (await db.query<Record<string, unknown>>("select * from storage.objects"))
        .rows,
    ).toHaveLength(0);
  });
  it("classifies liquids as outside dry-tea MVP", async () => {
    await actor(db, ids.customerA);
    const p = await call<{ classification_status: string }>(
      db,
      "vexim_save_product",
      [{ ...productDraft(), form: "liquid" }],
    );
    expect(p.classification_status).toBe("out_of_scope");
  });
});

describe("Lease-checked queue and pipeline persistence", () => {
  it("claims once, checks worker ownership, heartbeats and bounded retry/dead-letter", async () => {
    const state = await submit(db);
    await actor(db, null, "service_role");
    const job = await call<{ id: string; attempts: number }>(
      db,
      "vexim_claim_job",
      ["worker-a"],
    );
    expect(job.attempts).toBe(1);
    expect(await call(db, "vexim_claim_job", ["worker-b"])).toBeNull();
    expect(await call(db, "vexim_heartbeat_job", [job.id, "worker-b"])).toBe(
      false,
    );
    await expect(
      call(db, "vexim_mark_file_scanned", [
        job.id,
        "worker-b",
        state.label.original_files[0].id,
        "clean",
        1,
      ]),
    ).rejects.toThrow(/Lease/);
    for (let n = 1; n <= 3; n++) {
      await call(db, "vexim_fail_job", [
        job.id,
        "worker-a",
        "A test transient error",
        false,
      ]);
      if (n < 3) {
        await db.query<Record<string, unknown>>(
          "update public.pipeline_jobs set next_run_at=now() where id=$1",
          [job.id],
        );
        const next = await call<{ attempts: number }>(db, "vexim_claim_job", [
          "worker-a",
        ]);
        expect(next.attempts).toBe(n + 1);
      }
    }
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select status,attempts from public.pipeline_jobs where id=$1",
          [job.id],
        )
      ).rows[0],
    ).toMatchObject({ status: "dead_letter", attempts: 3 });
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select status from public.reviews where id=$1",
          [state.review.id],
        )
      ).rows[0].status,
    ).toBe("PROCESSING_FAILED");
  });
  it("stores normalized hashes idempotently and rejects invalid extraction evidence transactionally", async () => {
    const state = await submit(db);
    await actor(db, null, "service_role");
    const j = await call<{ id: string }>(db, "vexim_claim_job", ["worker"]);
    await call(db, "vexim_mark_file_scanned", [
      j.id,
      "worker",
      state.label.original_files[0].id,
      "clean",
      1,
    ]);
    const manifest = [
      {
        original_file_id: state.label.original_files[0].id,
        name: "page.png",
        page: 1,
        size: 99,
        sha256: "b".repeat(64),
      },
    ];
    const first = await call<{ id: string }[]>(db, "vexim_store_normalized", [
      j.id,
      "worker",
      manifest,
    ]);
    const second = await call<{ id: string }[]>(db, "vexim_store_normalized", [
      j.id,
      "worker",
      manifest,
    ]);
    expect(second[0].id).toBe(first[0].id);
    await expect(
      call(db, "vexim_save_pipeline_output", [
        j.id,
        "worker",
        "extraction",
        {
          fields: [
            {
              field: "net_quantity",
              value: null,
              confidence: 0.4,
              evidence: {
                file_id: randomUUID(),
                page: 1,
                bbox: null,
                text: "Not observed",
              },
              extraction_model: "test",
            },
          ],
        },
      ]),
    ).rejects.toThrow(/mismatch/);
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select * from public.extracted_fields",
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select * from public.pipeline_outputs",
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("cannot open Vexim Review, complete to COMPLETED or autoapprove any report from worker", async () => {
    await submit(db);
    await actor(db, null, "service_role");
    const j = await call<{ id: string }>(db, "vexim_claim_job", ["worker"]);
    await expect(
      call(db, "vexim_complete_rules", [j.id, "worker", [], [], "{}", "HUMAN_REVIEW"]),
    ).rejects.toThrow(/cannot open Vexim Review/i);
    await expect(
      call(db, "vexim_complete_rules", [j.id, "worker", [], [], "{}", "COMPLETED"]),
    ).rejects.toThrow(/cannot open Vexim Review or approve/i);
  });
});

describe("Registry QA, independent approvals, and final report gates", () => {
  it("requires fetched content/hash and independent source approval", async () => {
    await actor(db, ids.regA);
    const source = (
      await db.query<RegulatorySource>(
        "select * from public.regulatory_sources limit 1",
      )
    ).rows[0];
    await expect(
      call(db, "vexim_approve_source", [source.id]),
    ).rejects.toThrow();
    const saved = await call<RegulatorySource>(db, "vexim_save_source", [
      {
        ...source,
        content_excerpt:
          "SYNTHETIC QA excerpt repeated for database hashing and legal registry versioning tests only. This is not law or legal advice.",
        retrieved_at: new Date().toISOString(),
      },
    ]);
    expect(saved.content_hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(call(db, "vexim_approve_source", [source.id])).rejects.toThrow(
      /Independent/,
    );
    await actor(db, ids.regB);
    await call(db, "vexim_approve_source", [source.id]);
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select status from public.regulatory_sources where id=$1",
          [source.id],
        )
      ).rows[0].status,
    ).toBe("CURRENT");
  });
  it("cannot self-approve a rule or activate it with stale source test snapshots", async () => {
    await currentRegistry();
    await actor(db, ids.regA);
    const rule = await call<ComplianceRule>(db, "vexim_save_rule", [
      RULE_CATALOG[0],
    ]);
    await actor(db, null, "service_role");
    const refs = await call(db, "app_source_refs", [
      `{${rule.source_citations.join(",")}}`,
    ]);
    await call(db, "vexim_record_rule_test", [
      rule.id,
      rule.definition_hash,
      refs,
      RULE_CATALOG.map((r) => ({ rule_key: r.rule_key, passed: true })),
      ids.regA,
    ]);
    await actor(db, ids.regA);
    await expect(call(db, "vexim_approve_rule", [rule.id])).rejects.toThrow(
      /Independent/,
    );
    const source = (
      await db.query<RegulatorySource>(
        "select * from public.regulatory_sources where id=$1",
        [rule.source_citations[0]],
      )
    ).rows[0];
    await call(db, "vexim_save_source", [
      {
        ...source,
        content_excerpt: source.content_excerpt + " New test version.",
      },
    ]);
    await actor(db, ids.regB);
    await expect(call(db, "vexim_approve_rule", [rule.id])).rejects.toThrow(
      /fresh regression/,
    );
  });
  it("requires an exact in-progress Vexim request, clean originals, complete rules and reviewer role to approve reports", async () => {
    const state = await readyReview();
    const request = await createVeximRequest(state);
    await actor(db, ids.reviewer);
    await expect(
      call(db, "vexim_approve_report", [
        state.review.id,
        randomUUID(),
        "Reviewed evidence; preliminary review only.",
      ]),
    ).rejects.toThrow(/VeximReviewRequest/);
    await startVeximRequest(request);
    await actor(db, null, "service_role");
    await db.query<Record<string, unknown>>(
      "update public.label_files set scan_status='dev_unscanned' where id=$1",
      [state.label.original_files[0].id],
    );
    await actor(db, ids.reviewer);
    await expect(
      call(db, "vexim_approve_report", [
        state.review.id,
        request.id,
        "Reviewed evidence; preliminary review only.",
      ]),
    ).rejects.toThrow(/malware scan/);
    await actor(db, null, "service_role");
    await db.query<Record<string, unknown>>(
      "update public.label_files set scan_status='clean' where id=$1",
      [state.label.original_files[0].id],
    );
    await actor(db, ids.reviewer);
    const report = await call<Report>(db, "vexim_approve_report", [
      state.review.id,
      request.id,
      "Reviewed evidence; preliminary review only.",
    ]);
    expect(report.vexim_review_request_id).toBe(request.id);
    expect(report.artwork_sha256).toBe(request.artwork_hash);
    expect(report.snapshot.vexim_review_request).toMatchObject({
      id: request.id,
      requested_by: ids.customerA,
      requested_role: "label_owner",
      label_version_id: state.label.id,
      artwork_hash: request.artwork_hash,
    });
    expect(report.snapshot.demo).toBe(false);
    expect(report.snapshot.product.name).toBe("Green tea");
    expect(report.snapshot.disclaimer).toContain("not FDA approval");
    expect(report.snapshot.schema_version).toBe("1.2");
    expect(report.snapshot.approved_by).toBe(ids.reviewer);
    expect(report.snapshot.disposition).toBe(report.snapshot.result);
    expect(report.snapshot.rationale).toBe(
      "Reviewed evidence; preliminary review only.",
    );
    const persistedReview = (
      await db.query<Record<string, unknown>>(
        "select status,approved_by,approved_at,approval_comment from public.reviews where id=$1",
        [state.review.id],
      )
    ).rows[0];
    expect(persistedReview).toMatchObject({
      status: "APPROVED_WITH_NOTES",
      approved_by: ids.reviewer,
      approval_comment: "Reviewed evidence; preliminary review only.",
    });
    expect(persistedReview.approved_at).toBeTruthy();
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select overall_result,report_status,expert_review_status from public.reviews where id=$1",
          [state.review.id],
        )
      ).rows[0],
    ).toMatchObject({
      overall_result: "NO_ISSUE_DETECTED_IN_SCOPE",
      report_status: "FINAL_REPORT_ISSUED",
      expert_review_status: "NOT_REQUIRED",
    });
    expect(
      (
        await query(
          "select status,completed_at from public.vexim_review_requests where id=$1",
          [request.id],
        )
      ).rows[0],
    ).toMatchObject({ status: "COMPLETED" });
    await actor(db, null, "service_role");
    await expect(
      query("update public.reports set snapshot='{}' where id=$1", [report.id]),
    ).rejects.toThrow(/immutable/);
  });
  it("blocks approval when the active legal rule version changes after review", async () => {
    const state = await readyReview();
    const request = await createVeximRequest(state);
    await actor(db, null, "service_role");
    await db.query<Record<string, unknown>>(
      "update public.compliance_rules set status='SUPERSEDED' where rule_key='IDENTITY-001'",
    );
    await startVeximRequest(request);
    await expect(
      call(db, "vexim_approve_report", [
        state.review.id,
        request.id,
        "Reviewed evidence; preliminary review only.",
      ]),
    ).rejects.toThrow(/Ruleset changed/);
  });
});

describe("Explicit VeximReviewRequest lifecycle and exact artwork binding", () => {
  it("does not infer a request from readiness or reviewer transitions; only the owner can create an immutable server-hashed request", async () => {
    const state = await readyReview();
    await actor(db, ids.reviewer);
    await expect(
      call(db, "vexim_transition_review", [
        state.review.id,
        "HUMAN_REVIEW",
        "Try to open Vexim without a request.",
      ]),
    ).rejects.toThrow(/IN_PROGRESS VeximReviewRequest is required/i);
    await expect(
      call(db, "vexim_approve_report", [
        state.review.id,
        randomUUID(),
        "Reviewed evidence; preliminary review only.",
      ]),
    ).rejects.toThrow(/VeximReviewRequest/);

    await actor(db, ids.customerB);
    await expect(
      call(db, "vexim_create_review_request", [state.review.id]),
    ).rejects.toThrow(/Only the label owner or active commercial importer admin/i);
    await actor(db, ids.contributor);
    await expect(
      call(db, "vexim_create_review_request", [state.review.id]),
    ).rejects.toThrow(/Only the label owner or active commercial importer admin/i);

    await actor(db, ids.customerA);
    const request = await call<VeximReviewRequest>(
      db,
      "vexim_create_review_request",
      [state.review.id],
    );
    expect(request).toMatchObject({
      review_id: state.review.id,
      organization_id: ids.orgA,
      requested_by: ids.customerA,
      requested_role: "label_owner",
      label_version_id: state.label.id,
      status: "REQUESTED",
      reviewer_id: null,
      started_at: null,
      completed_at: null,
    });
    expect(request.requested_at).toBeTruthy();
    expect(request.artwork_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(request.artwork_hash).not.toBe("a".repeat(64));

    await actor(db, null, "service_role");
    await expect(
      query("update public.vexim_review_requests set requested_by=$1 where id=$2", [
        ids.customerB,
        request.id,
      ]),
    ).rejects.toThrow(/identity, requester and artwork binding are immutable/);
    await actor(db, ids.customerA);
    await expect(
      query(
        "insert into public.vexim_review_requests(review_id,organization_id,requested_by,requested_role,label_version_id,artwork_hash) values($1,$2,$3,'label_owner',$4,$5)",
        [state.review.id, ids.orgA, ids.customerA, state.label.id, "c".repeat(64)],
      ),
    ).rejects.toThrow(/permission denied/i);
    await actor(db, null, "service_role");
    expect(
      (
        await query(
          "select count(*)::integer as count from public.vexim_review_requests where review_id=$1",
          [state.review.id],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("lets an active commercial importer request only after sharing and preserves the v3 request when v4 is uploaded", async () => {
    const state = await readyReview();
    await actor(db, ids.customerA);
    const participant = await call<{ id: string }>(
      db,
      "vexim_invite_review_participant",
      [state.review.id, ids.orgB, "commercial_importer"],
    );
    await actor(db, ids.customerB);
    await call(db, "vexim_accept_review_participant", [participant.id]);
    await expect(
      call(db, "vexim_create_review_request", [state.review.id]),
    ).rejects.toThrow(/Only the label owner or active commercial importer admin/i);

    await actor(db, ids.customerA);
    await call(db, "vexim_record_party_decision", [
      state.review.id,
      "label_owner",
      "accepted",
      "Owner accepted this exact version.",
      [],
    ]);
    await call(db, "vexim_share_review_with_importer", [
      state.review.id,
      "Share this exact label version with the importer.",
    ]);
    await actor(db, ids.customerB);
    const request = await call<VeximReviewRequest>(
      db,
      "vexim_create_review_request",
      [state.review.id],
    );
    expect(request).toMatchObject({
      requested_by: ids.customerB,
      requested_role: "commercial_importer",
      label_version_id: state.label.id,
      status: "REQUESTED",
    });

    await actor(db, ids.customerA);
    const labelV4 = await call<{
      id: string;
      original_files: { storage_path: string }[];
    }>(db, "vexim_create_label_version", [
      state.product.id,
      [
        {
          id: randomUUID(),
          name: "test-v4.png",
          mime_type: "image/png",
          size: 120,
          sha256: "b".repeat(64),
          page_count: 1,
        },
      ],
    ]);
    for (const file of labelV4.original_files)
      await query(
        "insert into storage.objects(bucket_id,name,owner) values('label-originals',$1,$2)",
        [file.storage_path, ids.customerA],
      );
    const reviewV4 = await call<{ id: string }>(db, "vexim_submit_review", [
      labelV4.id,
      `${labelV4.id}:v4`,
    ]);
    await actor(db, null, "service_role");
    const persistedRequest = (
      await query(
        "select * from public.vexim_review_requests where id=$1",
        [request.id],
      )
    ).rows[0];
    expect(persistedRequest).toMatchObject({
      id: request.id,
      label_version_id: state.label.id,
      artwork_hash: request.artwork_hash,
      requested_role: "commercial_importer",
      status: "REQUESTED",
    });
    expect(persistedRequest.label_version_id).not.toBe(labelV4.id);
    expect(
      (
        await query(
          "select count(*)::integer as count from public.vexim_review_requests where review_id=$1",
          [reviewV4.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
});

describe("Assignment, account privacy and expired leases", () => {
  it("allows reviewer self-claim and system assignments only after an explicit request, but blocks customer/foreign staff targets", async () => {
    const state = await readyReview();
    const { review, product } = state;
    await createVeximRequest(state);
    await expect(
      call(db, "vexim_assign_review", [
        review.id,
        ids.reviewer,
        "Assign a real reviewer.",
      ]),
    ).rejects.toThrow(/Reviewer or system admin/i);
    await actor(db, ids.reviewer);
    await call(db, "vexim_assign_review", [
      review.id,
      ids.reviewer,
      "I take ownership of this review.",
    ]);
    expect(
      (
        await query("select assigned_to from public.reviews where id=$1", [
          review.id,
        ])
      ).rows[0].assigned_to,
    ).toBe(ids.reviewer);
    expect(
      (
        await query("select assigned_to from public.products where id=$1", [
          product.id,
        ])
      ).rows[0].assigned_to,
    ).toBe(ids.reviewer);
    await expect(
      call(db, "vexim_assign_review", [
        review.id,
        ids.regA,
        "Assign another person.",
      ]),
    ).rejects.toThrow(/active reviewer|own task|role/i);
    await actor(db, ids.admin);
    await call(db, "vexim_assign_review", [
      review.id,
      ids.reviewer,
      "Trusted system assignment.",
    ]);
    await expect(
      call(db, "vexim_assign_review", [
        review.id,
        ids.admin,
        "System admin is not a reviewer.",
      ]),
    ).rejects.toThrow(/active reviewer/i);
  });
  it("does not resurrect expired leases or let stale workers write progress/failure", async () => {
    await submit(db);
    await actor(db, null, "service_role");
    const job = await call<{ id: string }>(db, "vexim_claim_job", [
      "worker-old",
    ]);
    await query(
      "update public.pipeline_jobs set locked_until=now()-interval '1 second' where id=$1",
      [job.id],
    );
    expect(await call(db, "vexim_heartbeat_job", [job.id, "worker-old"])).toBe(
      false,
    );
    await expect(
      call(db, "vexim_set_job_progress", [
        job.id,
        "worker-old",
        "ocr",
        JSON.stringify(Array.from({ length: 5 }, () => ({}))),
        10,
      ]),
    ).rejects.toThrow(/lease/i);
    await expect(
      call(db, "vexim_fail_job", [
        job.id,
        "worker-old",
        "Stale failure must not mutate the job.",
        true,
      ]),
    ).rejects.toThrow(/lease/i);
    expect(
      (
        await query("select status from public.pipeline_jobs where id=$1", [
          job.id,
        ])
      ).rows[0].status,
    ).toBe("running");
    const newJob = await call<{ id: string; attempts: number }>(
      db,
      "vexim_claim_job",
      ["worker-new"],
    );
    expect(newJob).toMatchObject({ id: job.id, attempts: 2 });
  });
  it("scopes customer account audit to memberships without putting customer PII into global logs", async () => {
    await actor(db, null, "service_role");
    await query("update public.profiles set active=false where id=$1", [
      ids.customerA,
    ]);
    const logs = (
      await query(
        "select organization_id,metadata from public.audit_logs where entity_id=$1",
        [ids.customerA],
      )
    ).rows;
    expect(logs).toHaveLength(1);
    expect(logs[0].organization_id).toBe(ids.orgA);
    expect(JSON.stringify(logs[0].metadata)).not.toMatch(
      /email|full_name|customer-a@/i,
    );
    await query(
      "update public.profiles set staff_role='reviewer' where id=$1",
      [ids.customerA],
    );
    const global = (
      await query(
        "select metadata from public.audit_logs where entity_id=$1 and organization_id is null",
        [ids.customerA],
      )
    ).rows;
    expect(global).toHaveLength(1);
    expect(JSON.stringify(global[0].metadata)).not.toMatch(
      /email|full_name|customer-a@/i,
    );
  });
  it("system admin cannot lock the final active customer admin either", async () => {
    await actor(db, ids.admin);
    const member = (
      await query(
        "select id from public.organization_members where user_id=$1 and organization_id=$2",
        [ids.customerA, ids.orgA],
      )
    ).rows[0];
    await expect(
      call(db, "vexim_set_member_status", [member.id, "locked"]),
    ).rejects.toThrow(/last customer admin/i);
  });
});

describe("Collaborative review parties and version-bound decisions", () => {
  it("keeps an importer invitation private until accepted and the owner shares the review", async () => {
    const { review, product, label } = await submit(db);
    const unrelated = await call<{ id: string }>(
      db,
      "vexim_save_product",
      [{ ...productDraft(ids.orgA), name: "Unrelated owner product" }],
    );

    await actor(db, null, "service_role");
    const authUserCount = (
      await query("select count(*)::integer as count from auth.users")
    ).rows[0].count;
    await actor(db, ids.customerA);
    await expect(
      call(db, "vexim_invite_review_participant_by_email", [
        review.id,
        "unknown@test.example",
        "commercial_importer",
      ]),
    ).rejects.toThrow(/no unique active organization/i);
    await actor(db, null, "service_role");
    expect(
      (
        await query("select count(*)::integer as count from auth.users")
      ).rows[0].count,
    ).toBe(authUserCount);
    await actor(db, ids.customerA);
    const participant = await call<{
      id: string;
      status: string;
      party_role: string;
    }>(db, "vexim_invite_review_participant_by_email", [
      review.id,
      "B@test.example",
      "commercial_importer",
    ]);
    expect(participant).toMatchObject({
      status: "invited",
      party_role: "commercial_importer",
      organization_id: ids.orgB,
    });

    await actor(db, ids.customerB);
    expect(await call(db, "app_can_access_review", [review.id])).toBe(false);
    expect(
      (
        await query("select id from public.reviews where id=$1", [review.id])
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await query(
          "select id from public.review_participants where id=$1",
          [participant.id],
        )
      ).rows,
    ).toHaveLength(1);

    await call(db, "vexim_accept_review_participant", [participant.id]);
    expect(await call(db, "app_can_access_review", [review.id])).toBe(false);

    await actor(db, null, "service_role");
    await query("update public.reviews set status='AI_REVIEW_READY' where id=$1", [
      review.id,
    ]);
    await query(
      "update public.label_files set scan_status='clean' where label_version_id=$1 and kind='original'",
      [label.id],
    );

    await actor(db, ids.customerA);
    const ownerDecision = await call<{
      decision: string;
      label_bundle_sha256: string;
    }>(db, "vexim_record_party_decision", [
      review.id,
      "label_owner",
      "accepted",
      "Doanh nghiệp đã rà soát bản nhãn này.",
      [],
    ]);
    expect(ownerDecision.decision).toBe("accepted");
    expect(ownerDecision.label_bundle_sha256).toMatch(/^[a-f0-9]{64}$/);
    await call(db, "vexim_share_review_with_importer", [
      review.id,
      "Chia sẻ phiên bản đã được doanh nghiệp rà soát.",
    ]);

    await actor(db, ids.customerB);
    expect(await call(db, "app_can_read_org", [ids.orgA])).toBe(false);
    expect(await call(db, "app_can_access_review", [review.id])).toBe(true);
    expect(
      (
        await query("select id from public.products where id=$1", [product.id])
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await query("select id from public.products where id=$1", [unrelated.id])
      ).rows,
    ).toHaveLength(0);

    await call(db, "vexim_record_party_decision", [
      review.id,
      "commercial_importer",
      "accepted",
      "Importer đồng ý với chính phiên bản này.",
      [],
    ]);
    expect(
      (
        await query(
          "select collaboration_status,approved_by from public.reviews where id=$1",
          [review.id],
        )
      ).rows[0],
    ).toMatchObject({ collaboration_status: "mutually_accepted", approved_by: null });
    expect(
      (
        await query("select id from public.reports where review_id=$1", [
          review.id,
        ])
      ).rows,
    ).toHaveLength(0);

    await actor(db, ids.customerA);
    await call(db, "vexim_remove_review_participant", [
      participant.id,
      "Access ended after the collaboration cycle.",
    ]);
    await actor(db, ids.customerB);
    expect(await call(db, "app_can_access_review", [review.id])).toBe(false);
    expect(
      (
        await query("select id from public.reviews where id=$1", [review.id])
      ).rows,
    ).toHaveLength(0);
  });

  it("binds party acceptance to an immutable file hash and keeps decisions append-only", async () => {
    const { review, label } = await submit(db);
    await actor(db, ids.customerA);
    await call(db, "vexim_invite_review_participant", [
      review.id,
      ids.orgB,
      "commercial_importer",
    ]);
    const importer = (
      await query(
        "select id from public.review_participants where review_id=$1 and party_role='commercial_importer'",
        [review.id],
      )
    ).rows[0];
    await actor(db, ids.customerB);
    await call(db, "vexim_accept_review_participant", [importer.id]);
    await actor(db, null, "service_role");
    await query("update public.reviews set status='AI_REVIEW_READY' where id=$1", [
      review.id,
    ]);
    await query(
      "update public.label_files set scan_status='clean' where label_version_id=$1 and kind='original'",
      [label.id],
    );
    await actor(db, ids.customerA);
    const decision = await call<{ label_bundle_sha256: string }>(
      db,
      "vexim_record_party_decision",
      [
        review.id,
        "label_owner",
        "accepted",
        "Owner accepted the uploaded label version.",
        [],
      ],
    );
    await call(db, "vexim_share_review_with_importer", [
      review.id,
      "Share the exact owner-reviewed file bundle.",
    ]);
    await actor(db, null, "service_role");
    await expect(
      query("update public.label_files set sha256=$1 where label_version_id=$2", [
        "b".repeat(64),
        label.id,
      ]),
    ).rejects.toThrow(/immutable/i);
    await actor(db, ids.customerB);
    const importerDecision = await call<{ label_bundle_sha256: string }>(
      db,
      "vexim_record_party_decision",
      [
        review.id,
        "commercial_importer",
        "accepted",
        "Importer accepted the current file bundle.",
        [],
      ],
    );
    expect(importerDecision.label_bundle_sha256).toBe(
      decision.label_bundle_sha256,
    );

    await actor(db, null, "service_role");
    await expect(
      query("update public.review_party_decisions set comment='tampered' where review_id=$1", [
        review.id,
      ]),
    ).rejects.toThrow(/append-only/i);
    expect(decision.label_bundle_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stores importer edit proposals without changing canonical art or accepting the label", async () => {
    const { review, label } = await submit(db);
    await actor(db, ids.customerA);
    await call(db, "vexim_invite_review_participant", [
      review.id,
      ids.orgB,
      "commercial_importer",
    ]);
    const importer = (
      await query(
        "select id from public.review_participants where review_id=$1 and party_role='commercial_importer'",
        [review.id],
      )
    ).rows[0];
    await actor(db, ids.customerB);
    await call(db, "vexim_accept_review_participant", [importer.id]);
    await actor(db, null, "service_role");
    await query("update public.reviews set status='AI_REVIEW_READY' where id=$1", [
      review.id,
    ]);
    await query(
      "update public.label_files set scan_status='clean' where label_version_id=$1 and kind='original'",
      [label.id],
    );
    const originalHash = (
      await query(
        "select sha256 from public.label_files where label_version_id=$1 and kind='original'",
        [label.id],
      )
    ).rows[0].sha256;
    await actor(db, ids.customerA);
    await call(db, "vexim_record_party_decision", [
      review.id,
      "label_owner",
      "accepted",
      "Owner reviewed this exact label version.",
      [],
    ]);
    await call(db, "vexim_share_review_with_importer", [
      review.id,
      "Share this owner-reviewed version with the importer.",
    ]);

    await actor(db, ids.customerB);
    const proposal = await call<{
      decision: string;
      proposed_changes: { field: string; proposed_value: string }[];
    }>(db, "vexim_record_party_decision", [
      review.id,
      "commercial_importer",
      "proposed_edit",
      "Please consider this annotated wording change.",
      [
        {
          field: "ingredient_declaration",
          current_value: "Green tea leaves",
          proposed_value: "Green tea",
          reason: "Use the shorter common wording on this market label.",
        },
      ],
    ]);
    expect(proposal).toMatchObject({
      decision: "proposed_edit",
      proposed_changes: [
        { field: "ingredient_declaration", proposed_value: "Green tea" },
      ],
    });
    expect(
      (
        await query(
          "select collaboration_status from public.reviews where id=$1",
          [review.id],
        )
      ).rows[0].collaboration_status,
    ).toBe("changes_requested");
    await actor(db, null, "service_role");
    expect(
      (
        await query(
          "select sha256 from public.label_files where label_version_id=$1 and kind='original'",
          [label.id],
        )
      ).rows[0].sha256,
    ).toBe(originalHash);
    await actor(db, ids.customerB);
    await expect(
      call(db, "vexim_record_party_decision", [
        review.id,
        "commercial_importer",
        "proposed_edit",
        "Invalid field value should be rejected.",
        [
          {
            field: 7,
            proposed_value: "Green tea",
            reason: "This malformed proposal should not be recorded.",
          },
        ],
      ]),
    ).rejects.toThrow(/invalid fields/i);
    await expect(
      call(db, "vexim_record_party_decision", [
        review.id,
        "commercial_importer",
        "accepted",
        "Cannot accept after requesting a change.",
        [],
      ]),
    ).rejects.toThrow(/new label version/i);
  });

  it("keeps FSVP status separate and requires explicit importer attestation", async () => {
    const { review } = await submit(db);
    await actor(db, ids.customerA);
    const participant = await call<{
      id: string;
      party_role: string;
      status: string;
    }>(db, "vexim_invite_review_participant", [
      review.id,
      ids.orgB,
      "fsvp_importer",
    ]);
    expect(participant.party_role).toBe("fsvp_importer");

    await actor(db, ids.customerB);
    await expect(
      call(db, "vexim_accept_review_participant", [participant.id]),
    ).rejects.toThrow(/explicit fsvp/i);
    const accepted = await call<{
      status: string;
      fsvp_attested_at: string | null;
      fsvp_attestation_note: string | null;
    }>(db, "vexim_accept_review_participant", [
      participant.id,
      true,
      "Tổ chức này xác nhận tư cách FSVP importer cho hồ sơ.",
    ]);
    expect(accepted).toMatchObject({
      status: "active",
      fsvp_attestation_note:
        "Tổ chức này xác nhận tư cách FSVP importer cho hồ sơ.",
    });
    expect(accepted.fsvp_attested_at).toBeTruthy();
    expect(await call(db, "app_can_access_review", [review.id])).toBe(false);
  });
});
