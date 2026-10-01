import { SaxesParser } from "saxes";
import type {
  ParsedRegulatoryChunk,
  ParsedSection,
  ParserValidation,
} from "./knowledge-types";
export const ECFR_PARSER_VERSION = "vexim-ecfr-xml/1.1.0";
interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: (XmlNode | string)[];
  parent?: XmlNode;
}
export class EcfrParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EcfrParseError";
  }
}
const normalized = (s: string) =>
  s
    .replace(/[\t \u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
function text(n: XmlNode): string {
  return normalized(
    n.children
      .map((c) =>
        typeof c === "string"
          ? c
          : `${["P", "FP", "HEAD", "SECTNO", "NOTE", "TR", "TD", "TH", "ENTRY", "SOURCE", "AUTH"].includes(c.tag) ? "\n" : ""}${text(c)}${["P", "FP", "HEAD", "SECTNO", "NOTE", "TR", "TD", "TH", "ENTRY"].includes(c.tag) ? "\n" : ""}`,
      )
      .join(""),
  );
}
function all(n: XmlNode, p: (n: XmlNode) => boolean): XmlNode[] {
  return [
    ...(p(n) ? [n] : []),
    ...n.children.flatMap((c) => (typeof c === "string" ? [] : all(c, p))),
  ];
}
export function sectionTopic(section: string) {
  return (
    (
      {
        "101.3": "identity",
        "101.4": "ingredients",
        "101.5": "responsible_party",
        "101.7": "net_quantity",
        "101.9": "nutrition_labeling",
        "101.13": "claims",
        "101.15": "readability",
      } as Record<string, string>
    )[section] ?? "general"
  );
}
const roman =
  /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi|xvii|xviii|xix|xx)$/;
function styledText(n: XmlNode): string {
  const inner = n.children
    .map((c) => (typeof c === "string" ? c : styledText(c)))
    .join("");
  return (n.tag === "E" && n.attrs.T === "03") || n.tag === "I"
    ? `\u0001${inner}\u0002`
    : inner;
}
function pathFor(
  prefixes: string[],
  previous: string[],
  italics: boolean[],
): { path: string[]; resolved: boolean } {
  // A complete explicit chain is authoritative. Never infer deeper italic levels from text alone.
  if (prefixes.length > 1) {
    const kinds = [/^[a-z]$/, /^\d+$/, roman, /^[A-Z]$/, /^\d+$/, roman];
    if (prefixes.length > 6 || prefixes.some((p, i) => !kinds[i].test(p)))
      return { path: [], resolved: false };
    return { path: prefixes, resolved: true };
  }
  const token = prefixes[0];
  const result = [...previous];
  let level: number;
  if (/^[A-Z]$/.test(token)) {
    if (result.length < 3) return { path: [], resolved: false };
    level = 3;
  } else if (/^\d+$/.test(token)) {
    if (!result.length) return { path: [], resolved: false };
    if (italics[0]) {
      if (result.length < 4) return { path: [], resolved: false };
      level = 4;
    } else {
      if (result.length >= 4) return { path: [], resolved: false };
      level = 1;
    }
  } else if (/^[a-z]$/.test(token) || roman.test(token)) {
    const nextTop =
      previous[0]?.length === 1 &&
      token.length === 1 &&
      token.charCodeAt(0) === previous[0].charCodeAt(0) + 1;
    if (roman.test(token)) {
      if (italics[0]) {
        if (result.length < 5) return { path: [], resolved: false };
        level = 5;
      } else if (result.length >= 2) {
        // (i), (v), (x) can be either a top-level letter or nested roman. Do not guess.
        if (nextTop || result.length >= 4) return { path: [], resolved: false };
        level = 2;
      } else if (token.length === 1 && nextTop) level = 0;
      else return { path: [], resolved: false };
    } else if (token.length === 1) level = 0;
    else return { path: [], resolved: false };
  } else return { path: [], resolved: false };
  if (level > 0 && result.length < level) return { path: [], resolved: false };
  result.splice(level);
  result[level] = token;
  return { path: result, resolved: true };
}
function ancestors(n: XmlNode) {
  const result: XmlNode[] = [];
  let node: XmlNode | undefined = n;
  while (node) {
    result.unshift(node);
    node = node.parent;
  }
  return result;
}
function hierarchy(n: XmlNode) {
  return ancestors(n)
    .filter((x) => !!x.attrs.TYPE || x.tag === "SECTION")
    .map((x) => ({
      type: (x.attrs.TYPE ?? x.tag).toLowerCase(),
      identifier: x.attrs.N ?? x.attrs.IDENTIFIER ?? "",
      heading: text(
        x.children.find(
          (c): c is XmlNode => typeof c !== "string" && c.tag === "HEAD",
        ) ?? { tag: "HEAD", attrs: {}, children: [] },
      ),
    }));
}

export function ecfrCitation(section: string, path: string[] = []) {
  if (
    !/^101\.\d{1,3}$/.test(section) ||
    path.some((p) => !/^([a-zA-Z]|\d+|[ivx]+)$/.test(p))
  )
    throw new EcfrParseError("Invalid registered section/paragraph citation.");
  return `21 CFR ${section}${path.map((p) => `(${p})`).join("")}`;
}
export function ecfrCanonicalUrl(
  issueDate: string,
  section: string,
  path: string[] = [],
) {
  return `https://www.ecfr.gov/on/${issueDate}/title-21/section-${section}${path.length ? `#p-${section}${path.map((p) => `(${p})`).join("")}` : ""}`;
}
export function structureSections(
  payload: unknown,
): { section: string; reserved: boolean }[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new EcfrParseError("Structure response is not a hierarchy object.");
  const out: { section: string; reserved: boolean }[] = [];
  const visit = (
    node: Record<string, unknown>,
    inside101 = false,
    depth = 0,
  ) => {
    if (depth > 40)
      throw new EcfrParseError("Structure exceeds hierarchy depth.");
    const isPart = node.type === "part";
    const within = isPart ? String(node.identifier) === "101" : inside101;
    if (node.type === "section" && within) {
      const section = String(node.identifier);
      if (!/^101\.\d{1,3}$/.test(section))
        throw new EcfrParseError(
          "Unexpected section identifier in Part 101 structure.",
        );
      out.push({
        section,
        reserved:
          /\[Reserved\]/i.test(String(node.label ?? "")) ||
          node.reserved === true,
      });
    }
    if (Array.isArray(node.children))
      for (const c of node.children) {
        if (!c || typeof c !== "object" || Array.isArray(c))
          throw new EcfrParseError("Invalid structure child.");
        visit(c as Record<string, unknown>, within, depth + 1);
      }
  };
  visit(payload as Record<string, unknown>);
  if (!out.length)
    throw new EcfrParseError(
      "Title structure did not contain Part 101 sections.",
    );
  if (new Set(out.map((x) => x.section)).size !== out.length)
    throw new EcfrParseError("Duplicate structure sections.");
  return out;
}
export function parseEcfrXml(
  bytes: Uint8Array,
  options: {
    issueDate: string;
    expectedSections?: { section: string; reserved: boolean }[];
    section?: string;
  },
): {
  sections: ParsedSection[];
  chunks: ParsedRegulatoryChunk[];
  validation: ParserValidation;
} {
  if (bytes.length > 20 * 1024 * 1024)
    throw new EcfrParseError("XML exceeds parser size budget.");
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new EcfrParseError("XML is not valid UTF-8.");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new EcfrParseError(
      "DTD/entity declarations are forbidden; no external entity resolution.",
    );
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let nodes = 0;
  const sax = new SaxesParser({ xmlns: false });
  sax.on("opentag", (tag) => {
    if (++nodes > 250000 || stack.length > 80)
      throw new EcfrParseError("XML hierarchy exceeds parser limits.");
    const n: XmlNode = {
      tag: tag.name.toUpperCase().split(":").at(-1)!,
      attrs: Object.fromEntries(
        Object.entries(tag.attributes).map(([k, v]) => [
          k.toUpperCase(),
          String(v),
        ]),
      ),
      children: [],
    };
    if (stack.length) {
      n.parent = stack.at(-1)!;
      n.parent.children.push(n);
    } else if (!root) root = n;
    else throw new EcfrParseError("Multiple XML roots.");
    stack.push(n);
  });
  const append = (s: string) => {
    stack.at(-1)?.children.push(s);
  };
  sax.on("text", append);
  sax.on("cdata", append);
  sax.on("closetag", () => {
    stack.pop();
  });
  sax.on("error", () => {
    throw new EcfrParseError("Malformed eCFR XML.");
  });
  try {
    sax.write(xml).close();
  } catch (e) {
    if (e instanceof EcfrParseError) throw e;
    throw new EcfrParseError("Malformed eCFR XML.");
  }
  if (!root) throw new EcfrParseError("XML is empty.");
  const sectionNodes = all(
    root,
    (n) =>
      (n.tag === "DIV8" && n.attrs.TYPE === "SECTION") || n.tag === "SECTION",
  );
  if (!sectionNodes.length)
    throw new EcfrParseError(
      "No DIV8/SECTION nodes found; refusing a zero-chunk snapshot.",
    );
  const sections: ParsedSection[] = [];
  const chunks: ParsedRegulatoryChunk[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let paragraphCount = 0;
  for (const node of sectionNodes) {
    const head = all(node, (n) => n.tag === "HEAD")[0];
    const sectionHierarchy = hierarchy(node);
    const number = all(node, (n) => n.tag === "SECTNO")[0];
    const section =
      node.attrs.N ??
      node.attrs.IDENTIFIER ??
      (number ? text(number).match(/101\.\d+/)?.[0] : undefined) ??
      (head ? text(head).match(/101\.\d+/)?.[0] : undefined);
    if (!section || !/^101\.\d{1,3}$/.test(section))
      throw new EcfrParseError("Section without a valid Part 101 identifier.");
    if (options.section && section !== options.section)
      throw new EcfrParseError("API section does not match requested section.");
    if (seen.has(section)) throw new EcfrParseError("Duplicate XML section.");
    seen.add(section);
    const heading = head ? text(head) : `${section}`;
    const content = text(node);
    if (!content) throw new EcfrParseError("Empty section.");
    const reserved = /\[Reserved\]/i.test(heading);
    const topic = sectionTopic(section);
    sections.push({ section, heading, content, reserved, topic });
    let sequence = 0;
    const add = (
      content: string,
      path: string[],
      precision: ParsedRegulatoryChunk["citation_precision"],
      heading: string | null,
      xmlTag = "SECTION",
    ) => {
      if (!content.trim()) throw new EcfrParseError("Empty chunk.");
      const seq = sequence++;
      chunks.push({
        chunk_key: `${section}:${seq}`,
        section,
        citation: ecfrCitation(section, path),
        heading,
        content,
        hierarchy: sectionHierarchy,
        xml_tag: xmlTag,
        cross_references: [
          ...new Set(
            [
              ...content.matchAll(/§{1,2}\s*\d+\.\d+(?:\([a-zA-Z0-9]+\))*/g),
            ].map((x) => x[0]),
          ),
        ],
        topic,
        topics: [
          topic,
          ...(section === "101.9" && path[0] === "j" ? ["exemption"] : []),
        ],
        paragraph_path: path,
        citation_precision: precision,
        sequence: seq,
        source_anchor: ecfrCanonicalUrl(options.issueDate, section, path),
        obligation_type: /\b(?:exempt|exemption|except)\b/i.test(content)
          ? "exemption"
          : /\b(?:shall|must|required)\b/i.test(content)
            ? "mandatory"
            : /\b(?:if|provided that)\b/i.test(content)
              ? "conditional"
              : "guidance",
      });
    };
    add(content, [], "section", heading);
    let path: string[] = [];
    const usedParagraphs = new Set<string>();
    for (const p of all(
      node,
      (n) => n.tag === "P" || n.tag === "FP" || n.tag === "NOTE",
    )) {
      const ptext = text(p);
      if (!ptext) continue;
      paragraphCount++;
      const label = ptext.match(/^(\s*\([a-zA-Z0-9]+\))+/)?.[0];
      if (
        label &&
        p.tag === "P" &&
        !ancestors(p).some((x) =>
          ["TABLE", "GPOTABLE", "NOTE", "FP"].includes(x.tag),
        )
      ) {
        const tokens = [...label.matchAll(/\(([a-zA-Z0-9]+)\)/g)].map(
          (x) => x[1],
        );
        const styled = [
          ...styledText(p).matchAll(
            /(\u0001?)\((\u0001?)([a-zA-Z0-9]+)(\u0002?)\)(\u0002?)/g,
          ),
        ].slice(0, tokens.length);
        const italics = styled.map((x) => !!(x[1] || x[2] || x[4] || x[5]));
        const resolved = pathFor(tokens, path, italics);
        if (resolved.resolved) {
          path = resolved.path;
          const cite = ecfrCitation(section, path);
          if (usedParagraphs.has(cite)) {
            warnings.push(
              `${section}: repeated paragraph ${cite}; retained as section-level evidence`,
            );
            path = [];
            add(ptext, [], "unresolved", null, p.tag);
          } else {
            usedParagraphs.add(cite);
            add(ptext, path, "paragraph", null, p.tag);
          }
        } else {
          path = [];
          warnings.push(`${section}: unresolved numbering ${label.trim()}`);
          add(ptext, [], "unresolved", null, p.tag);
        }
      } else add(ptext, [], "section", p.tag === "NOTE" ? "Note" : null, p.tag);
    }
  }
  const expected = options.expectedSections ?? [];
  const missing = expected
    .filter((e) => !seen.has(e.section) && !e.reserved)
    .map((e) => e.section);
  const unexpected = expected.length
    ? sections
        .filter((s) => !expected.some((e) => e.section === s.section))
        .map((s) => s.section)
    : [];
  if (unexpected.length)
    throw new EcfrParseError(
      "XML contains sections outside the verified Title 21 structure.",
    );
  const keys = chunks.map((c) => c.chunk_key);
  if (new Set(keys).size !== keys.length)
    throw new EcfrParseError("Duplicate chunk keys.");
  return {
    sections,
    chunks,
    validation: {
      parser_version: ECFR_PARSER_VERSION,
      root_tag: root.tag,
      section_count: sections.length,
      paragraph_count: paragraphCount,
      chunk_count: chunks.length,
      coverage_complete: missing.length === 0,
      citations_valid: chunks.every(
        (c) =>
          c.content.trim() &&
          /^21 CFR 101\.\d+(?:\([a-zA-Z0-9]+\))*$/.test(c.citation),
      ),
      warnings,
      missing_sections: missing,
    },
  };
}
