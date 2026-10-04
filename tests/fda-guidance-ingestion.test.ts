import { createHash, randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type {
  KnowledgeSnapshot,
  ParsedRegulatoryChunk,
  ParsedSection,
  ParserValidation,
  RegulatoryIngestionJob,
} from "../src/lib/knowledge-types";
import {
  processRegulatoryIngestion,
  type IngestionRepository,
} from "../src/server/regulatory/ingestion";
import {
  EcfrClient,
  FdaGuidanceClient,
  FederalRegisterClient,
  RegulatoryHttpClient,
  type ApiDocument,
  type RegulatoryHttpStore,
} from "../src/server/regulatory/clients";

const html = `<!doctype html><html><head><meta name="dateModified" content="2024-04-05"></head><body><main id="main-content"><h1>Label Claims</h1><p>FDA describes categories of claims used on conventional food and dietary supplement labels.</p><h2 id="health-claims">Health Claims</h2><p>Health claims describe the relationship between a food substance and disease risk. This extracted guidance is not a legal conclusion.</p><h2 id="nutrient-content-claims">Nutrient Content Claims</h2><p>Nutrient content claims characterize the level of a nutrient in a food.</p></main></body></html>`;

async function pdfBytes() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page1 = pdf.addPage([612, 792]);
  page1.drawText("A Food Labeling Guide", { x: 48, y: 740, size: 18, font });
  page1.drawText("Guidance for Industry · January 2013", {
    x: 48,
    y: 700,
    size: 12,
    font,
  });
  const page2 = pdf.addPage([612, 792]);
  page2.drawText("General Food Labeling Requirements", {
    x: 48,
    y: 740,
    size: 16,
    font,
  });
  page2.drawText("Place required statements on the principal display panel.", {
    x: 48,
    y: 700,
    size: 12,
    font,
  });
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

const job = (kind: RegulatoryIngestionJob["kind"]): RegulatoryIngestionJob => ({
  id: randomUUID(),
  kind,
  params: {},
  status: "running",
  requested_by: randomUUID(),
  requested_at: new Date().toISOString(),
  completed_at: null,
  attempts: 1,
  locked_by: "test-worker",
  locked_until: new Date(Date.now() + 600_000).toISOString(),
  response_status: null,
  error_code: null,
  error_message: null,
  result: {},
  next_run_at: new Date().toISOString(),
});

async function harness(bytes: Uint8Array, contentType: string) {
  const saved: ApiDocument[] = [];
  const store: RegulatoryHttpStore = {
    get: async (key) =>
      saved.find((doc) => doc.meta.cache_key === key && doc.meta.validated) ?? null,
    save: async (doc) => {
      saved.push(doc);
    },
    reserve: async () => 0,
  };
  const fetcher = vi.fn(
    async () =>
      new Response(Buffer.from(bytes), { headers: { "content-type": contentType } }),
  ) as unknown as typeof fetch;
  const http = new RegulatoryHttpClient({
    contact: "operations@test.example",
    fetch: fetcher,
    store,
    attempts: 1,
  });
  const snapshots: KnowledgeSnapshot[] = [];
  const repository: IngestionRepository = {
    active: vi.fn(async () => null),
    knownDocument: vi.fn(async () => false),
    record: vi.fn(async (_jid, _worker, value) => {
      const raw = saved.find((doc) => doc.meta.id === value.raw_response_id)!;
      const snapshot = {
        ...value,
        id: randomUUID(),
        source_family: "fda_guidance",
        raw_response_id: raw.meta.id,
        content_hash: raw.meta.content_hash,
        status: "FETCHED",
        retrieved_at: raw.meta.retrieved_at,
        created_at: raw.meta.retrieved_at,
        effective_from: null,
        effective_to: null,
        effective_date_unknown: true,
        validation_results: {},
        review_checklist: {},
        change_classification: null,
        chunk_count: 0,
        metadata: value.metadata ?? {},
      } as unknown as KnowledgeSnapshot;
      snapshots.push(snapshot);
      return snapshot;
    }),
    stage: vi.fn(async () => {
      throw new Error("FDA adapters must not use the eCFR staging RPC");
    }),
    stageFdaGuidance: vi.fn(
      async (
        _jid: string,
        _worker: string,
        id: string,
        _sections: ParsedSection[],
        chunks: ParsedRegulatoryChunk[],
        validation: ParserValidation,
      ) => {
        const snapshot = snapshots.find((item) => item.id === id)!;
        snapshot.status = "DRAFT";
        snapshot.chunk_count = chunks.length;
        snapshot.validation_results = validation;
      },
    ),
    parseFailed: vi.fn(async (_jid, _worker, id) => {
      snapshots.find((item) => item.id === id)!.status = "PARSE_FAILED";
    }),
    federalDraft: vi.fn(async () => undefined),
  };
  return {
    saved,
    snapshots,
    repository,
    fetcher,
    ecfr: new EcfrClient(http),
    fr: new FederalRegisterClient(http),
    fda: new FdaGuidanceClient(http),
  };
}

describe("FDA Guidance ingestion remains review-only DRAFT", () => {
  it("stages FDA HTML with the exact body hash and heading/anchor citations", async () => {
    const bytes = new TextEncoder().encode(html);
    const h = await harness(bytes, "text/html; charset=utf-8");
    const result = await processRegulatoryIngestion(
      job("fda_label_claims_html"),
      "test-worker",
      h.repository,
      h.ecfr,
      h.fr,
      h.fda,
    );
    expect(result).toMatchObject({
      status: "draft_created",
      format: "HTML",
      source_status: "DRAFT",
      snapshot_status: "DRAFT",
      active_rules_changed: false,
      rag_eligible: false,
      document_revision_date: "2024-04-05",
      coverage_complete: true,
      citations_valid: true,
    });
    expect(result.raw_hash).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(result.parser_version).toBe("vexim-fda-html/1.0.0");
    expect(h.saved[0].body).toEqual(bytes);
    expect(h.snapshots[0].source_key).toBe("fda-label-claims");
    expect(h.snapshots[0].status).toBe("DRAFT");
    const stageFdaGuidance = vi.mocked(h.repository.stageFdaGuidance!);
    expect(stageFdaGuidance).toHaveBeenCalledTimes(1);
    const stage = stageFdaGuidance.mock.calls[0]!;
    expect(stage[4].every((chunk) => chunk.citation_precision === "heading")).toBe(true);
    expect(stage[4].every((chunk) => chunk.source_anchor.includes("#"))).toBe(true);
    expect(h.repository.stage).not.toHaveBeenCalled();
    expect(h.repository.federalDraft).not.toHaveBeenCalled();
  });

  it("stages FDA PDF as page-cited chunks and reports page counts/hash", async () => {
    const bytes = await pdfBytes();
    const h = await harness(bytes, "application/pdf");
    const result = await processRegulatoryIngestion(
      job("fda_food_label_guide_pdf"),
      "test-worker",
      h.repository,
      h.ecfr,
      h.fr,
      h.fda,
    );
    expect(result).toMatchObject({
      status: "draft_created",
      format: "PDF",
      source_status: "DRAFT",
      snapshot_status: "DRAFT",
      page_count: 2,
      document_revision_label: "January 2013",
      coverage_complete: true,
      citations_valid: true,
    });
    expect(result.raw_hash).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(result.parser_version).toBe("vexim-fda-pdf/1.0.0");
    const stage = vi.mocked(h.repository.stageFdaGuidance!).mock.calls[0]!;
    expect(stage[4].map((chunk) => chunk.citation)).toEqual([
      "FDA Food Labeling Guide, PDF page 1",
      "FDA Food Labeling Guide, PDF page 2",
    ]);
    expect(stage[4].every((chunk) => chunk.source_anchor.includes("#page="))).toBe(true);
    expect(h.snapshots[0].status).toBe("DRAFT");
  });

  it("records parser failures without staging zero-chunk HTML", async () => {
    const bytes = new TextEncoder().encode(
      "<!doctype html><html><body><main><p>Too little content</p></main></body></html>",
    );
    const h = await harness(bytes, "text/html");
    await expect(
      processRegulatoryIngestion(
        job("fda_label_claims_html"),
        "test-worker",
        h.repository,
        h.ecfr,
        h.fr,
        h.fda,
      ),
    ).rejects.toMatchObject({ code: "PARSE_FAILED" });
    expect(h.repository.record).toHaveBeenCalledTimes(1);
    expect(h.repository.parseFailed).toHaveBeenCalledTimes(1);
    expect(h.repository.stageFdaGuidance).not.toHaveBeenCalled();
    expect(h.snapshots[0].status).toBe("PARSE_FAILED");
  });
});
