import type {
  ParsedRegulatoryChunk,
  ParsedSection,
  ParserValidation,
} from "./knowledge-types";
import { FDA_GUIDANCE_SOURCES } from "./fda-guidance";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

export const FDA_PDF_PARSER_VERSION = "vexim-fda-pdf/1.0.0";
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 256;
const MAX_PAGE_TEXT_CHARS = 80_000;
const MAX_TOTAL_TEXT_CHARS = 12 * 1024 * 1024;
const MAX_CHUNK_CHARS = 3_200;

type PdfTextItem = TextItem;
export interface ParsedFdaPdf {
  document_revision_date: string | null;
  document_revision_label: string | null;
  revision_date_source: string | null;
  pdf_metadata: Record<string, string | null>;
  sections: ParsedSection[];
  chunks: ParsedRegulatoryChunk[];
  validation: ParserValidation;
}
export class FdaPdfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FdaPdfParseError";
  }
}

function normalized(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t \f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}
function pdfDate(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const match = /^D:(\d{4})(\d{2})(\d{2})/.exec(text);
  const date = match
    ? `${match[1]}-${match[2]}-${match[3]}`
    : /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(text)?.[1];
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}
function normalizedInfo(value: unknown) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500) || null : null;
}
function pageTextFromItems(items: PdfTextItem[]) {
  let text = "";
  let priorY: number | null = null;
  let priorRight: number | null = null;
  for (const item of items) {
    const value = item.str.replace(/\u00a0/g, " ");
    if (!value.trim()) continue;
    const x = item.transform[4] ?? null;
    const y = item.transform[5] ?? null;
    if (priorY !== null && y !== null && Math.abs(y - priorY) > 2.5) {
      text += "\n";
      priorRight = null;
    } else if (
      priorRight !== null &&
      x !== null &&
      x - priorRight > 1.5 &&
      !/[\s\n]$/.test(text)
    ) {
      text += " ";
    }
    text += value;
    if (item.hasEOL) text += "\n";
    if (y !== null) priorY = y;
    if (x !== null) priorRight = x + item.width;
  }
  return normalized(text);
}
function splitText(value: string, max = MAX_CHUNK_CHARS) {
  const words = value.split(/\s+/).filter(Boolean);
  const pieces: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > max && current) {
      pieces.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) pieces.push(current);
  return pieces;
}
function topicFor(text: string) {
  const value = text.toLowerCase();
  if (/allergen|sesame/.test(value)) return "allergens";
  if (/nutrition facts|nutrition label|nutrient|daily value/.test(value))
    return "nutrition_labeling";
  if (/health claim|nutrient claim|structure.function|claim/.test(value))
    return "claims";
  if (/ingredient/.test(value)) return "ingredients";
  if (/net quantity/.test(value)) return "net_quantity";
  if (/name of food|statement of identity/.test(value)) return "identity";
  return "general";
}
function pageHeading(text: string, page: number) {
  return text.split("\n").map((line) => line.trim()).find(Boolean)?.slice(0, 180) ?? `Page ${page}`;
}
function printedRevisionLabel(pages: { text: string }[]) {
  const openingPages = pages
    .slice(0, 2)
    .map((page) => page.text)
    .join("\n");
  const match = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)\s+(?:19|20)\d{2}\b/i.exec(openingPages);
  return match?.[0] ?? null;
}

export async function parseFdaPdf(
  bytes: Uint8Array,
  sourceKey: "fda-food-label-guide",
): Promise<ParsedFdaPdf> {
  const source = FDA_GUIDANCE_SOURCES[sourceKey];
  if (bytes.length === 0 || bytes.length > MAX_PDF_BYTES)
    throw new FdaPdfParseError("FDA PDF body is empty or exceeds 20 MiB.");
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!/%PDF-\d\.\d/.test(header))
    throw new FdaPdfParseError("Response does not have a PDF file signature.");

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableStream: true,
  });
  try {
    const document = await loadingTask.promise;
    if (document.numPages < 1 || document.numPages > MAX_PDF_PAGES)
      throw new FdaPdfParseError(
        `PDF page count ${document.numPages} is outside the 1-${MAX_PDF_PAGES} page budget.`,
      );
    const metadata = await document.getMetadata().catch(() => null);
    const info = (metadata?.info ?? {}) as Record<string, unknown>;
    const pdfMetadata: Record<string, string | null> = {
      title: normalizedInfo(info.Title),
      author: normalizedInfo(info.Author),
      creator: normalizedInfo(info.Creator),
      producer: normalizedInfo(info.Producer),
      creation_date: normalizedInfo(info.CreationDate),
      modification_date: normalizedInfo(info.ModDate),
    };
    const sections: ParsedSection[] = [];
    const pageContents: { page: number; text: string; heading: string }[] = [];
    const warnings: string[] = [];
    let totalTextChars = 0;
    let textPageCount = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const items = content.items.filter(
          (item): item is PdfTextItem => "str" in item,
        );
        const text = pageTextFromItems(items);
        if (text.length > MAX_PAGE_TEXT_CHARS)
          throw new FdaPdfParseError(
            `Extracted PDF page ${pageNumber} exceeds the text budget.`,
          );
        totalTextChars += text.length;
        if (totalTextChars > MAX_TOTAL_TEXT_CHARS)
          throw new FdaPdfParseError("Extracted PDF text exceeds the 12 MiB budget.");
        if (text) textPageCount++;
        else warnings.push(`PDF page ${pageNumber} has no selectable text; OCR was not attempted.`);
        const heading = pageHeading(text, pageNumber);
        pageContents.push({ page: pageNumber, text, heading });
        sections.push({
          section: `page:${pageNumber}`,
          heading: `PDF page ${pageNumber} · ${heading}`.slice(0, 300),
          topic: topicFor(`${heading}\n${text}`),
          content: text,
          reserved: false,
        });
      } finally {
        page.cleanup();
      }
    }

    const chunks: ParsedRegulatoryChunk[] = [];
    for (const item of pageContents) {
      if (!item.text) continue;
      const section = `page:${item.page}`;
      const topic = topicFor(`${item.heading}\n${item.text}`);
      for (const piece of splitText(item.text)) {
        const sequence = chunks.length;
        chunks.push({
          chunk_key: `${section}:${sequence}`,
          section,
          citation: `${source.citation}, PDF page ${item.page}`,
          heading: item.heading,
          content: piece,
          topic,
          topics: [topic],
          hierarchy: [
            {
              type: "page",
              identifier: String(item.page),
              heading: item.heading,
            },
          ],
          obligation_type: "guidance",
          paragraph_path: ["page", String(item.page)],
          citation_precision: "page",
          sequence,
          source_anchor: `${source.canonical_url}#page=${item.page}`,
        });
      }
    }

    if (!chunks.length)
      throw new FdaPdfParseError("No selectable text was extracted from any PDF page.");
    const citationsValid = chunks.every((chunk) => {
      const match = /^page:(\d+)$/.exec(chunk.section);
      return (
        !!match &&
        chunk.citation_precision === "page" &&
        chunk.citation === `${source.citation}, PDF page ${match[1]}` &&
        chunk.source_anchor === `${source.canonical_url}#page=${match[1]}`
      );
    });
    const coverageComplete =
      pageContents.length === document.numPages &&
      textPageCount === document.numPages &&
      chunks.length > 0;
    if (textPageCount !== document.numPages)
      warnings.push(
        `Selectable-text coverage is ${textPageCount}/${document.numPages} pages; scanned or blank pages require expert review.`,
      );
    if (!citationsValid) warnings.push("One or more PDF page citations could not be resolved.");
    const validation: ParserValidation = {
      parser_version: FDA_PDF_PARSER_VERSION,
      root_tag: "pdf",
      section_count: sections.length,
      paragraph_count: chunks.length,
      page_count: document.numPages,
      processed_page_count: pageContents.length,
      text_page_count: textPageCount,
      chunk_count: chunks.length,
      source_character_count: totalTextChars,
      extracted_character_count: totalTextChars,
      coverage_ratio: document.numPages ? textPageCount / document.numPages : 0,
      coverage_complete: coverageComplete,
      citations_valid: citationsValid,
      warnings,
      missing_sections: [],
    };
    const documentRevisionDate = pdfDate(info.ModDate);
    const documentRevisionLabel = printedRevisionLabel(pageContents);
    return {
      document_revision_date: documentRevisionDate,
      document_revision_label: documentRevisionLabel,
      revision_date_source: documentRevisionDate
        ? "PDF Info ModDate"
        : documentRevisionLabel
          ? "PDF title-page text"
          : null,
      pdf_metadata: pdfMetadata,
      sections,
      chunks,
      validation,
    };
  } catch (error) {
    if (error instanceof FdaPdfParseError) throw error;
    throw new FdaPdfParseError(
      error instanceof Error
        ? `Unable to parse FDA PDF: ${error.message.slice(0, 240)}`
        : "Unable to parse FDA PDF.",
    );
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}
