import { describe, expect, it } from "vitest";
import {
  regulatorySourceInputSchema,
  validateRegulatorySource,
} from "../src/lib/validation";

const excerpt = "21 CFR 101.13 — nutrient content claims. ".repeat(8); // 336 chars

function payload(overrides: Record<string, unknown> = {}) {
  return {
    id: "b0000000-0000-4000-8000-000000000007",
    source_key: "ecfr-101-13",
    authority: "eCFR",
    agency: "FDA",
    document_type: "regulation",
    citation: "21 CFR 101.13",
    title: "Nutrient content claims — general principles",
    canonical_url: "https://www.ecfr.gov/current/title-21/section-101.13",
    topic: "claims",
    priority: 1,
    retrieved_at: "2026-10-05T00:00:00.000Z",
    effective_from: null,
    effective_to: null,
    content_excerpt: excerpt,
    // Fields the browser spreads in; the server must ignore them, not reject.
    status: "DRAFT",
    version: 2,
    content_hash: "a".repeat(64),
    created_by: "c71d1b04-4793-4a3a-b823-4b55f963dc4b",
    ...overrides,
  };
}
const parse = (overrides: Record<string, unknown> = {}) =>
  regulatorySourceInputSchema.safeParse(payload(overrides));

describe("regulatorySourceInputSchema", () => {
  it("accepts a fully filled manual snapshot", () => {
    const result = parse();
    expect(result.success).toBe(true);
  });

  it("accepts a date-only retrieval date and normalises it to UTC ISO", () => {
    const result = parse({ retrieved_at: "2026-10-05" });
    expect(result.success).toBe(true);
    expect(result.data!.retrieved_at).toBe("2026-10-05T00:00:00.000Z");
  });

  it("accepts a local-offset datetime, which z.iso.datetime() used to reject", () => {
    const result = parse({ retrieved_at: "2026-10-05T07:00:00+07:00" });
    expect(result.success).toBe(true);
    expect(result.data!.retrieved_at).toBe("2026-10-05T00:00:00.000Z");
  });

  it("treats missing or empty effective dates as null", () => {
    const missing = parse({
      effective_from: undefined,
      effective_to: undefined,
    });
    expect(missing.success).toBe(true);
    expect(missing.data!.effective_from).toBeNull();
    expect(missing.data!.effective_to).toBeNull();
    const empty = parse({ effective_from: "", effective_to: "" });
    expect(empty.success).toBe(true);
    expect(empty.data!.effective_from).toBeNull();
  });

  it("reports each invalid field in Vietnamese", () => {
    const errors = validateRegulatorySource(
      payload({
        canonical_url: "ecfr.gov/101-13",
        content_excerpt: "quá ngắn",
        priority: 0,
        document_type: "blog",
        retrieved_at: "05/10/2026",
      }),
    );
    expect(errors.canonical_url).toMatch(/HTTPS/);
    expect(errors.content_excerpt).toMatch(/80 ký tự/);
    expect(errors.priority).toMatch(/1–6/);
    expect(errors.document_type).toMatch(/danh mục/);
    expect(errors.retrieved_at).toMatch(/YYYY-MM-DD/);
  });

  it("trims whitespace before checking the snapshot length", () => {
    expect(
      validateRegulatorySource(
        payload({ content_excerpt: `  ${"x".repeat(90)}  ` }),
      ),
    ).toEqual({});
  });

  it("rejects a snapshot that is not a valid HTTPS URL", () => {
    expect(parse({ canonical_url: "http://www.ecfr.gov/x" }).success).toBe(
      false,
    );
    expect(parse({ canonical_url: "not a url" }).success).toBe(false);
  });
});
