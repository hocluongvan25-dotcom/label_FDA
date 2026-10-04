import { describe, it, expect, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  processRegulatoryIngestion,
  type IngestionRepository,
} from "../src/server/regulatory/ingestion";
import {
  RegulatoryHttpClient,
  EcfrClient,
  FederalRegisterClient,
  type ApiDocument,
  type RegulatoryHttpStore,
} from "../src/server/regulatory/clients";
import { ECFR_PARSER_VERSION } from "../src/lib/ecfr-parser";
import type {
  KnowledgeSnapshot,
  RegulatoryIngestionJob,
  IngestionKind,
} from "../src/lib/knowledge-types";
const job = (
  kind: IngestionKind = "ecfr_part101",
  params: Record<string, unknown> = {},
): RegulatoryIngestionJob => ({
  id: randomUUID(),
  kind,
  params,
  status: "running",
  requested_by: randomUUID(),
  requested_at: new Date().toISOString(),
  completed_at: null,
  attempts: 1,
  locked_by: "test-worker",
  locked_until: new Date(Date.now() + 600000).toISOString(),
  response_status: null,
  error_code: null,
  error_message: null,
  result: {},
  next_run_at: new Date().toISOString(),
});
const structure = {
  type: "title",
  identifier: "21",
  children: [
    {
      type: "part",
      identifier: "101",
      children: ["101.3", "101.7", "101.9"].map((section) => ({
        type: "section",
        identifier: section,
        label: section,
      })),
    },
  ],
};
async function harness(route?: (url: URL) => Promise<Response> | Response) {
  const bytes = await readFile(
    "tests/fixtures/regulatory/part101-structural.xml",
  );
  const docs: ApiDocument[] = [];
  const snapshots: KnowledgeSnapshot[] = [];
  const repository: IngestionRepository = {
    active: vi.fn(async () => null),
    knownDocument: vi.fn(async (number) =>
      snapshots.some((s) => s.document_number === number),
    ),
    record: vi.fn(async (_jid, _worker, p) => {
      const response = docs.find((d) => d.meta.id === p.raw_response_id)!;
      const snapshot = {
        ...p,
        id: randomUUID(),
        source_family: response.meta.family,
        content_hash: response.meta.content_hash,
        retrieved_at: response.meta.retrieved_at,
        status: "FETCHED",
        parser_version: p.parser_version ?? ECFR_PARSER_VERSION,
        chunk_count: 0,
        metadata: p.metadata ?? {},
        created_at: new Date().toISOString(),
      } as unknown as KnowledgeSnapshot;
      snapshots.push(snapshot);
      return snapshot;
    }),
    stage: vi.fn(async (_jid, _worker, id, _sections, chunks) => {
      snapshots.find((s) => s.id === id)!.status = "DRAFT";
      snapshots.find((s) => s.id === id)!.chunk_count = chunks.length;
    }),
    parseFailed: vi.fn(async (_jid, _worker, id) => {
      snapshots.find((s) => s.id === id)!.status = "PARSE_FAILED";
    }),
    federalDraft: vi.fn(async (_jid, _worker, id) => {
      snapshots.find((s) => s.id === id)!.status = "DRAFT";
    }),
  };
  const store: RegulatoryHttpStore = {
    get: async (key) =>
      docs.find((d) => d.meta.cache_key === key && d.meta.validated) ?? null,
    save: async (d) => {
      docs.push(d);
    },
    reserve: async () => 0,
  };
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  const fetcher = vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    if (route) return route(url);
    if (url.pathname.endsWith("titles.json"))
      return json({
        titles: [
          {
            number: 21,
            latest_issue_date: "2026-09-25",
            up_to_date_as_of: "2026-09-29",
          },
        ],
      });
    if (url.pathname.includes("/structure/")) return json(structure);
    return new Response(bytes, {
      headers: { "content-type": "application/xml" },
    });
  }) as unknown as typeof fetch;
  const client = new RegulatoryHttpClient({
    contact: "operations@test.example",
    fetch: fetcher,
    store,
    attempts: 1,
  });
  return {
    repository,
    docs,
    snapshots,
    bytes,
    fetcher,
    json,
    ecfr: new EcfrClient(client),
    fr: new FederalRegisterClient(client),
  };
}
describe("Regulatory ingestion orchestration: no auto-activation or customer outbound", () => {
  it("discovers real issue-date metadata, stores raw SHA and stages only validated DRAFT chunks", async () => {
    const h = await harness();
    const result = await processRegulatoryIngestion(
      job(),
      "test-worker",
      h.repository,
      h.ecfr,
      h.fr,
    );
    expect(result).toMatchObject({
      status: "draft_created",
      issue_date: "2026-09-25",
      section_count: 3,
      active_rules_changed: false,
    });
    expect(result.raw_hash).toBe(
      createHash("sha256").update(h.bytes).digest("hex"),
    );
    expect(h.snapshots[0].status).toBe("DRAFT");
    expect(h.snapshots[0].parser_version).toBe(ECFR_PARSER_VERSION);
    expect(h.snapshots[0].metadata.raw_body_size_bytes).toBe(
      h.docs.find((d) => d.meta.api_url.includes("/full/"))!.meta.byte_size,
    );
    expect(h.docs).toHaveLength(3);
    const stage = vi.mocked(h.repository.stage).mock.calls[0];
    expect(stage[5]).toMatchObject({
      coverage_complete: true,
      regression_passed: true,
      citations_valid: true,
    });
    expect(h.snapshots.some((s) => s.status === "ACTIVE")).toBe(false);
  });
  it("discovery/search results cannot become registered active evidence", async () => {
    const h = await harness(
      async (url) =>
        new Response(
          JSON.stringify(
            url.pathname.endsWith("titles.json")
              ? { titles: [{ number: 21, latest_issue_date: "2026-09-25" }] }
              : url.pathname.includes("/structure/")
                ? structure
                : { results: [{ citation: "unapproved search result" }] },
          ),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const result = await processRegulatoryIngestion(
      job("ecfr_discovery", { term: "21 CFR 101" }),
      "test-worker",
      h.repository,
      h.ecfr,
      h.fr,
    );
    expect(result).toMatchObject({
      status: "discovery_completed",
      evidence_only_after_full_fetch: true,
    });
    expect(h.repository.record).not.toHaveBeenCalled();
    expect(h.repository.stage).not.toHaveBeenCalled();
  });
  it("refreshes titles and structure on a dated full-XML 404, without substituting today", async () => {
    let titles = 0;
    const bytes = await readFile(
      "tests/fixtures/regulatory/part101-structural.xml",
    );
    const h = await harness(async (url) => {
      if (url.pathname.endsWith("titles.json"))
        return new Response(
          JSON.stringify({
            titles: [
              {
                number: 21,
                latest_issue_date: ++titles === 1 ? "2026-09-24" : "2026-09-25",
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      if (url.pathname.includes("/structure/"))
        return new Response(JSON.stringify(structure), {
          headers: { "content-type": "application/json" },
        });
      if (url.pathname.includes("2026-09-24"))
        return new Response("not available", { status: 404 });
      return new Response(bytes, {
        headers: { "content-type": "application/xml" },
      });
    });
    const result = await processRegulatoryIngestion(
      job(),
      "test-worker",
      h.repository,
      h.ecfr,
      h.fr,
    );
    expect(result.issue_date).toBe("2026-09-25");
    expect(titles).toBe(2);
    const p = vi.mocked(h.repository.record).mock.calls[0][2];
    const metadata = p.metadata as Record<string, string>;
    expect(
      h.docs.find((d) => d.meta.id === metadata.structure_response_id)!.meta
        .api_url,
    ).toContain("2026-09-25");
    expect(
      h.docs.find((d) => d.meta.id === metadata.titles_response_id)!.body,
    ).toEqual(
      h.docs.filter((d) => d.meta.api_url.endsWith("titles.json")).at(-1)!.body,
    );
    expect(h.docs.some((d) => d.meta.response_status === 404)).toBe(true);
  });
  it("preserves raw parse failures and never stages zero-chunk XML", async () => {
    const h = await harness(
      (url) =>
        new Response(
          url.pathname.endsWith("titles.json")
            ? JSON.stringify({
                titles: [{ number: 21, latest_issue_date: "2026-09-25" }],
              })
            : url.pathname.includes("/structure/")
              ? JSON.stringify(structure)
              : "<DIV1/>",
          {
            headers: {
              "content-type": url.pathname.endsWith(".xml")
                ? "application/xml"
                : "application/json",
            },
          },
        ),
    );
    await expect(
      processRegulatoryIngestion(
        job(),
        "test-worker",
        h.repository,
        h.ecfr,
        h.fr,
      ),
    ).rejects.toMatchObject({ code: "PARSE_FAILED" });
    expect(h.docs).toHaveLength(3);
    expect(h.snapshots[0].status).toBe("PARSE_FAILED");
    expect(h.repository.stage).not.toHaveBeenCalled();
  });
  it("does not repeatedly reparse an unchanged active edition but requires a new draft for a parser revision", async () => {
    const h = await harness();
    vi.mocked(h.repository.active).mockResolvedValue({
      id: "previous",
      issue_date: "2026-09-25",
      parser_version: ECFR_PARSER_VERSION,
    } as KnowledgeSnapshot);
    expect(
      await processRegulatoryIngestion(
        job(),
        "test-worker",
        h.repository,
        h.ecfr,
        h.fr,
      ),
    ).toMatchObject({ status: "unchanged" });
    expect(h.repository.record).not.toHaveBeenCalled();
    vi.mocked(h.repository.active).mockResolvedValue({
      id: "previous",
      issue_date: "2026-09-25",
      parser_version: "old-parser",
    } as KnowledgeSnapshot);
    expect(
      await processRegulatoryIngestion(
        job(),
        "test-worker",
        h.repository,
        h.ecfr,
        h.fr,
      ),
    ).toMatchObject({ status: "draft_created" });
  });
  it("paginates 120 FDA documents, deduplicates subsequent monitors and creates review tasks not rules", async () => {
    const h = await harness((url) => {
      if (url.pathname.endsWith("/documents.json")) {
        const page = Number(url.searchParams.get("page"));
        const results = Array.from(
          { length: page === 1 ? 100 : 20 },
          (_, i) => ({
            document_number: `2026-${10000 + (page - 1) * 100 + i}`,
          }),
        );
        return new Response(JSON.stringify({ count: 120, results }), {
          headers: { "content-type": "application/json" },
        });
      }
      const number = url.pathname.split("/").at(-1)!.replace(".json", "");
      return new Response(
        JSON.stringify({
          document_number: number,
          title: "Synthetic FDA monitoring document (not actual law)",
          type: "Rule",
          publication_date: "2026-09-25",
          agencies: [
            {
              slug: "food-and-drug-administration",
              name: "Food and Drug Administration",
            },
          ],
          cfr_references: [{ title: 21, part: 101 }],
          html_url: `https://www.federalregister.gov/documents/2026/09/25/${number}`,
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    const j = job("fr_monitor", {
      term: "food labeling",
      start_date: "2026-09-01",
      end_date: "2026-09-30",
      document_type: "RULE",
      cfr_part101_only: true,
    });
    const result = await processRegulatoryIngestion(
      j,
      "test-worker",
      h.repository,
      h.ecfr,
      h.fr,
    );
    expect(result).toMatchObject({
      created_review_tasks: 120,
      total_results: 120,
      scanned_documents: 120,
      active_rules_changed: false,
    });
    expect(h.repository.stage).not.toHaveBeenCalled();
    expect(h.snapshots.every((s) => s.status === "DRAFT")).toBe(true);
    expect(h.snapshots[0].metadata).toMatchObject({
      part101: true,
      monitor_only: true,
      official_edition_required: true,
    });
    expect(
      (
        await processRegulatoryIngestion(
          j,
          "test-worker",
          h.repository,
          h.ecfr,
          h.fr,
        )
      ).created_review_tasks,
    ).toBe(0);
    const first = h.docs[0].meta.api_url;
    expect(new URL(first).searchParams.get("conditions[cfr][title]")).toBe(
      "21",
    );
  });
  it("refuses Federal Register truncation above 2000 results and never fetches unapproved queries", async () => {
    const h = await harness(
      () =>
        new Response(JSON.stringify({ count: 2001, results: [] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      processRegulatoryIngestion(
        job("fr_monitor", { start_date: "2026-09-01", end_date: "2026-09-30" }),
        "test-worker",
        h.repository,
        h.ecfr,
        h.fr,
      ),
    ).rejects.toMatchObject({ code: "FR_WINDOW_TOO_LARGE" });
    expect(h.repository.record).not.toHaveBeenCalled();
    await expect(
      processRegulatoryIngestion(
        job("fr_monitor", {
          term: "Customer brand secrets",
          start_date: "2026-09-01",
          end_date: "2026-09-30",
        }),
        "test-worker",
        h.repository,
        h.ecfr,
        h.fr,
      ),
    ).rejects.toMatchObject({ code: "LEGAL_QUERY_REQUIRED" });
    expect(h.docs).toHaveLength(1);
  });
});
