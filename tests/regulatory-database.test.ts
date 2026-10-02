import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ComplianceRule } from "../src/lib/types";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, actor, call, ids } from "./helpers/database";
import { runRuleRegression } from "../src/lib/regression";
import { RULE_CATALOG, SOURCE_CATALOG } from "../src/lib/regulatory";
import {
  ECFR_PARSER_VERSION,
  parseEcfrXml,
} from "../src/lib/ecfr-parser";
import type {
  KnowledgeSnapshot,
  RegulatoryIngestionJob,
  VersionedCitation,
} from "../src/lib/knowledge-types";
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
const worker = "knowledge-test-worker";
const day = "2026-01-01";
async function query(sql: string, args: unknown[] = []) {
  await db.exec("savepoint test_query");
  try {
    const r = await db.query<Record<string, unknown>>(sql, args);
    await db.exec("release savepoint test_query");
    return r;
  } catch (e) {
    await db.exec(
      "rollback to savepoint test_query;release savepoint test_query",
    );
    throw e;
  }
}
async function queued(
  kind = "ecfr_part101",
  params: Record<string, unknown> = {},
) {
  await actor(db, ids.regA);
  await call(db, "vexim_request_regulatory_ingestion", [kind, params]);
  await actor(db, null, "service_role");
  return await call<RegulatoryIngestionJob>(
    db,
    "vexim_claim_regulatory_ingestion",
    [worker],
  );
}
async function fetched(date = day, body?: Buffer) {
  const job = await queued();
  const bytes =
    body ??
    (await readFile("tests/fixtures/regulatory/part101-structural.xml"));
  const rid = randomUUID();
  const hash = createHash("sha256").update(bytes).digest("hex");
  const path = `ecfr/${rid}.xml`;
  await db.query(
    "insert into storage.objects(bucket_id,name) values('regulatory-raw',$1)",
    [path],
  );
  await db.query(
    "insert into public.regulatory_api_responses(id,family,cache_key,api_url,response_status,content_type,content_hash,byte_size,raw_storage_key,retrieved_at,expires_at,latency_ms,validated) values($1,'ecfr',$2,$3,200,'application/xml',$4,$5,$6,now(),now()+interval '1 day',20,true)",
    [
      rid,
      `ecfr:full:${date}`,
      `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-21.xml?part=101`,
      hash,
      bytes.length,
      path,
    ],
  );
  const snapshot = await call<KnowledgeSnapshot>(
    db,
    "vexim_record_regulatory_snapshot",
    [
      job.id,
      worker,
      {
        raw_response_id: rid,
        source_key: "ecfr-title21-part101",
        citation: "21 CFR Part 101",
        title: "SYNTHETIC TEST ONLY",
        source_version: date,
        parser_version: ECFR_PARSER_VERSION,
        issue_date: date,
        canonical_url: `https://www.ecfr.gov/on/${date}/title-21/chapter-I/subchapter-B/part-101`,
      },
    ],
  );
  return { job, snapshot, bytes, rid };
}
async function staged(date = day, body?: Buffer) {
  const value = await fetched(date, body);
  const parsed = parseEcfrXml(value.bytes, { issueDate: date });
  parsed.validation.regression_passed = true;
  await call(db, "vexim_stage_regulatory_chunks", [
    value.job.id,
    worker,
    value.snapshot.id,
    parsed.sections,
    parsed.chunks,
    parsed.validation,
  ]);
  await call(db, "vexim_record_snapshot_regression", [
    value.snapshot.id,
    value.snapshot.content_hash,
    await call(db, "app_snapshot_rule_refs", [value.snapshot.id]),
    runRuleRegression(RULE_CATALOG, SOURCE_CATALOG),
    null,
  ]);
  await call(db, "vexim_finish_regulatory_ingestion", [
    value.job.id,
    worker,
    { status: "draft_created" },
  ]);
  return value;
}
const checks = {
  api_url: true,
  issue_date: true,
  source_title: true,
  hash: true,
  parser_complete: true,
  citations_traceable: true,
  jurisdiction: true,
  affected_rules: true,
  effective_date: true,
  unknown_effective_ack: true,
};
async function reviewed(
  value: Awaited<ReturnType<typeof staged>>,
  checklist: Record<string, unknown> = checks,
) {
  await actor(db, ids.regA);
  await call(db, "vexim_review_regulatory_snapshot", [
    value.snapshot.id,
    value.snapshot.content_hash,
    checklist,
    "text_only",
    null,
    null,
  ]);
}
async function active(date = day, body?: Buffer) {
  const v = await staged(date, body);
  await reviewed(v);
  await actor(db, ids.regB);
  await call(db, "vexim_activate_regulatory_snapshot", [
    v.snapshot.id,
    v.snapshot.content_hash,
  ]);
  return v;
}
async function retrieve(asof = day, topic = "nutrition_labeling") {
  return await call<VersionedCitation[]>(db, "vexim_retrieve_regulatory", [
    "nutrition facts",
    topic,
    "dry_packaged_tea",
    asof,
    "{eCFR,FDA}",
    4,
  ]);
}
async function fdaDraft(
  kind: "fda_label_claims_html" | "fda_food_label_guide_pdf",
) {
  const html = kind === "fda_label_claims_html";
  const job = await queued(kind);
  const source = html
    ? {
        key: "fda-label-claims",
        url: "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements",
        citation: "FDA Label Claims Guidance",
        title: "Label claims for conventional foods and dietary supplements",
        format: "HTML",
        parser: "vexim-fda-html/1.0.0",
        revision: "2024-04-05",
        revision_label: null,
        section: "heading:health-claims",
        heading: "Health Claims",
        topic: "claims",
        content:
          "Health claims describe a relationship between a food substance and reduced risk of disease. This is parser output only, not a legal conclusion.",
        citation_precision: "heading",
        anchor:
          "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements#health-claims",
      }
    : {
        key: "fda-food-label-guide",
        url: "https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf",
        citation: "FDA Food Labeling Guide",
        title: "A Food Labeling Guide",
        format: "PDF",
        parser: "vexim-fda-pdf/1.0.0",
        revision: null,
        revision_label: "January 2013",
        section: "page:1",
        heading: "Introduction",
        topic: "general",
        content:
          "The guide answers common questions about food labeling. PDF page-level extraction remains DRAFT.",
        citation_precision: "page",
        anchor:
          "https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf#page=1",
      };
  const bytes = Buffer.from(
    html ? "<html>synthetic FDA HTML</html>" : "%PDF-1.7 synthetic PDF body",
  );
  const rawId = randomUUID();
  const rawKey = `fda_guidance/${rawId}/response.${html ? "html" : "pdf"}`;
  const hash = createHash("sha256").update(bytes).digest("hex");
  await db.query(
    "insert into storage.objects(bucket_id,name) values('regulatory-raw',$1)",
    [rawKey],
  );
  await db.query(
    "insert into public.regulatory_api_responses(id,family,cache_key,api_url,response_status,content_type,content_hash,byte_size,raw_storage_key,retrieved_at,expires_at,latency_ms,validated) values($1,'fda_guidance',$2,$3,200,$4,$5,$6,$7,now(),now()+interval '1 day',20,true)",
    [
      rawId,
      `fda_guidance:${source.key}`,
      source.url,
      html ? "text/html; charset=utf-8" : "application/pdf",
      hash,
      bytes.length,
      rawKey,
    ],
  );
  const snapshot = await call<KnowledgeSnapshot>(
    db,
    "vexim_record_regulatory_snapshot",
    [
      job.id,
      worker,
      {
        raw_response_id: rawId,
        source_key: source.key,
        source_version: source.revision ?? `sha256:${hash}`,
        document_revision_date: source.revision,
        document_revision_label: source.revision_label,
        parser_version: source.parser,
        citation: source.citation,
        title: source.title,
        canonical_url: source.url,
        metadata: {
          format: source.format,
          authority: "FDA",
          issuing_agency: "FDA",
          document_type: "guidance",
          document_revision_label: source.revision_label,
        },
      },
    ],
  );
  const sectionData = [
    {
      section: source.section,
      heading: source.heading,
      topic: source.topic,
      content: source.content,
      reserved: false,
    },
  ];
  const chunkData = [
    {
      chunk_key: `${source.section}:0`,
      section: source.section,
      citation:
        source.citation_precision === "page"
          ? `${source.citation}, PDF page 1`
          : `${source.citation} — ${source.heading}`,
      heading: source.heading,
      content: source.content,
      topic: source.topic,
      topics: [source.topic],
      hierarchy: [
        {
          type: html ? "heading" : "page",
          identifier: html ? "health-claims" : "1",
          heading: source.heading,
        },
      ],
      obligation_type: "guidance",
      paragraph_path: html ? [] : ["page", "1"],
      citation_precision: source.citation_precision,
      sequence: 0,
      source_anchor: source.anchor,
    },
  ];
  const validation = {
    parser_version: source.parser,
    root_tag: html ? "html" : "pdf",
    section_count: 1,
    paragraph_count: 1,
    heading_count: html ? 1 : 0,
    page_count: html ? undefined : 1,
    processed_page_count: html ? undefined : 1,
    text_page_count: html ? undefined : 1,
    chunk_count: 1,
    coverage_ratio: 1,
    coverage_complete: true,
    citations_valid: true,
    warnings: [],
    missing_sections: [],
  };
  await call(db, "vexim_stage_fda_guidance", [
    job.id,
    worker,
    snapshot.id,
    sectionData,
    chunkData,
    validation,
  ]);
  return { job, snapshot, source, rawId, hash };
}
describe("API knowledge PostgreSQL: raw immutability, approvals, citations and job leases", () => {
  it("restricts customer/reviewer ingestion and raw metadata/storage to Regulatory Admin", async () => {
    const v = await staged();
    for (const person of [ids.customerA, ids.reviewer, ids.admin]) {
      await actor(db, person);
      await expect(
        call(db, "vexim_request_regulatory_ingestion", ["ecfr_part101", {}]),
      ).rejects.toThrow();
      expect(
        (await db.query("select * from public.regulatory_api_responses")).rows,
      ).toHaveLength(0);
      expect(
        (
          await db.query(
            "select * from storage.objects where bucket_id='regulatory-raw'",
          )
        ).rows,
      ).toHaveLength(0);
      await expect(
        call(db, "vexim_log_regulatory_raw_access", [v.snapshot.id]),
      ).rejects.toThrow();
    }
    await actor(db, ids.regB);
    expect(
      (await db.query("select * from public.regulatory_api_responses")).rows,
    ).toHaveLength(1);
    await call(db, "vexim_log_regulatory_raw_access", [v.snapshot.id]);
    expect(
      (
        await db.query(
          "select * from public.audit_logs where action='regulatory.raw_download'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rejects arbitrary query/customer data and malformed legal scope at the database boundary", async () => {
    await actor(db, ids.regA);
    for (const [kind, params] of [
      ["ecfr_discovery", { term: "Customer label secret" }],
      ["ecfr_section", { section: "999.1" }],
      ["ecfr_part101", { label: "customer text" }],
      ["fr_monitor", { start_date: "2026-01-01", end_date: "2026-03-01" }],
    ] as const)
      await expect(
        call(db, "vexim_request_regulatory_ingestion", [kind, params]),
      ).rejects.toThrow();
  });
  it("keeps new parsed snapshots/chunks DRAFT without changing sources or active retrieval", async () => {
    const v = await staged();
    await actor(db, ids.reviewer);
    expect(await retrieve()).toEqual([]);
    const chunks = await db.query<Record<string, unknown>>(
      "select review_status,source_content_hash from public.regulatory_chunks where snapshot_id=$1",
      [v.snapshot.id],
    );
    expect(chunks.rows.length).toBeGreaterThan(0);
    expect(
      chunks.rows.every(
        (c: Record<string, unknown>) =>
          c.review_status === "DRAFT" &&
          c.source_content_hash === v.snapshot.content_hash,
      ),
    ).toBe(true);
    expect(
      (
        await db.query<Record<string, unknown>>(
          "select status from public.regulatory_snapshots",
        )
      ).rows[0].status,
    ).toBe("DRAFT");
  });
  it("fail-closes missing parser/citation/regression checklist and independent approver gates", async () => {
    const v = await fetched();
    const parsed = parseEcfrXml(v.bytes, { issueDate: day });
    await expect(
      call(db, "vexim_stage_regulatory_chunks", [
        v.job.id,
        worker,
        v.snapshot.id,
        parsed.sections,
        parsed.chunks,
        {},
      ]),
    ).rejects.toThrow(/validation required/i);
    parsed.validation.regression_passed = true;
    await call(db, "vexim_stage_regulatory_chunks", [
      v.job.id,
      worker,
      v.snapshot.id,
      parsed.sections,
      parsed.chunks,
      parsed.validation,
    ]);
    await call(db, "vexim_record_snapshot_regression", [
      v.snapshot.id,
      v.snapshot.content_hash,
      [],
      runRuleRegression(RULE_CATALOG, SOURCE_CATALOG),
      null,
    ]);
    await actor(db, ids.regA);
    await expect(
      call(db, "vexim_review_regulatory_snapshot", [
        v.snapshot.id,
        v.snapshot.content_hash,
        {},
        "text_only",
        null,
        null,
      ]),
    ).rejects.toThrow(/checklist/i);
    await reviewed(v);
    await expect(
      call(db, "vexim_activate_regulatory_snapshot", [
        v.snapshot.id,
        v.snapshot.content_hash,
      ]),
    ).rejects.toThrow(/Independent/i);
    await actor(db, ids.regB);
    await expect(
      call(db, "vexim_activate_regulatory_snapshot", [
        v.snapshot.id,
        "0".repeat(64),
      ]),
    ).rejects.toThrow();
    await call(db, "vexim_activate_regulatory_snapshot", [
      v.snapshot.id,
      v.snapshot.content_hash,
    ]);
  });
  it("returns repository-provenance ACTIVE chunks only with as-of/topic/scope filters", async () => {
    const v = await active();
    await actor(db, ids.reviewer);
    const hits = await retrieve();
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.every(
        (c) =>
          c.snapshot_id === v.snapshot.id &&
          c.content_hash === v.snapshot.content_hash &&
          c.issue_date === day &&
          c.source_status === "ACTIVE" &&
          c.citation.startsWith("21 CFR 101.9"),
      ),
    ).toBe(true);
    expect(hits.every((c) => c.effective_date_unknown)).toBe(true);
    expect(await retrieve("2025-12-31")).toEqual([]);
    expect(await retrieve(day, "organic")).toEqual([]);
    await actor(db, ids.customerA);
    await expect(retrieve()).rejects.toThrow();
  });
  it("retains superseded bytes/chunks/registered versions and excludes them from current retrieval", async () => {
    const first = await active();
    const originalSources = await db.query(
      "select id,version,raw_snapshot_id,raw_content_hash from public.regulatory_sources where raw_snapshot_id=$1",
      [first.snapshot.id],
    );
    const second = await active(
      "2026-01-02",
      Buffer.from(
        first.bytes
          .toString()
          .replace(
            "Fixture Nutrition Facts requirement.",
            "Fixture Nutrition Facts changed test condition.",
          ),
      ),
    );
    await actor(db, ids.reviewer);
    const hits = await retrieve("2026-01-02");
    expect(hits.every((c) => c.snapshot_id === second.snapshot.id)).toBe(true);
    expect(await retrieve(day)).toEqual([]);
    const old = await db.query(
      "select status,content_hash from public.regulatory_snapshots where id=$1",
      [first.snapshot.id],
    );
    expect(old.rows[0]).toMatchObject({
      status: "SUPERSEDED",
      content_hash: first.snapshot.content_hash,
    });
    expect(
      (await db.query("select * from public.regulatory_source_versions")).rows
        .length,
    ).toBe(originalSources.rows.length);
    expect(
      (await db.query("select * from public.regulatory_api_responses")).rows,
    ).toHaveLength(0);
    await actor(db, ids.regA);
    expect(
      (await db.query("select * from public.regulatory_api_responses")).rows,
    ).toHaveLength(2);
  });
  it("prevents mutation or deletion of raw bodies, parsed text, section identity and API-backed manual source edits", async () => {
    const v = await active();
    await actor(db, null, "service_role");
    await expect(
      query(
        "update public.regulatory_api_responses set content_hash=$1 where id=$2",
        ["0".repeat(64), v.rid],
      ),
    ).rejects.toThrow(/immutable/i);
    await expect(
      query("delete from public.regulatory_snapshots where id=$1", [
        v.snapshot.id,
      ]),
    ).rejects.toThrow(/immutable/i);
    await expect(
      query(
        "update public.regulatory_chunks set content='tampered' where snapshot_id=$1",
        [v.snapshot.id],
      ),
    ).rejects.toThrow(/immutable/i);
    const source = (
      await db.query<{ id: string }>(
        "select id from public.regulatory_sources where raw_snapshot_id=$1 limit 1",
        [v.snapshot.id],
      )
    ).rows[0];
    await actor(db, ids.regA);
    await expect(
      call(db, "vexim_save_source", [
        { id: source.id, content_excerpt: "tampered" },
      ]),
    ).rejects.toThrow(/API-backed/i);
    await expect(call(db, "vexim_approve_source", [source.id])).rejects.toThrow(
      /snapshot/i,
    );
  });
  it("blocks downgrade activation and makes withdrawal immediately remove automatic citations", async () => {
    const v = await active("2026-01-02");
    const old = await staged(day);
    await reviewed(old);
    await actor(db, ids.regB);
    await expect(
      call(db, "vexim_activate_regulatory_snapshot", [
        old.snapshot.id,
        old.snapshot.content_hash,
      ]),
    ).rejects.toThrow(/downgrade/i);
    await call(db, "vexim_withdraw_regulatory_snapshot", [
      v.snapshot.id,
      "Withdrawal for a detailed regression investigation",
    ]);
    await actor(db, ids.reviewer);
    expect(await retrieve("2026-01-02")).toEqual([]);
  });
  it("maxes ingestion retries at three and rejects expired/wrong-worker heartbeats/completion", async () => {
    const j = await queued();
    await expect(
      call(db, "vexim_finish_regulatory_ingestion", [j.id, "other", {}]),
    ).rejects.toThrow(/lease lost/i);
    for (let n = 1; n <= 3; n++) {
      await call(db, "vexim_fail_regulatory_ingestion", [
        j.id,
        worker,
        "HTTP_429",
        "rate limit",
        true,
        0,
      ]);
      if (n < 3) {
        await db.query(
          "update public.regulatory_ingestion_jobs set next_run_at=now() where id=$1",
          [j.id],
        );
        const next = await call<RegulatoryIngestionJob>(
          db,
          "vexim_claim_regulatory_ingestion",
          [worker],
        );
        expect(next.attempts).toBe(n + 1);
      }
    }
    expect(
      (
        await db.query(
          "select status,attempts from public.regulatory_ingestion_jobs where id=$1",
          [j.id],
        )
      ).rows[0],
    ).toMatchObject({ status: "dead_letter", attempts: 3 });
    expect(
      await call(db, "vexim_heartbeat_regulatory_ingestion", [j.id, worker]),
    ).toBe(false);
    expect(await call(db, "vexim_claim_regulatory_ingestion", [worker])).toBe(
      null,
    );
    expect(
      (
        await db.query(
          "select * from public.regulatory_alerts where code='HTTP_429'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("does not register a snapshot without validated stored raw bytes", async () => {
    const v = await fetched();
    await db.query(
      "delete from storage.objects where bucket_id='regulatory-raw' and name=(select raw_storage_key from public.regulatory_api_responses where id=$1)",
      [v.rid],
    );
    await expect(
      call(db, "vexim_record_regulatory_snapshot", [
        v.job.id,
        worker,
        { raw_response_id: v.rid, source_key: "invalid", source_version: day },
      ]),
    ).rejects.toThrow(/Stored valid raw/i);
  });
  it("deduplicates identical bodies while recording later verified observations; parser revisions remain separate drafts", async () => {
    const first = await active();
    const next = await fetched();
    expect(next.snapshot.id).toBe(first.snapshot.id);
    expect(
      (await db.query("select * from public.regulatory_snapshot_observations"))
        .rows,
    ).toHaveLength(2);
    const revised = await call<KnowledgeSnapshot>(
      db,
      "vexim_record_regulatory_snapshot",
      [
        next.job.id,
        worker,
        {
          raw_response_id: next.rid,
          source_key: "ecfr-title21-part101",
          citation: "21 CFR Part 101",
          title: "SYNTHETIC TEST",
          source_version: day,
          issue_date: day,
          parser_version: "test-parser/2.0.0",
          canonical_url: `https://www.ecfr.gov/on/${day}/title-21/chapter-I/subchapter-B/part-101`,
        },
      ],
    );
    expect(revised.id).not.toBe(first.snapshot.id);
    expect(revised.status).toBe("FETCHED");
    expect(revised.content_hash).toBe(first.snapshot.content_hash);
    expect(
      (
        await db.query(
          "select * from public.regulatory_snapshots where status='ACTIVE'",
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("requires rechecking overlapping section versions after the regulatory checklist was saved", async () => {
    const first = await active();
    const second = await staged("2026-01-02");
    await reviewed(second);
    await actor(db, null, "service_role");
    await db.query(
      "update public.regulatory_sources set version=version+1 where raw_snapshot_id=$1",
      [first.snapshot.id],
    );
    await actor(db, ids.regB);
    await expect(
      call(db, "vexim_activate_regulatory_snapshot", [
        second.snapshot.id,
        second.snapshot.content_hash,
      ]),
    ).rejects.toThrow(/Overlapping source edition/i);
    await reviewed(second);
    await actor(db, ids.regB);
    await call(db, "vexim_activate_regulatory_snapshot", [
      second.snapshot.id,
      second.snapshot.content_hash,
    ]);
  });
  it("requires a comparison for a >20% chunk drop and leaves the old edition active", async () => {
    const first = await active();
    const body = Buffer.from(
      "<DIV1>" +
        ["101.3", "101.7", "101.9"]
          .map(
            (section) =>
              `<DIV8 N="${section}" TYPE="SECTION"><HEAD>Fixture ${section}</HEAD><P>(a) Minimal test paragraph.</P></DIV8>`,
          )
          .join("") +
        "</DIV1>",
    );
    const second = await staged("2026-01-02", body);
    expect(
      (
        await db.query(
          "select * from public.regulatory_alerts where code='CHUNK_COUNT_DROP'",
        )
      ).rows,
    ).toHaveLength(1);
    await expect(reviewed(second)).rejects.toThrow(/comparison reason/i);
    await reviewed(second, {
      ...checks,
      override_reason:
        "Compared every source paragraph and verified the intentional fixture change.",
    });
    await actor(db, ids.regB);
    await call(db, "vexim_activate_regulatory_snapshot", [
      second.snapshot.id,
      second.snapshot.content_hash,
    ]);
    expect(first.snapshot.content_hash).not.toBe(second.snapshot.content_hash);
  });
  it("exposes uncapped operational metrics and an idempotent daily schedule only to the permitted actors", async () => {
    await actor(db, ids.reviewer);
    expect(await call(db, "vexim_regulatory_dashboard_metrics")).toMatchObject({
      requests: 0,
      pending_approval: 0,
    });
    await expect(call(db, "vexim_schedule_regulatory_sync")).rejects.toThrow();
    await actor(db, null, "service_role");
    expect(
      await call<string[]>(db, "vexim_schedule_regulatory_sync"),
    ).toHaveLength(9);
    expect(await call(db, "vexim_schedule_regulatory_sync")).toEqual([]);
    expect(
      (await db.query("select * from public.regulatory_ingestion_jobs")).rows,
    ).toHaveLength(9);
    await actor(db, ids.customerA);
    await expect(
      call(db, "vexim_regulatory_dashboard_metrics"),
    ).rejects.toThrow();
  });
  it("rejects NULL scope/hash/date and an unclassified source change at direct RPC boundaries", async () => {
    await actor(db, ids.regA);
    await expect(
      call(db, "vexim_request_regulatory_ingestion", [null, {}]),
    ).rejects.toThrow();
    await expect(
      call(db, "vexim_request_regulatory_ingestion", ["ecfr_part101", null]),
    ).rejects.toThrow();
    const v = await staged();
    await actor(db, ids.regA);
    await expect(
      call(db, "vexim_review_regulatory_snapshot", [
        v.snapshot.id,
        null,
        checks,
        "text_only",
        null,
        null,
      ]),
    ).rejects.toThrow();
    await call(db, "vexim_review_regulatory_snapshot", [
      v.snapshot.id,
      v.snapshot.content_hash,
      checks,
      "unknown",
      null,
      null,
    ]);
    await actor(db, ids.regB);
    await expect(
      call(db, "vexim_activate_regulatory_snapshot", [
        v.snapshot.id,
        v.snapshot.content_hash,
      ]),
    ).rejects.toThrow();
    await expect(
      call(db, "vexim_retrieve_regulatory", [
        "nutrition facts",
        "nutrition_labeling",
        "dry_packaged_tea",
        null,
        "{eCFR}",
        4,
      ]),
    ).rejects.toThrow();
  });
  it("retrieves current repository-versioned vector evidence but no zero-term full-text false hits", async () => {
    const v = await active();
    await actor(db, null, "service_role");
    const embedding =
      "[" +
      Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)).join(",") +
      "]";
    await db.query(
      "update public.regulatory_chunks set embedding=$1::extensions.vector where snapshot_id=$2",
      [embedding, v.snapshot.id],
    );
    await actor(db, ids.reviewer);
    const hits = await call<VersionedCitation[]>(
      db,
      "vexim_retrieve_regulatory_vector",
      [embedding, "nutrition_labeling", "tea_bag", day, "{eCFR}", 4],
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.every(
        (c) =>
          c.snapshot_id === v.snapshot.id &&
          c.retrieval_method === "vector" &&
          c.content_hash === v.snapshot.content_hash,
      ),
    ).toBe(true);
    expect(
      await call(db, "vexim_retrieve_regulatory", [
        "noextraneouslexicalmatch",
        "nutrition_labeling",
        "tea_bag",
        day,
        "{eCFR}",
        4,
      ]),
    ).toEqual([]);
  });
  it.each([
    ["fda_label_claims_html", "HTML", "heading"] as const,
    ["fda_food_label_guide_pdf", "PDF", "page"] as const,
  ])(
    "stores FDA %s raw bytes, citations and provenance as DRAFT",
    async (kind, format, precision) => {
      const v = await fdaDraft(kind);
      const snapshot = await db.query<Record<string, unknown>>(
        "select status,source_family,document_revision_date,document_revision_label,content_hash,chunk_count,parser_version,metadata from public.regulatory_snapshots where id=$1",
        [v.snapshot.id],
      );
      expect(snapshot.rows[0]).toMatchObject({
        status: "DRAFT",
        source_family: "fda_guidance",
        document_revision_label: format === "PDF" ? "January 2013" : null,
        content_hash: v.hash,
        chunk_count: 1,
        parser_version:
          format === "HTML" ? "vexim-fda-html/1.0.0" : "vexim-fda-pdf/1.0.0",
        metadata: {
          document_revision_label:
            format === "PDF" ? "January 2013" : null,
        },
      });
      const sourceRow = await db.query<Record<string, unknown>>(
        "select id,status,authority,agency,document_type,raw_snapshot_id,raw_content_hash,parser_version,ingestion_status,document_revision_date,document_revision_label from public.regulatory_sources where source_key=$1",
        [v.source.key],
      );
      expect(sourceRow.rows[0]).toMatchObject({
        status: "DRAFT",
        authority: "FDA",
        agency: "FDA",
        document_type: "guidance",
        document_revision_label: format === "PDF" ? "January 2013" : null,
        raw_snapshot_id: v.snapshot.id,
        raw_content_hash: v.hash,
        parser_version:
          format === "HTML" ? "vexim-fda-html/1.0.0" : "vexim-fda-pdf/1.0.0",
        ingestion_status: "DRAFT",
      });
      const chunks = await db.query<Record<string, unknown>>(
        "select review_status,citation,citation_precision,source_anchor,embedding from public.regulatory_chunks where snapshot_id=$1",
        [v.snapshot.id],
      );
      expect(chunks.rows).toHaveLength(1);
      expect(chunks.rows[0].review_status).toBe("DRAFT");
      expect(chunks.rows[0].citation_precision).toBe(precision);
      expect(chunks.rows[0].embedding).toBeNull();
      await actor(db, ids.regA);
      expect(await retrieve(day, "claims")).toEqual([]);
      expect(
        (
          await db.query(
            "select id from public.compliance_rules where status='ACTIVE' and $1=any(source_citations)",
            [sourceRow.rows[0].id],
          )
        ).rows,
      ).toHaveLength(0);

      const sourceId = String(sourceRow.rows[0].id);
      await actor(db, null, "service_role");
      await query(
        "update public.regulatory_sources set created_by=$1 where id=$2",
        [ids.regA, sourceId],
      );
      await actor(db, ids.regB);
      await expect(
        call(db, "vexim_approve_source", [sourceId]),
      ).rejects.toThrow(/expert-review/i);
      expect(
        (
          await db.query<{ status: string }>(
            "select status from public.regulatory_sources where id=$1",
            [sourceId],
          )
        ).rows[0].status,
      ).toBe("DRAFT");
    },
  );

  it("requires fresh affected-definition QA, retains failed runs and prevents a false fixture pass", async () => {
    const first = await active();
    const source = (
      await db.query<{ id: string }>(
        "select id from public.regulatory_sources where raw_snapshot_id=$1 and citation=$2",
        [first.snapshot.id, "21 CFR 101.3"],
      )
    ).rows[0];
    await actor(db, null, "service_role");
    await db.query(
      "update public.compliance_rules set status='ACTIVE',approved_by=$1,test_status='passed',test_hash=definition_hash,source_citations=array[$2::uuid] where rule_key='IDENTITY-001'",
      [ids.regB, source.id],
    );
    const second = await staged("2026-01-02");
    await reviewed(second);
    await actor(db, null, "service_role");
    const currentRule = (
      await db.query<ComplianceRule>(
        "select * from public.compliance_rules where rule_key='IDENTITY-001' and status='ACTIVE'",
      )
    ).rows[0];
    await actor(db, ids.regA);
    const nextRule = await call<ComplianceRule>(db, "vexim_save_rule", [
      { ...currentRule, name: "Changed fixture definition" },
    ]);
    await actor(db, null, "service_role");
    const sourceRefs = await call(db, "app_source_refs", [
      "{" + nextRule.source_citations.join(",") + "}",
    ]);
    await call(db, "vexim_record_rule_test", [
      nextRule.id,
      nextRule.definition_hash,
      sourceRefs,
      runRuleRegression(RULE_CATALOG, SOURCE_CATALOG),
      ids.regA,
    ]);
    await actor(db, ids.regB);
    await call(db, "vexim_approve_rule", [nextRule.id]);
    await actor(db, ids.regB);
    await expect(
      call(db, "vexim_activate_regulatory_snapshot", [
        second.snapshot.id,
        second.snapshot.content_hash,
      ]),
    ).rejects.toThrow(/affected active rules/i);
    await actor(db, null, "service_role");
    const refs = await call(db, "app_snapshot_rule_refs", [second.snapshot.id]);
    const failed = runRuleRegression(RULE_CATALOG, SOURCE_CATALOG);
    failed[0].passed = false;
    await call(db, "vexim_record_snapshot_regression", [
      second.snapshot.id,
      second.snapshot.content_hash,
      refs,
      failed,
      null,
    ]);
    await actor(db, ids.regB);
    await expect(
      call(db, "vexim_activate_regulatory_snapshot", [
        second.snapshot.id,
        second.snapshot.content_hash,
      ]),
    ).rejects.toThrow(/passing regression/i);
    await actor(db, null, "service_role");
    await call(db, "vexim_record_snapshot_regression", [
      second.snapshot.id,
      second.snapshot.content_hash,
      refs,
      runRuleRegression(RULE_CATALOG, SOURCE_CATALOG),
      null,
    ]);
    await actor(db, ids.regB);
    await call(db, "vexim_activate_regulatory_snapshot", [
      second.snapshot.id,
      second.snapshot.content_hash,
    ]);
    expect(
      (
        await db.query(
          "select * from public.regulatory_snapshot_regressions where snapshot_id=$1",
          [second.snapshot.id],
        )
      ).rows,
    ).toHaveLength(3);
  });
});
