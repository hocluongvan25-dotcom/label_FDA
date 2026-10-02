import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  expect,
  it,
  vi,
} from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { createHash, randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { LabelVersion, Product, Review } from "../src/lib/types";
import {
  actor,
  call,
  createDatabase,
  ids,
  productDraft,
} from "./helpers/database";
import { serviceAdapter } from "./helpers/service-adapter";
import { simulatedScanner } from "./helpers/scanner";
import { processJob, type PipelineJob } from "../src/server/pipeline";
import { UnsafeFileError } from "../src/server/virus-scan";
let db: PGlite;
beforeAll(async () => {
  db = await createDatabase();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec("reset role; begin");
  vi.stubEnv("OCR_PROVIDER", "local");
  vi.stubEnv("APPROVED_LLM_URL", "");
});
afterEach(async () => {
  await db.exec("rollback; reset role");
  vi.unstubAllEnvs();
});
async function queuedLabel() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 650]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  [
    "Green tea",
    "Net Wt 1.41 oz (40 g)",
    "Ingredients: Green tea leaves",
    "Nutrition Facts",
    "Manufactured by Test, 1 Street, USA",
  ].forEach((text, i) =>
    page.drawText(text, { x: 30, y: 600 - 80 * i, font, size: 17 }),
  );
  const bytes = Buffer.from(await doc.save());
  await actor(db, ids.customerA);
  const product = await call<Product>(db, "vexim_save_product", [
    productDraft(),
  ]);
  const label = await call<LabelVersion>(db, "vexim_create_label_version", [
    product.id,
    [
      {
        id: randomUUID(),
        name: "synthetic-worker.pdf",
        mime_type: "application/pdf",
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        page_count: 1,
      },
    ],
  ]);
  await db.query(
    "insert into storage.objects(bucket_id,name) values('label-originals',$1)",
    [label.original_files[0].storage_path],
  );
  const review = await call<Review>(db, "vexim_submit_review", [
    label.id,
    `${label.id}:worker-test`,
  ]);
  await actor(db, null, "service_role");
  const adapter = serviceAdapter(db);
  adapter.objects.set(
    `label-originals/${label.original_files[0].storage_path}`,
    bytes,
  );
  const job = await call<PipelineJob>(db, "vexim_claim_job", ["worker-test"]);
  return { label, review, job, ...adapter };
}
it("executes all actual local worker stages against PostgreSQL and simulated private storage; does not invent approved rules or approve a report", async () => {
  const scanner = await simulatedScanner();
  vi.stubEnv("CLAMAV_HOST", "127.0.0.1");
  vi.stubEnv("CLAMAV_PORT", String(scanner.port));
  try {
    const state = await queuedLabel();
    await processJob(state.client, state.job, "worker-test");
    const review = (
      await db.query<Review>("select * from public.reviews where id=$1", [
        state.review.id,
      ])
    ).rows[0];
    expect(review.status).toBe("SOURCE_UNAVAILABLE");
    expect(review.triage_route).toBe("BLOCKED_REGULATORY_SOURCE");
    expect(review.overall_result).toBe("BLOCKED");
    expect(review.report_status).toBe("BLOCKED");
    expect(review.expert_review_status).toBe("NOT_REQUIRED");
    expect(review.triage_policy_version).toBe("risk-based-triage/1.0.0");
    expect(review.triage_reasons?.map((reason) => reason.code)).toContain(
      "ACTIVE_RULE_PACK_INCOMPLETE",
    );
    expect(review.pipeline.every((s) => s.status === "complete")).toBe(true);
    expect(review.rule_snapshot).toEqual([]);
    expect((await db.query("select * from public.review_triage_runs")).rows).toHaveLength(1);
    expect((await db.query("select * from public.pre_screening_reports")).rows).toHaveLength(0);
    const fields = (
      await db.query(
        "select * from public.extracted_fields where label_version_id=$1",
        [state.label.id],
      )
    ).rows;
    expect(fields.length).toBeGreaterThanOrEqual(11);
    expect(
      (await db.query("select stage from public.pipeline_outputs")).rows,
    ).toHaveLength(5);
    expect(
      [...state.objects.keys()].some((k) => k.startsWith("label-normalized/")),
    ).toBe(true);
    expect(
      (await db.query("select status from public.pipeline_jobs")).rows[0],
    ).toMatchObject({ status: "completed" });
    expect((await db.query("select * from public.reports")).rows).toHaveLength(
      0,
    );
  } finally {
    await scanner.close();
  }
});
it("quarantines an original after a simulated FOUND response without running OCR/extraction", async () => {
  const scanner = await simulatedScanner("stream: Synthetic-Test FOUND\0");
  vi.stubEnv("CLAMAV_HOST", "127.0.0.1");
  vi.stubEnv("CLAMAV_PORT", String(scanner.port));
  try {
    const state = await queuedLabel();
    await expect(
      processJob(state.client, state.job, "worker-test"),
    ).rejects.toBeInstanceOf(UnsafeFileError);
    expect(
      (
        await db.query(
          "select scan_status from public.label_files where id=$1",
          [state.label.original_files[0].id],
        )
      ).rows[0],
    ).toMatchObject({ scan_status: "rejected" });
    expect(
      (await db.query("select * from public.extracted_fields")).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select * from public.pipeline_outputs")).rows,
    ).toHaveLength(0);
  } finally {
    await scanner.close();
  }
});
