import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import {
  parseFdaHtml,
  FdaHtmlParseError,
  FDA_HTML_PARSER_VERSION,
} from "../src/lib/fda-html-parser";
import {
  parseFdaPdf,
  FdaPdfParseError,
  FDA_PDF_PARSER_VERSION,
} from "../src/lib/fda-pdf-parser";

const html = `<!doctype html>
<html><head>
  <title>Label Claims for Conventional Foods</title>
  <meta property="article:modified_time" content="2024-04-05T15:16:17Z">
</head><body>
  <header class="site-header"><h1>Header noise</h1></header>
  <nav>Navigation noise must not enter the snapshot.</nav>
  <main id="main-content">
    <h1 id="page-title">Label Claims for Conventional Foods</h1>
    <p>FDA describes multiple types of claims that may appear on conventional food and dietary supplement labels.</p>
    <div class="in-this-section"><a href="#health">In this section navigation noise</a></div>
    <h2 id="health">Health Claims</h2>
    <p>Health claims describe a relationship between a food substance and reduced risk of a disease or health-related condition.</p>
    <h3 id="qualified">Qualified Health Claims</h3>
    <p>Qualified claims depend on the totality and strength of scientific evidence. This text is extracted only and is not a legal conclusion.</p>
    <h2>Nutrient Content Claims</h2>
    <p>Nutrient content claims characterize the level of a nutrient in the food.</p>
  </main>
  <footer>Footer noise must not enter the snapshot.</footer>
</body></html>`;

async function pdfFixture(includeBlankPage = false) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("A Food Labeling Guide");
  pdf.setAuthor("U.S. Food and Drug Administration");
  pdf.setModificationDate(new Date("2013-01-15T12:00:00.000Z"));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([612, 792]);
  first.drawText("A Food Labeling Guide", { x: 48, y: 740, size: 20, font });
  first.drawText("Guidance for Industry · January 2013", {
    x: 48,
    y: 704,
    size: 12,
    font,
  });
  first.drawText("The guide provides answers to common food labeling questions.", {
    x: 48,
    y: 660,
    size: 12,
    font,
  });
  if (includeBlankPage) pdf.addPage([612, 792]);
  const second = pdf.addPage([612, 792]);
  second.drawText("General Food Labeling Requirements", {
    x: 48,
    y: 740,
    size: 16,
    font,
  });
  second.drawText("Place required statements on the principal display panel.", {
    x: 48,
    y: 700,
    size: 12,
    font,
  });
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

describe("FDA Guidance parser adapters", () => {
  it("extracts only the FDA HTML main content and keeps heading/anchor citations", () => {
    const parsed = parseFdaHtml(
      new TextEncoder().encode(html),
      "fda-label-claims",
    );
    expect(parsed.validation.parser_version).toBe(FDA_HTML_PARSER_VERSION);
    expect(parsed.validation.coverage_complete).toBe(true);
    expect(parsed.validation.citations_valid).toBe(true);
    expect(parsed.document_revision_date).toBe("2024-04-05");
    expect(parsed.page_title).toBe("Label Claims for Conventional Foods");
    expect(parsed.main_content_selector).toBe("main#main-content");
    expect(parsed.validation.heading_count).toBe(4);
    expect(parsed.chunks.length).toBeGreaterThanOrEqual(4);
    expect(parsed.chunks.every((chunk) => chunk.citation_precision === "heading")).toBe(true);
    expect(parsed.chunks.every((chunk) => chunk.source_anchor.startsWith("https://www.fda.gov/"))).toBe(true);
    expect(parsed.chunks.some((chunk) => chunk.citation.endsWith("— Health Claims"))).toBe(true);
    expect(parsed.chunks.some((chunk) => chunk.source_anchor.endsWith("#health"))).toBe(true);
    const allText = parsed.sections.map((section) => section.content).join(" ");
    expect(allText).not.toContain("Navigation noise");
    expect(allText).not.toContain("Footer noise");
    expect(allText).not.toContain("In this section navigation noise");
    expect(allText).toContain("Health claims describe a relationship");
  });

  it("rejects non-HTML bodies rather than treating arbitrary text as a guidance page", () => {
    expect(() =>
      parseFdaHtml(new TextEncoder().encode("not html"), "fda-label-claims"),
    ).toThrow(FdaHtmlParseError);
  });

  it("extracts selectable PDF text page by page with PDF-viewer page citations", async () => {
    const bytes = await pdfFixture();
    const parsed = await parseFdaPdf(bytes, "fda-food-label-guide");
    expect(parsed.validation.parser_version).toBe(FDA_PDF_PARSER_VERSION);
    expect(parsed.validation.page_count).toBe(2);
    expect(parsed.validation.processed_page_count).toBe(2);
    expect(parsed.validation.text_page_count).toBe(2);
    expect(parsed.validation.coverage_complete).toBe(true);
    expect(parsed.validation.citations_valid).toBe(true);
    expect(parsed.document_revision_date).toBe("2013-01-15");
    expect(parsed.document_revision_label).toBe("January 2013");
    expect(parsed.revision_date_source).toBe("PDF Info ModDate");
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.chunks).toHaveLength(2);
    expect(parsed.chunks[0]).toMatchObject({
      citation: "FDA Food Labeling Guide, PDF page 1",
      citation_precision: "page",
      source_anchor:
        "https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf#page=1",
    });
    expect(parsed.chunks.map((chunk) => chunk.content).join(" ")).toContain(
      "common food labeling questions",
    );
  });

  it("records page-level text gaps as incomplete coverage without inventing OCR text", async () => {
    const parsed = await parseFdaPdf(
      await pdfFixture(true),
      "fda-food-label-guide",
    );
    expect(parsed.validation.page_count).toBe(3);
    expect(parsed.validation.processed_page_count).toBe(3);
    expect(parsed.validation.text_page_count).toBe(2);
    expect(parsed.validation.coverage_complete).toBe(false);
    expect(parsed.sections[1]).toMatchObject({ section: "page:2", content: "" });
    expect(parsed.chunks.every((chunk) => chunk.citation_precision === "page")).toBe(true);
    expect(parsed.validation.warnings.join(" ")).toContain("OCR was not attempted");
  });

  it("checks the PDF signature before parsing and never falls back to guessed text", async () => {
    await expect(
      parseFdaPdf(new TextEncoder().encode("%PDF? no"), "fda-food-label-guide"),
    ).rejects.toBeInstanceOf(FdaPdfParseError);
  });
});
