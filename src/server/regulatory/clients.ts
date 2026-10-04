import { createHash, randomUUID } from "node:crypto";
import type {
  ApiSnapshotResponse,
  LegalSearchTerm,
} from "@/lib/knowledge-types";
import { LEGAL_SEARCH_TERMS } from "@/lib/knowledge-types";
import {
  FDA_GUIDANCE_SOURCES,
  type FdaGuidanceSourceKey,
} from "@/lib/fda-guidance";

export class RegulatoryApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
    public status: number | null = null,
    public retryAfter = 0,
  ) {
    super(message);
    this.name = "RegulatoryApiError";
  }
}
export class SourceNotFoundError extends RegulatoryApiError {
  constructor() {
    super(
      "SOURCE_NOT_FOUND",
      "Official source/date was not found.",
      false,
      404,
    );
    this.name = "SourceNotFoundError";
  }
}
export class SourceParseError extends RegulatoryApiError {
  constructor(message: string) {
    super("PARSE_FAILED", message);
    this.name = "SourceParseError";
  }
}
export interface ApiDocument {
  meta: ApiSnapshotResponse;
  body: Uint8Array;
  cache_hit: boolean;
}
export interface RegulatoryRequestEvent {
  family: "ecfr" | "federal_register" | "fda_guidance";
  api_url: string;
  response_status: number | null;
  error_code: string | null;
  raw_response_id: string | null;
  finished_at: string;
  latency_ms: number;
}
export interface RegulatoryHttpStore {
  get(cacheKey: string): Promise<ApiDocument | null>;
  save(document: ApiDocument): Promise<void>;
  reserve(family: string): Promise<number>;
  recordAttempt?(event: RegulatoryRequestEvent): Promise<void>;
}
interface HttpOptions {
  contact: string;
  fetch?: typeof fetch;
  store?: RegulatoryHttpStore;
  attempts?: number;
  timeoutMs?: number;
  maxBytes?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}
export function dateValue(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    throw new RegulatoryApiError("INVALID_DATE", "Invalid calendar date.");
  return value;
}
const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const retryStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
export function legalTerm(value: string): LegalSearchTerm {
  if (!(LEGAL_SEARCH_TERMS as readonly string[]).includes(value))
    throw new RegulatoryApiError(
      "LEGAL_QUERY_REQUIRED",
      "Only the predefined legal queries may be sent upstream. Never send customer data.",
    );
  return value as LegalSearchTerm;
}
export function latestTitleIssueDate(data: unknown, title = 21): string {
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as { titles?: unknown }).titles)
  )
    throw new SourceParseError("titles.json is missing its titles array.");
  const row = (data as { titles: Record<string, unknown>[] }).titles.find(
    (t) => Number(t.number) === title && t.reserved !== true,
  );
  if (!row || typeof row.latest_issue_date !== "string")
    throw new SourceParseError(`Title ${title} has no latest_issue_date.`);
  return dateValue(row.latest_issue_date);
}
export class RegulatoryHttpClient {
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  constructor(private options: HttpOptions) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.contact))
      throw new RegulatoryApiError(
        "CONTACT_REQUIRED",
        "Set REGULATORY_CONTACT_EMAIL to the approved operations contact.",
      );
    this.fetcher = options.fetch ?? fetch;
    this.sleep = options.sleep ?? wait;
    this.now = options.now ?? (() => new Date());
  }
  async get(
    family: "ecfr" | "federal_register",
    path: string,
    params: Record<string, string> = {},
    format: "json" | "xml" = "json",
    ttlHours = 24,
    force = false,
  ): Promise<ApiDocument> {
    const host =
      family === "ecfr"
        ? "https://www.ecfr.gov"
        : "https://www.federalregister.gov";
    if (
      !path.startsWith("/api/") ||
      path.includes("..") ||
      path.includes("?") ||
      path.includes("#")
    )
      throw new RegulatoryApiError(
        "UNSAFE_ENDPOINT",
        "Invalid official API path.",
      );
    const url = new URL(path, host);
    for (const [key, value] of Object.entries(params).sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      url.searchParams.set(key, value);
    const cacheKey = `${family}|${url.pathname}|${url.searchParams.toString()}`;
    return this.request(
      family,
      url,
      cacheKey,
      format,
      ttlHours,
      force,
      this.options.maxBytes ?? 20 * 1024 * 1024,
    );
  }
  async fdaDocument(
    sourceKey: FdaGuidanceSourceKey,
    force = false,
  ): Promise<ApiDocument> {
    const source = FDA_GUIDANCE_SOURCES[sourceKey];
    const format = source.format.toLowerCase() as "html" | "pdf";
    const url = new URL(source.canonical_url);
    const cacheKey = `fda_guidance|${sourceKey}|${url.href}`;
    const formatLimit =
      format === "html" ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
    return this.request(
      "fda_guidance",
      url,
      cacheKey,
      format,
      24 * 30,
      force,
      Math.min(this.options.maxBytes ?? 20 * 1024 * 1024, formatLimit),
    );
  }
  private async request(
    family: "ecfr" | "federal_register" | "fda_guidance",
    url: URL,
    cacheKey: string,
    format: "json" | "xml" | "html" | "pdf",
    ttlHours: number,
    force: boolean,
    maxBytes: number,
  ): Promise<ApiDocument> {
    if (!force) {
      const hit = await this.options.store?.get(cacheKey);
      if (
        hit &&
        hit.meta.validated &&
        new Date(hit.meta.expires_at) > this.now()
      )
        return { ...hit, cache_hit: true };
    }
    const attempts = Math.max(1, Math.min(3, this.options.attempts ?? 1));
    let last: RegulatoryApiError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (this.options.store) {
        const delay = await this.options.store.reserve(family);
        if (delay > 0) await this.sleep(delay);
      }
      const started = this.now();
      let recorded = false;
      let receivedStatus: number | null = null;
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30000);
      try {
        const accept =
          format === "xml"
            ? "application/xml, text/xml;q=0.9"
            : format === "html"
              ? "text/html, application/xhtml+xml;q=0.9"
              : format === "pdf"
                ? "application/pdf"
                : "application/json";
        const response = await this.fetcher(url, {
          method: "GET",
          headers: {
            Accept: accept,
            "Accept-Encoding":
              family === "fda_guidance" ? "identity" : "gzip, deflate",
            "User-Agent": `VeximLabelReview/0.1 (+mailto:${this.options.contact})`,
          },
          redirect: "manual",
          signal: timeout,
          cache: "no-store",
        });
        receivedStatus = response.status;
        const headers: Record<string, string> = {};
        for (const key of [
          "content-type",
          "etag",
          "last-modified",
          "retry-after",
          "date",
          "content-encoding",
          "cache-control",
        ]) {
          const value = response.headers.get(key);
          if (value) headers[key] = value.slice(0, 2000);
        }
        const parts: Uint8Array[] = [];
        let count = 0;
        if (Number(response.headers.get("content-length") ?? 0) > maxBytes) {
          await response.body?.cancel();
          throw new RegulatoryApiError(
            "RESPONSE_TOO_LARGE",
            "Official response exceeds the bounded ingestion budget.",
          );
        }
        const reader = response.body?.getReader();
        try {
          if (reader)
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              count += part.value.length;
              if (count > maxBytes) {
                await reader.cancel();
                throw new RegulatoryApiError(
                  "RESPONSE_TOO_LARGE",
                  "Official response exceeds the bounded ingestion budget.",
                );
              }
              parts.push(part.value);
            }
        } finally {
          reader?.releaseLock();
        }
        const body = new Uint8Array(count);
        let offset = 0;
        for (const part of parts) {
          body.set(part, offset);
          offset += part.length;
        }
        const contentType = headers["content-type"] ?? "";
        const essence = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
        let validated = false;
        if (response.status === 200) {
          try {
            if (format === "json" && /\bjson\b/i.test(contentType)) {
              JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
              validated = true;
            } else if (
              format === "xml" &&
              /\b(?:xml|text\/plain)\b/i.test(contentType)
            ) {
              const xml = new TextDecoder("utf-8", { fatal: true }).decode(body);
              validated =
                /^\s*(?:<\?xml[^>]*>\s*)?</.test(xml) &&
                !/<html(?:\s|>)/i.test(xml);
            } else if (
              format === "html" &&
              ["text/html", "application/xhtml+xml"].includes(essence)
            ) {
              const html = new TextDecoder("utf-8", { fatal: true }).decode(body);
              validated =
                /<html(?:\s|>)/i.test(html) && /<body(?:\s|>)/i.test(html);
            } else if (format === "pdf" && essence === "application/pdf") {
              const signature = new TextDecoder("latin1").decode(
                body.subarray(0, 1024),
              );
              validated = /%PDF-\d\.\d/.test(signature);
            }
          } catch {
            validated = false;
          }
        }
        const id = randomUUID();
        const retrievedAt = this.now().toISOString();
        const doc: ApiDocument = {
          meta: {
            id,
            family,
            cache_key: cacheKey,
            api_url: url.href,
            response_status: response.status,
            headers,
            content_type: contentType,
            content_hash: createHash("sha256").update(body).digest("hex"),
            byte_size: body.length,
            raw_storage_key: `${family}/${id}/response.${format}`,
            retrieved_at: retrievedAt,
            expires_at: new Date(
              this.now().getTime() + ttlHours * 3600000,
            ).toISOString(),
            latency_ms: Math.max(0, this.now().getTime() - started.getTime()),
            validated,
          },
          body,
          cache_hit: false,
        };
        await this.options.store?.save(doc);
        await this.options.store?.recordAttempt?.({
          family,
          api_url: url.href,
          response_status: response.status,
          error_code:
            response.status !== 200
              ? `HTTP_${response.status}`
              : validated
                ? null
                : "PARSE_FAILED",
          raw_response_id: doc.meta.id,
          finished_at: retrievedAt,
          latency_ms: doc.meta.latency_ms,
        });
        recorded = true;
        if (response.status === 404) throw new SourceNotFoundError();
        if (response.status !== 200) {
          const retryAfter = headers["retry-after"];
          const seconds = retryAfter
            ? Number(retryAfter) ||
              Math.max(0, (Date.parse(retryAfter) - this.now().getTime()) / 1000)
            : 0;
          throw new RegulatoryApiError(
            `HTTP_${response.status}`,
            `Official response returned HTTP ${response.status}.`,
            retryStatuses.has(response.status),
            response.status,
            Math.min(3600, Math.max(0, seconds)),
          );
        }
        if (!validated)
          throw new SourceParseError(
            "Official response has an unexpected MIME type or invalid body format.",
          );
        return doc;
      } catch (error) {
        last =
          error instanceof RegulatoryApiError
            ? error
            : new RegulatoryApiError(
                timeout.aborted ||
                  (error instanceof Error &&
                    /^(TimeoutError|AbortError)$/.test(error.name))
                  ? "UPSTREAM_TIMEOUT"
                  : "UPSTREAM_NETWORK",
                timeout.aborted
                  ? "Official source request timed out."
                  : "Cannot reach the official source over HTTPS.",
                true,
              );
        if (!recorded)
          await this.options.store?.recordAttempt?.({
            family,
            api_url: url.href,
            response_status: receivedStatus,
            error_code: last.code,
            raw_response_id: null,
            finished_at: this.now().toISOString(),
            latency_ms: Math.max(0, this.now().getTime() - started.getTime()),
          });
        if (!last.retryable || attempt === attempts) throw last;
        await this.sleep(
          Math.max(
            last.retryAfter * 1000,
            Math.min(60000, 2 ** attempt * 1000) + Math.random() * 500,
          ),
        );
      }
    }
    throw last!;
  }

}
export function documentJson<T>(document: ApiDocument): T {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(document.body),
    ) as T;
  } catch {
    throw new SourceParseError("Malformed UTF-8 JSON response.");
  }
}
export class EcfrClient {
  constructor(private http: RegulatoryHttpClient) {}
  titles(force = false) {
    return this.http.get(
      "ecfr",
      "/api/versioner/v1/titles.json",
      {},
      "json",
      6,
      force,
    );
  }
  structure(issueDate: string, title = 21, force = false) {
    if (title !== 21)
      throw new RegulatoryApiError(
        "MVP_SCOPE",
        "Only Title 21 discovery is enabled.",
      );
    return this.http.get(
      "ecfr",
      `/api/versioner/v1/structure/${dateValue(issueDate)}/title-21.json`,
      {},
      "json",
      24,
      force,
    );
  }
  part(issueDate: string, force = false) {
    return this.http.get(
      "ecfr",
      `/api/versioner/v1/full/${dateValue(issueDate)}/title-21.xml`,
      { part: "101" },
      "xml",
      24 * 30,
      force,
    );
  }
  section(issueDate: string, section: string, force = false) {
    if (!/^101\.\d{1,3}$/.test(section))
      throw new RegulatoryApiError(
        "MVP_SCOPE",
        "Only Part 101 sections are supported.",
      );
    return this.http.get(
      "ecfr",
      `/api/versioner/v1/full/${dateValue(issueDate)}/title-21.xml`,
      { section },
      "xml",
      24 * 30,
      force,
    );
  }
  search(query: LegalSearchTerm, issueDate?: string) {
    return this.http.get(
      "ecfr",
      "/api/search/v1/results",
      {
        query: legalTerm(query),
        ...(issueDate ? { date: dateValue(issueDate) } : {}),
      },
      "json",
      24,
    );
  }
}

export class FdaGuidanceClient {
  constructor(private http: RegulatoryHttpClient) {}
  labelClaims(force = false) {
    return this.http.fdaDocument("fda-label-claims", force);
  }
  foodLabelGuide(force = false) {
    return this.http.fdaDocument("fda-food-label-guide", force);
  }
}

export interface FederalRegisterDocument {
  document_number: string;
  title: string;
  type: string;
  publication_date: string;
  effective_on?: string | null;
  agencies?: { name: string; slug?: string; id?: number }[];
  cfr_references?: { title: number; part: number }[];
  abstract?: string | null;
  html_url?: string;
  pdf_url?: string;
  full_text_xml_url?: string;
  docket_ids?: string[];
  dates?: string;
}
export class FederalRegisterClient {
  constructor(private http: RegulatoryHttpClient) {}
  search(options: {
    term: LegalSearchTerm;
    start: string;
    end: string;
    page?: number;
    type?: "RULE" | "PRORULE" | "NOTICE";
    cfrPart101Only?: boolean;
  }) {
    if (dateValue(options.start) > dateValue(options.end))
      throw new RegulatoryApiError(
        "INVALID_DATE",
        "Publication window is reversed.",
      );
    const params: Record<string, string> = {
      "conditions[agencies][]": "food-and-drug-administration",
      "conditions[term]": legalTerm(options.term),
      "conditions[publication_date][gte]": options.start,
      "conditions[publication_date][lte]": options.end,
      per_page: "100",
      order: "newest",
      page: String(Math.max(1, Math.min(20, options.page ?? 1))),
    };
    if (
      (new Date(options.end).getTime() - new Date(options.start).getTime()) /
        86400000 >
      31
    )
      throw new RegulatoryApiError(
        "FR_WINDOW_TOO_LARGE",
        "Publication window must not exceed 32 calendar days.",
      );
    if (options.type) params["conditions[type][]"] = options.type;
    if (options.cfrPart101Only) {
      params["conditions[cfr][title]"] = "21";
      params["conditions[cfr][part]"] = "101";
    }
    return this.http.get(
      "federal_register",
      "/api/v1/documents.json",
      params,
      "json",
      6,
    );
  }
  document(number: string) {
    if (!/^\d{4}-\d{4,6}$/.test(number))
      throw new RegulatoryApiError(
        "INVALID_DOCUMENT",
        "Invalid Federal Register document number.",
      );
    return this.http.get(
      "federal_register",
      `/api/v1/documents/${number}.json`,
      {},
      "json",
      24 * 30,
    );
  }
}
