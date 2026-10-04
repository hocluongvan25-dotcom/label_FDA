import { parse } from "parse5";
import type {
  ParsedRegulatoryChunk,
  ParsedSection,
  ParserValidation,
} from "./knowledge-types";
import { FDA_GUIDANCE_SOURCES } from "./fda-guidance";

export const FDA_HTML_PARSER_VERSION = "vexim-fda-html/1.0.0";
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_CHUNK_CHARS = 3_200;

interface HtmlNode {
  nodeName: string;
  tagName?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HtmlNode[];
  value?: string;
}
interface ContentBlock {
  kind: "heading" | "text";
  text: string;
  level?: number;
  id?: string;
}
export interface ParsedFdaHtml {
  document_revision_date: string | null;
  revision_date_source: string | null;
  page_title: string;
  main_content_selector: string;
  sections: ParsedSection[];
  chunks: ParsedRegulatoryChunk[];
  validation: ParserValidation;
}
export class FdaHtmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FdaHtmlParseError";
  }
}

const SKIP_TAGS = new Set([
  "nav",
  "footer",
  "aside",
  "form",
  "script",
  "style",
  "noscript",
  "iframe",
  "svg",
  "template",
  "button",
  "select",
  "option",
]);
const BLOCK_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "th",
  "tr",
  "ul",
]);
const NOISE_CLASS =
  /(?:^|[\s_-])(?:navigation|navbar|breadcrumb|breadcrumbs|site-menu|section-nav|in-this-section|sidebar|site-footer|page-footer|social-links|sharing|related-links|cookie-banner|search-form|skip-link|pagination|utility-menu)(?:$|[\s_-])/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

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
function attr(node: HtmlNode, name: string) {
  return node.attrs?.find((item) => item.name.toLowerCase() === name)?.value;
}
function isElement(node: HtmlNode): node is HtmlNode & { tagName: string } {
  return typeof node.tagName === "string";
}
function shouldSkip(node: HtmlNode) {
  if (!isElement(node)) return false;
  const tag = node.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag) || attr(node, "aria-hidden")?.toLowerCase() === "true")
    return true;
  const role = attr(node, "role")?.toLowerCase() ?? "";
  if (["navigation", "search", "complementary"].includes(role)) return true;
  const marker = `${attr(node, "id") ?? ""} ${attr(node, "class") ?? ""}`;
  return NOISE_CLASS.test(marker);
}
function descendants(root: HtmlNode): HtmlNode[] {
  const found: HtmlNode[] = [];
  const visit = (node: HtmlNode) => {
    if (isElement(node)) found.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);
  return found;
}
function visibleText(root: HtmlNode): string {
  const parts: string[] = [];
  const visit = (node: HtmlNode) => {
    if (node.nodeName === "#text") {
      parts.push(node.value ?? "");
      return;
    }
    if (shouldSkip(node)) return;
    if (isElement(node) && node.tagName.toLowerCase() === "br") {
      parts.push("\n");
      return;
    }
    const block = isElement(node) && BLOCK_TAGS.has(node.tagName.toLowerCase());
    if (block) parts.push("\n");
    for (const child of node.childNodes ?? []) visit(child);
    if (block) parts.push("\n");
  };
  visit(root);
  return normalized(parts.join(""));
}
function titleOf(document: HtmlNode, main: HtmlNode) {
  const heading = descendants(main).find(
    (node) => isElement(node) && node.tagName.toLowerCase() === "h1",
  );
  if (heading) return visibleText(heading).slice(0, 300);
  const title = descendants(document).find(
    (node) => isElement(node) && node.tagName.toLowerCase() === "title",
  );
  return title ? visibleText(title).slice(0, 300) : "FDA guidance page";
}
function chooseMain(document: HtmlNode) {
  const elements = descendants(document);
  const mainById = elements.find(
    (node) =>
      isElement(node) &&
      node.tagName.toLowerCase() === "main" &&
      attr(node, "id")?.toLowerCase() === "main-content",
  );
  if (mainById) return { node: mainById, selector: "main#main-content" };
  const main = elements
    .filter((node) => isElement(node) && node.tagName.toLowerCase() === "main")
    .sort((a, b) => visibleText(b).length - visibleText(a).length)[0];
  if (main) return { node: main, selector: "main" };
  const byId = elements.find(
    (node) => isElement(node) && attr(node, "id")?.toLowerCase() === "main-content",
  );
  if (byId) return { node: byId, selector: "#main-content" };
  const article = elements
    .filter(
      (node) => isElement(node) && node.tagName.toLowerCase() === "article",
    )
    .sort((a, b) => visibleText(b).length - visibleText(a).length)[0];
  if (article) return { node: article, selector: "article" };
  const body = elements.find(
    (node) => isElement(node) && node.tagName.toLowerCase() === "body",
  );
  return body ? { node: body, selector: "body-fallback" } : null;
}
function contentBlocks(main: HtmlNode): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const visit = (node: HtmlNode) => {
    if (node.nodeName === "#text") {
      const value = normalized(node.value ?? "");
      if (value) blocks.push({ kind: "text", text: value });
      return;
    }
    if (shouldSkip(node)) return;
    if (!isElement(node)) {
      for (const child of node.childNodes ?? []) visit(child);
      return;
    }
    const tag = node.tagName.toLowerCase();
    const heading = /^h([1-6])$/.exec(tag);
    if (heading) {
      const text = visibleText(node);
      if (text)
        blocks.push({
          kind: "heading",
          text,
          level: Number(heading[1]),
          id: attr(node, "id"),
        });
      return;
    }
    if (["p", "li", "dt", "dd", "blockquote", "figcaption", "pre"].includes(tag)) {
      const text = visibleText(node);
      if (text) blocks.push({ kind: "text", text });
      return;
    }
    if (tag === "br") return;
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(main);
  return blocks;
}
function slug(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "section"
  );
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
function validIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}
function rawText(root: HtmlNode): string {
  if (root.nodeName === "#text") return root.value ?? "";
  return (root.childNodes ?? []).map(rawText).join("");
}
function jsonLdRevisionDate(root: HtmlNode): string | null {
  const scripts = descendants(root).filter(
    (node) =>
      isElement(node) &&
      node.tagName.toLowerCase() === "script" &&
      /ld\+json/i.test(attr(node, "type") ?? ""),
  );
  const inspect = (value: unknown, depth = 0): string | null => {
    if (depth > 8 || !value || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = inspect(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const record = value as Record<string, unknown>;
    const direct = validIsoDate(record.dateModified);
    if (direct) return direct;
    for (const child of Object.values(record)) {
      const found = inspect(child, depth + 1);
      if (found) return found;
    }
    return null;
  };
  for (const script of scripts) {
    try {
      const parsed: unknown = JSON.parse(rawText(script));
      const found = inspect(parsed);
      if (found) return found;
    } catch {
      // Invalid ancillary JSON-LD does not invalidate the source HTML.
    }
  }
  return null;
}
function revisionDate(document: HtmlNode) {
  for (const node of descendants(document)) {
    if (!isElement(node) || node.tagName.toLowerCase() !== "meta") continue;
    const key = `${attr(node, "property") ?? ""} ${attr(node, "name") ?? ""} ${attr(node, "itemprop") ?? ""}`.toLowerCase();
    if (!/(article:modified_time|date.?modified|last.?modified)/.test(key))
      continue;
    const date = validIsoDate(attr(node, "content"));
    if (date) return { date, source: key.trim() };
  }
  const jsonLdDate = jsonLdRevisionDate(document);
  return jsonLdDate
    ? { date: jsonLdDate, source: "JSON-LD dateModified" }
    : { date: null, source: null };
}
function topicFor(text: string, defaultTopic: string) {
  const value = text.toLowerCase();
  if (/allergen|food allergen|sesame/.test(value)) return "allergens";
  if (/nutrition facts|nutrition label|nutrient|daily value/.test(value))
    return "nutrition_labeling";
  if (/health claim|nutrient claim|structure.function|claim/.test(value))
    return "claims";
  if (/ingredient/.test(value)) return "ingredients";
  if (/net quantity/.test(value)) return "net_quantity";
  if (/name of food|statement of identity/.test(value)) return "identity";
  return defaultTopic;
}

export function parseFdaHtml(
  bytes: Uint8Array,
  sourceKey: "fda-label-claims",
): ParsedFdaHtml {
  const source = FDA_GUIDANCE_SOURCES[sourceKey];
  if (bytes.length === 0 || bytes.length > MAX_HTML_BYTES)
    throw new FdaHtmlParseError("FDA HTML body is empty or exceeds 5 MiB.");
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new FdaHtmlParseError("FDA HTML response is not valid UTF-8.");
  }
  if (!/<html(?:\s|>)/i.test(html) || !/<body(?:\s|>)/i.test(html))
    throw new FdaHtmlParseError("Response does not contain a complete HTML document.");

  const document = parse(html) as unknown as HtmlNode;
  const selected = chooseMain(document);
  if (!selected)
    throw new FdaHtmlParseError("No main/article/body content was found.");
  const sourceText = visibleText(selected.node);
  if (sourceText.length < 80)
    throw new FdaHtmlParseError("Selected FDA main content is too small to parse safely.");

  const rawBlocks = contentBlocks(selected.node);
  let current:
    | {
        heading: string;
        id: string | undefined;
        level: number;
        lines: string[];
      }
    | undefined;
  const draftSections: {
    section: string;
    heading: string;
    id?: string;
    level: number;
    content: string;
  }[] = [];
  let paragraphCount = 0;
  let headingCount = 0;
  let overviewSequence = 0;
  const finish = () => {
    if (!current) return;
    const content = normalized(current.lines.join("\n"));
    if (content) {
      const section = `heading:${slug(current.heading)}${overviewSequence ? `-${overviewSequence}` : ""}`;
      draftSections.push({
        section,
        heading: current.heading,
        ...(current.id ? { id: current.id } : {}),
        level: current.level,
        content,
      });
      overviewSequence++;
    }
    current = undefined;
  };
  const ensureOverview = () => {
    if (!current)
      current = {
        heading: "Overview",
        id: attr(selected.node, "id"),
        level: 1,
        lines: [],
      };
    return current;
  };
  for (const block of rawBlocks) {
    if (block.kind === "heading") {
      finish();
      current = {
        heading: block.text.slice(0, 300),
        id: block.id,
        level: block.level ?? 2,
        lines: [block.text],
      };
      headingCount++;
    } else {
      ensureOverview().lines.push(block.text);
      paragraphCount++;
    }
  }
  finish();
  if (!draftSections.length)
    throw new FdaHtmlParseError("Main content produced no heading sections.");

  const sections: ParsedSection[] = draftSections.map((item) => ({
    section: item.section,
    heading: item.heading,
    topic: topicFor(`${item.heading}\n${item.content}`, source.topic),
    content: item.content,
    reserved: false,
  }));
  const chunks: ParsedRegulatoryChunk[] = [];
  let sequence = 0;
  for (const item of draftSections) {
    const topic = topicFor(`${item.heading}\n${item.content}`, source.topic);
    const anchor = item.id
      ? `${source.canonical_url}#${encodeURIComponent(item.id)}`
      : `${source.canonical_url}#${encodeURIComponent(attr(selected.node, "id") ?? "main-content")}`;
    for (const piece of splitText(item.content)) {
      chunks.push({
        chunk_key: `${item.section}:${chunks.length}`,
        section: item.section,
        citation: `${source.citation} — ${item.heading}`,
        heading: item.heading,
        content: piece,
        topic,
        topics: [topic],
        hierarchy: [
          {
            type: "heading",
            identifier: item.id ?? item.section,
            heading: item.heading,
          },
        ],
        obligation_type: "guidance",
        paragraph_path: [],
        citation_precision: "heading",
        sequence: sequence++,
        source_anchor: anchor,
      });
    }
  }
  const extractedText = normalized(draftSections.map((item) => item.content).join("\n"));
  const coverageRatio = sourceText.length
    ? Math.min(1, extractedText.length / sourceText.length)
    : 0;
  const coverageComplete =
    headingCount > 0 &&
    draftSections.length > 0 &&
    chunks.length > 0 &&
    sourceText.length >= 120 &&
    coverageRatio >= 0.8;
  const citationsValid = chunks.every(
    (chunk) =>
      chunk.citation_precision === "heading" &&
      !!chunk.heading?.trim() &&
      chunk.citation.includes(chunk.heading) &&
      chunk.source_anchor.startsWith(`${source.canonical_url}#`),
  );
  const warnings: string[] = [];
  if (selected.selector === "body-fallback")
    warnings.push("Main content selector fell back to body; review navigation removal.");
  if (coverageRatio < 0.95)
    warnings.push(`Extracted main-content character coverage is ${(coverageRatio * 100).toFixed(1)}%.`);
  if (!coverageComplete)
    warnings.push("Heading/content coverage is incomplete; this draft is not eligible for activation.");
  if (!citationsValid)
    warnings.push("One or more heading citations could not be resolved.");
  const revision = revisionDate(document);
  const pageTitle = titleOf(document, selected.node);
  const validation: ParserValidation = {
    parser_version: FDA_HTML_PARSER_VERSION,
    root_tag: "html",
    section_count: sections.length,
    paragraph_count: paragraphCount,
    heading_count: headingCount,
    chunk_count: chunks.length,
    source_character_count: sourceText.length,
    extracted_character_count: extractedText.length,
    coverage_ratio: coverageRatio,
    coverage_complete: coverageComplete,
    citations_valid: citationsValid,
    warnings,
    missing_sections: [],
  };
  return {
    document_revision_date: revision.date,
    revision_date_source: revision.source,
    page_title: pageTitle,
    main_content_selector: selected.selector,
    sections,
    chunks,
    validation,
  };
}
