import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  RegulatoryHttpClient,
  EcfrClient,
  FdaGuidanceClient,
  FederalRegisterClient,
  latestTitleIssueDate,
  dateValue,
  RegulatoryApiError,
  SourceNotFoundError,
  type ApiDocument,
  type RegulatoryHttpStore,
} from "../src/server/regulatory/clients";
import { parseEcfrXml, structureSections } from "../src/lib/ecfr-parser";
const xml = () => readFile("tests/fixtures/regulatory/part101-structural.xml");
const mockStore = () => {
  const docs: ApiDocument[] = [];
  const store: RegulatoryHttpStore = {
    get: async (key) => docs.find((d) => d.meta.cache_key === key) ?? null,
    save: async (d) => {
      docs.push(d);
    },
    reserve: async () => 0,
  };
  return { docs, store };
};
const http = (
  fetcher: typeof fetch,
  store?: RegulatoryHttpStore,
  attempts = 1,
) =>
  new RegulatoryHttpClient({
    contact: "regulatory@test.example",
    fetch: fetcher,
    store,
    attempts,
    sleep: async () => {},
  });
describe("Official API clients: safe scope, cache and bounded failure policy", () => {
  it("uses latest_issue_date, not up_to_date_as_of or the current date", () => {
    expect(
      latestTitleIssueDate({
        titles: [
          {
            number: 21,
            latest_issue_date: "2026-09-25",
            up_to_date_as_of: "2026-09-29",
          },
        ],
      }),
    ).toBe("2026-09-25");
    expect(() => latestTitleIssueDate({ titles: [] })).toThrow();
  });
  it("provides titles/structure/part/section/search with dated cache keys, compressed XML and contact UA", async () => {
    const calls: { url: string; options?: RequestInit }[] = [];
    const fetcher = vi.fn(
      async (input: URL | RequestInfo, options?: RequestInit) => {
        calls.push({ url: String(input), options });
        const isXML = String(input).includes(".xml");
        return new Response(isXML ? await xml() : '{"titles":[]}', {
          headers: {
            "content-type": isXML ? "application/xml" : "application/json",
          },
        });
      },
    ) as unknown as typeof fetch;
    const { store, docs } = mockStore();
    const ecfr = new EcfrClient(http(fetcher, store));
    await ecfr.titles();
    await ecfr.structure("2026-09-25");
    const part = await ecfr.part("2026-09-25");
    await ecfr.section("2026-09-25", "101.9");
    await ecfr.search("21 CFR 101.9");
    await ecfr.part("2026-09-25");
    expect(calls).toHaveLength(5);
    expect(calls[2].url).toContain("part=101");
    expect(calls[3].url).toContain("section=101.9");
    expect(calls[4].url).toContain("/api/search/v1/results?");
    expect(
      (calls[2].options!.headers as Record<string, string>)["Accept-Encoding"],
    ).toContain("gzip");
    expect(
      (calls[0].options!.headers as Record<string, string>)["User-Agent"],
    ).toContain("regulatory@test.example");
    expect(calls[0].options!.redirect).toBe("manual");
    expect(part.meta.content_hash).toBe(
      createHash("sha256")
        .update(await xml())
        .digest("hex"),
    );
    expect(docs).toHaveLength(5);
  });
  it("keeps Federal Register agency/type/publication filters under conditions and fetches full detail", async () => {
    const fn = vi.fn(
      async (input: URL | RequestInfo) =>
        new Response(JSON.stringify({ request: String(input) }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const fr = new FederalRegisterClient(http(fn));
    await fr.search({
      term: "food labeling",
      start: "2026-09-01",
      end: "2026-09-30",
      type: "RULE",
    });
    await fr.document("2026-12345");
    const url = new URL(String(fn.mock.calls[0]?.[0]));
    expect(url.searchParams.get("conditions[agencies][]")).toBe(
      "food-and-drug-administration",
    );
    expect(url.searchParams.get("conditions[type][]")).toBe("RULE");
    expect(String(fn.mock.calls[1]?.[0])).toContain(
      "/documents/2026-12345.json",
    );
  });
  it.each([408, 425, 429, 500, 502, 503, 504])(
    "bounds retryable HTTP %s to three attempts and keeps response snapshots",
    async (status) => {
      const { store, docs } = mockStore();
      const fn = vi.fn(
        async () =>
          new Response("failure", {
            status,
            headers: { "retry-after": "1", "content-type": "text/plain" },
          }),
      );
      await expect(
        http(fn, store, 3).get("ecfr", "/api/versioner/v1/titles.json"),
      ).rejects.toMatchObject({ status, retryable: true });
      expect(fn).toHaveBeenCalledTimes(3);
      expect(docs).toHaveLength(3);
    },
  );
  it.each([400, 401, 403, 404])(
    "does not retry terminal HTTP %s",
    async (status) => {
      const fn = vi.fn(async () => new Response("error", { status }));
      await expect(
        http(fn, undefined, 3).get("ecfr", "/api/versioner/v1/titles.json"),
      ).rejects.toBeInstanceOf(
        status === 404 ? SourceNotFoundError : RegulatoryApiError,
      );
      expect(fn).toHaveBeenCalledTimes(1);
    },
  );
  it("saves invalid JSON/HTML responses but never considers them validated or active", async () => {
    const { store, docs } = mockStore();
    await expect(
      http(
        vi.fn(
          async () =>
            new Response("<html>Blocked</html>", {
              headers: { "content-type": "text/html" },
            }),
        ),
        store,
      ).get("ecfr", "/api/versioner/v1/titles.json"),
    ).rejects.toMatchObject({ code: "PARSE_FAILED" });
    expect(docs[0].meta.validated).toBe(false);
  });
  it("does not follow redirects or send arbitrary URLs/legal queries/customer data", async () => {
    const fn = vi.fn(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://example.org" },
        }),
    );
    const h = http(fn);
    await expect(h.get("ecfr", "https://example.org")).rejects.toThrow();
    await expect(
      h.get("ecfr", "/api/versioner/v1/titles.json"),
    ).rejects.toMatchObject({ code: "HTTP_302" });
    expect(() =>
      new EcfrClient(h).search("secret brand/formula" as never),
    ).toThrow(/legal queries/i);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("classifies network timeouts and size-limit failures", async () => {
    await expect(
      http(
        vi.fn(async () => {
          throw new DOMException("timeout", "TimeoutError");
        }),
      ).get("ecfr", "/api/versioner/v1/titles.json"),
    ).rejects.toMatchObject({ retryable: true });
    const h = new RegulatoryHttpClient({
      contact: "a@test.example",
      fetch: vi.fn(
        async () =>
          new Response("too large", {
            headers: {
              "content-type": "application/json",
              "content-length": "100",
            },
          }),
      ),
      maxBytes: 10,
    });
    await expect(
      h.get("ecfr", "/api/versioner/v1/titles.json"),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE", retryable: false });
  });
});
describe("Regulatory upstream request metrics", () => {
  it("records HTTPS network timeouts as failed attempts even without response bodies", async () => {
    const events: unknown[] = [];
    const { store, docs } = mockStore();
    store.recordAttempt = async (e) => {
      events.push(e);
    };
    const fn = vi.fn(async () => {
      throw new DOMException("timeout", "TimeoutError");
    });
    await expect(
      http(fn, store, 3).get("ecfr", "/api/versioner/v1/titles.json"),
    ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
    expect(events).toHaveLength(3);
    expect(docs).toHaveLength(0);
    expect(
      events.every(
        (e) =>
          (e as { raw_response_id: string | null }).raw_response_id === null,
      ),
    ).toBe(true);
  });
});
describe("eCFR XML parser and numbering traceability", () => {
  it("preserves all sections, nested numbers, FP/NOTE/table/inline text and dated anchors", async () => {
    const result = parseEcfrXml(await xml(), {
      issueDate: "2026-09-25",
      expectedSections: [
        { section: "101.3", reserved: false },
        { section: "101.7", reserved: false },
        { section: "101.9", reserved: false },
      ],
    });
    expect(result.validation.coverage_complete).toBe(true);
    expect(result.sections).toHaveLength(3);
    expect(result.validation.unresolved_citation_count).toBe(
      result.chunks.filter((chunk) => chunk.citation_precision === "unresolved")
        .length,
    );
    expect(result.validation.citation_paths_resolved).toBe(
      result.validation.unresolved_citation_count === 0,
    );
    expect(
      result.chunks.some((c) => c.citation === "21 CFR 101.3(b)(2)(ii)"),
    ).toBe(true);
    expect(
      result.chunks.some((c) => c.citation === "21 CFR 101.9(j)(18)"),
    ).toBe(true);
    expect(result.sections[2].content).toContain("Fixture nutrient");
    expect(result.sections[0].content).toContain("emphasis");
    expect(new Set(result.chunks.map((c) => c.chunk_key)).size).toBe(
      result.chunks.length,
    );
    expect(
      result.chunks.every(
        (c) => c.content && c.source_anchor.includes("/on/2026-09-25/"),
      ),
    ).toBe(true);
  });
  it("validates structure discovery instead of assuming all title nodes have one shape", () => {
    expect(
      structureSections({
        type: "title",
        identifier: "21",
        children: [
          {
            type: "chapter",
            children: [
              {
                type: "part",
                identifier: "101",
                children: [
                  {
                    type: "section",
                    identifier: "101.3",
                    label: "101.3 Identity",
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual([{ section: "101.3", reserved: false }]);
    expect(() => structureSections({})).toThrow();
  });
  it("refuses zero chunks, wrong sections, duplicate sections, DTD/XXE and malformed XML", async () => {
    for (const input of [
      "<DIV1/>",
      '<DIV8 TYPE="SECTION" N="999.1"><P>Bad</P></DIV8>',
      '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><DIV1>&x;</DIV1>',
      "<DIV1><P>unclosed",
    ])
      expect(() =>
        parseEcfrXml(Buffer.from(input), { issueDate: "2026-09-25" }),
      ).toThrow();
    const fixture = await xml();
    expect(() =>
      parseEcfrXml(fixture, { issueDate: "2026-09-25", section: "101.3" }),
    ).toThrow();
  });
  it("flags incomplete coverage and ambiguous/repeated numbering without inventing a paragraph citation", () => {
    const input =
      '<DIV8 TYPE="SECTION" N="101.9"><HEAD>Nutrition</HEAD><P>(18) orphan</P><P>(a) first</P><P>(a) repeated</P></DIV8>';
    const r = parseEcfrXml(Buffer.from(input), {
      issueDate: "2026-09-25",
      expectedSections: [
        { section: "101.3", reserved: false },
        { section: "101.9", reserved: false },
      ],
    });
    expect(r.validation.warnings).toHaveLength(2);
    expect(r.validation.citations_valid).toBe(true);
    expect(r.validation.unresolved_citation_count).toBe(2);
    expect(r.validation.citation_paths_resolved).toBe(false);
    expect(
      r.chunks
        .filter((c) => c.citation_precision === "unresolved")
        .every((c) => c.citation === "21 CFR 101.9"),
    ).toBe(true);
  });
  it("does not infer paragraph paths from isolated eCFR labels and reports precision separately from syntax", () => {
    const input =
      '<DIV8 TYPE="SECTION" N="101.9"><HEAD>Nutrition</HEAD><P>(ii) Isolated roman marker.</P><P>(B) Isolated uppercase marker.</P><P>(i) Isolated roman marker.</P><P>(11) Isolated number marker.</P></DIV8>';
    const r = parseEcfrXml(Buffer.from(input), { issueDate: "2026-09-30" });
    const unresolved = r.chunks.filter(
      (chunk) => chunk.citation_precision === "unresolved",
    );
    expect(unresolved).toHaveLength(4);
    expect(
      unresolved.every(
        (chunk) =>
          chunk.citation === "21 CFR 101.9" &&
          chunk.paragraph_path.length === 0 &&
          chunk.source_anchor ===
            "https://www.ecfr.gov/on/2026-09-30/title-21/section-101.9",
      ),
    ).toBe(true);
    expect(r.validation.citations_valid).toBe(true);
    expect(r.validation.unresolved_citation_count).toBe(4);
    expect(r.validation.citation_paths_resolved).toBe(false);
  });
  it("honors explicit six-level chains and italic numeric/roman labels, while refusing an unmarked deep reset", () => {
    const input =
      '<DIV8 TYPE="SECTION" N="101.9"><HEAD>Fixture</HEAD><P>(a) Root.</P><P>(1) Number.</P><P>(i) Roman.</P><P>(A) Upper.</P><P><E T="03">(1)</E> Italic number.</P><P><E T="03">(i)</E> Italic roman.</P><P>(2) Ambiguous unstyled number.</P><P>(j)(18)(ii) Explicit full chain.</P><FP>(3) Footnote, not paragraph number.</FP></DIV8>';
    const r = parseEcfrXml(Buffer.from(input), { issueDate: "2026-09-25" });
    expect(
      r.chunks.some((c) => c.citation === "21 CFR 101.9(a)(1)(i)(A)(1)(i)"),
    ).toBe(true);
    expect(r.chunks.some((c) => c.citation === "21 CFR 101.9(j)(18)(ii)")).toBe(
      true,
    );
    expect(
      r.chunks
        .filter((c) => c.citation_precision === "unresolved")
        .every((c) => c.citation === "21 CFR 101.9"),
    ).toBe(true);
    expect(r.chunks.find((c) => c.xml_tag === "FP")!.citation).toBe(
      "21 CFR 101.9",
    );
  });
  it("uses the fixed FDA HTML URL, validates MIME, and preserves exact response-body SHA-256", async () => {
    const bytes = new TextEncoder().encode(
      "<!doctype html><html><head></head><body><main>Official FDA content</main></body></html>",
    );
    const { docs, store } = mockStore();
    const fetcher = vi.fn(
      async (input: URL | RequestInfo, options?: RequestInit) => {
        expect(String(input)).toBe(
          "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements",
        );
        expect((options?.headers as Record<string, string>).Accept).toContain(
          "text/html",
        );
        return new Response(bytes, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    ) as unknown as typeof fetch;
    const client = new FdaGuidanceClient(http(fetcher, store));
    const first = await client.labelClaims();
    const cached = await client.labelClaims();
    expect(first.meta.family).toBe("fda_guidance");
    expect(first.meta.validated).toBe(true);
    expect(first.meta.raw_storage_key).toMatch(/response\.html$/);
    expect(first.body).toEqual(bytes);
    expect(first.meta.content_hash).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(cached.cache_hit).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(docs).toHaveLength(1);
  });

  it("checks the fixed FDA PDF MIME/signature and does not follow redirects", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nraw pdf bytes");
    const fetcher = vi.fn(async () =>
      new Response(bytes, {
        headers: { "content-type": "application/pdf" },
      }),
    ) as unknown as typeof fetch;
    const client = new FdaGuidanceClient(http(fetcher));
    const document = await client.foodLabelGuide();
    expect(document.meta.validated).toBe(true);
    expect(document.meta.content_type).toBe("application/pdf");
    expect(document.meta.raw_storage_key).toMatch(/response\.pdf$/);
    expect(document.body).toEqual(bytes);

    const redirected = new FdaGuidanceClient(
      http(
        vi.fn(async () =>
          new Response("", {
            status: 302,
            headers: {
              location: "https://example.invalid/not-fda.pdf",
              "content-type": "text/plain",
            },
          }),
        ) as unknown as typeof fetch,
      ),
    );
    await expect(redirected.foodLabelGuide(true)).rejects.toMatchObject({
      code: "HTTP_302",
    });
  });

  it("refuses an FDA HTML URL response with a mismatched MIME type", async () => {
    const { docs, store } = mockStore();
    const fetcher = vi.fn(async () =>
      new Response("<html><body>not typed as html</body></html>", {
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    await expect(
      new FdaGuidanceClient(http(fetcher, store)).labelClaims(),
    ).rejects.toMatchObject({ code: "PARSE_FAILED" });
    expect(docs).toHaveLength(1);
    expect(docs[0].meta.validated).toBe(false);
  });

  it("records hierarchy/cross-reference provenance and rejects impossible calendar dates", async () => {
    const r = parseEcfrXml(await xml(), { issueDate: "2026-09-25" });
    expect(r.chunks[0].hierarchy!.map((h) => h.type)).toEqual([
      "title",
      "part",
      "subpart",
      "section",
    ]);
    expect(r.chunks.some((c) => c.cross_references?.includes("§ 102.5"))).toBe(
      true,
    );
    for (const bad of [
      "2026-13-01",
      "2026-02-30",
      "2026-00-00",
      "2026-09-31",
      "not-a-date",
    ])
      expect(() => dateValue(bad)).toThrow(RegulatoryApiError);
  });
});
