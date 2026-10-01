import type {
  RegulatoryIngestionJob,
  LegalSearchTerm,
  ParserValidation,
  ParsedSection,
  ParsedRegulatoryChunk,
  KnowledgeSnapshot,
} from "@/lib/knowledge-types";
import {
  parseEcfrXml,
  structureSections,
  ECFR_PARSER_VERSION,
} from "@/lib/ecfr-parser";
import { runRuleRegression } from "@/lib/regression";
import { RULE_CATALOG, SOURCE_CATALOG } from "@/lib/regulatory";
import {
  EcfrClient,
  FederalRegisterClient,
  documentJson,
  latestTitleIssueDate,
  RegulatoryApiError,
  SourceNotFoundError,
  SourceParseError,
  dateValue,
  legalTerm,
  type FederalRegisterDocument,
} from "./clients";
export interface IngestionRepository {
  active(key: string): Promise<KnowledgeSnapshot | null>;
  knownDocument(number: string): Promise<boolean>;
  record(
    jid: string,
    worker: string,
    p: Record<string, unknown>,
  ): Promise<KnowledgeSnapshot>;
  stage(
    jid: string,
    worker: string,
    id: string,
    sections: ParsedSection[],
    chunks: ParsedRegulatoryChunk[],
    validation: ParserValidation,
  ): Promise<unknown>;
  parseFailed(
    jid: string,
    worker: string,
    id: string,
    message: string,
  ): Promise<unknown>;
  federalDraft(jid: string, worker: string, id: string): Promise<unknown>;
}
export async function processRegulatoryIngestion(
  job: RegulatoryIngestionJob,
  worker: string,
  repository: IngestionRepository,
  ecfr: EcfrClient,
  fr: FederalRegisterClient,
): Promise<Record<string, unknown>> {
  if (job.kind === "fr_monitor") {
    const start = dateValue(String(job.params.start_date));
    const end = dateValue(String(job.params.end_date));
    const term = legalTerm(String(job.params.term ?? "food labeling"));
    const type = job.params.document_type as
      "RULE" | "PRORULE" | "NOTICE" | undefined;
    let created = 0,
      total = 0;
    const visited = new Set<string>();
    for (let page = 1; page <= 20; page++) {
      const search = await fr.search({
        start,
        end,
        term,
        type,
        page,
        cfrPart101Only: job.params.cfr_part101_only === true,
      });
      const payload = documentJson<{
        count: number;
        results: FederalRegisterDocument[];
      }>(search);
      if (
        !Number.isInteger(payload.count) ||
        payload.count < 0 ||
        !Array.isArray(payload.results)
      )
        throw new SourceParseError(
          "Federal Register search has an invalid shape.",
        );
      if (page === 1) total = payload.count;
      if (total > 2000)
        throw new RegulatoryApiError(
          "FR_WINDOW_TOO_LARGE",
          "Federal Register exposes only the first 2000 results; narrow the date window. No silently truncated monitoring result.",
        );
      for (const entry of payload.results) {
        if (!entry.document_number || visited.has(entry.document_number))
          continue;
        visited.add(entry.document_number);
        if (await repository.knownDocument(entry.document_number)) continue;
        const detail = await fr.document(entry.document_number);
        const doc = documentJson<FederalRegisterDocument>(detail);
        if (
          doc.document_number !== entry.document_number ||
          typeof doc.title !== "string" ||
          !doc.publication_date ||
          !Array.isArray(doc.agencies) ||
          !doc.agencies.some(
            (a) =>
              a.slug === "food-and-drug-administration" ||
              /food and drug administration/i.test(a.name),
          )
        )
          throw new SourceParseError(
            "Federal Register detail does not match the FDA search result.",
          );
        dateValue(doc.publication_date);
        const canonical = new URL(
          doc.html_url ??
            `https://www.federalregister.gov/documents/${doc.publication_date.replaceAll("-", "/")}/${doc.document_number}`,
        );
        if (canonical.origin !== "https://www.federalregister.gov")
          throw new SourceParseError(
            "Federal Register canonical URL is not official.",
          );
        const part101 =
          doc.cfr_references?.some(
            (ref) => Number(ref.title) === 21 && Number(ref.part) === 101,
          ) ?? false;
        const snapshot = await repository.record(job.id, worker, {
          source_key: `fr-${doc.document_number}`,
          source_version: doc.publication_date,
          parser_version: "vexim-fr-metadata/1.0.0",
          document_number: doc.document_number,
          raw_response_id: detail.meta.id,
          citation: `Federal Register ${doc.document_number}`,
          title: doc.title,
          canonical_url: canonical.href,
          metadata: {
            ...doc,
            part101,
            search_response_id: search.meta.id,
            monitor_only: true,
            official_edition_required: true,
          },
        });
        await repository.federalDraft(job.id, worker, snapshot.id);
        created++;
      }
      if (page * 100 >= total) break;
      if (!payload.results.length)
        throw new SourceParseError(
          "Federal Register pagination ended before its announced result count.",
        );
    }
    return {
      status: "monitor_completed",
      created_review_tasks: created,
      total_results: total,
      scanned_documents: visited.size,
      active_rules_changed: false,
    };
  }
  let titles = await ecfr.titles(!!job.params.force_refresh);
  let issue = latestTitleIssueDate(documentJson(titles));
  if (issue > new Date().toISOString().slice(0, 10))
    throw new SourceParseError(
      "Title 21 latest_issue_date is in the future. Never substitute today for an issue date.",
    );
  let structure = await ecfr.structure(issue, 21, !!job.params.force_refresh);
  let expected = structureSections(documentJson(structure));
  if (job.kind === "ecfr_discovery") {
    const query = legalTerm(String(job.params.term ?? "21 CFR 101"));
    const search = await ecfr.search(query as LegalSearchTerm, issue);
    const payload = documentJson(search);
    return {
      status: "discovery_completed",
      issue_date: issue,
      titles_response_id: titles.meta.id,
      structure_response_id: structure.meta.id,
      search_response_id: search.meta.id,
      section_count: expected.length,
      search: payload,
      evidence_only_after_full_fetch: true,
    };
  }
  const section =
    job.kind === "ecfr_section" ? String(job.params.section) : undefined;
  if (section && !expected.some((e) => e.section === section))
    throw new SourceNotFoundError();
  const key = section
    ? `ecfr-title21-section-${section}`
    : "ecfr-title21-part101";
  const active = await repository.active(key);
  if (
    active?.issue_date === issue &&
    active.parser_version === ECFR_PARSER_VERSION &&
    !job.params.force_refresh
  )
    return { status: "unchanged", issue_date: issue, snapshot_id: active.id };
  let document;
  try {
    document = section
      ? await ecfr.section(issue, section, !!job.params.force_refresh)
      : await ecfr.part(issue, !!job.params.force_refresh);
  } catch (error) {
    if (!(error instanceof SourceNotFoundError)) throw error;
    const refreshed = await ecfr.titles(true);
    const newIssue = latestTitleIssueDate(documentJson(refreshed));
    if (newIssue === issue) throw error;
    issue = newIssue;
    if (issue > new Date().toISOString().slice(0, 10))
      throw new SourceParseError("Refreshed issue date is in the future.");
    titles = refreshed;
    structure = await ecfr.structure(issue, 21, true);
    expected = structureSections(documentJson(structure));
    if (section && !expected.some((e) => e.section === section))
      throw new SourceNotFoundError();
    document = section
      ? await ecfr.section(issue, section, true)
      : await ecfr.part(issue, true);
  }
  const snapshot = await repository.record(job.id, worker, {
    source_key: key,
    source_version: issue,
    parser_version: ECFR_PARSER_VERSION,
    issue_date: issue,
    raw_response_id: document.meta.id,
    citation: section ? `21 CFR ${section}` : "21 CFR Part 101",
    title: section ? `21 CFR ${section}` : "21 CFR Part 101 — Food Labeling",
    canonical_url: section
      ? `https://www.ecfr.gov/on/${issue}/title-21/section-${section}`
      : `https://www.ecfr.gov/on/${issue}/title-21/chapter-I/subchapter-B/part-101`,
    metadata: {
      title_number: 21,
      part: "101",
      section: section ?? null,
      titles_response_id: titles.meta.id,
      structure_response_id: structure.meta.id,
    },
  });
  if (!["FETCHED", "PARSE_FAILED"].includes(snapshot.status))
    return {
      status: "snapshot_already_registered",
      snapshot_id: snapshot.id,
      issue_date: issue,
      chunk_count: snapshot.chunk_count,
    };
  try {
    const parsed = parseEcfrXml(document.body, {
      issueDate: issue,
      expectedSections: section
        ? expected.filter((e) => e.section === section)
        : expected,
      section,
    });
    if (
      !parsed.validation.coverage_complete ||
      !parsed.validation.citations_valid
    )
      throw new SourceParseError(
        `Parser validation failed: missing ${parsed.validation.missing_sections.join(", ")}.`,
      );
    // Synthetic regression inputs only. This tests deterministic code, not interpretation of the new law.
    const regression = runRuleRegression(RULE_CATALOG, SOURCE_CATALOG);
    parsed.validation.regression_passed =
      regression.length === 15 && regression.every((r) => r.passed);
    parsed.validation.regression_results = regression;
    if (!parsed.validation.regression_passed)
      throw new SourceParseError(
        "Deterministic regression fixtures failed; draft cannot be activated.",
      );
    if (Buffer.byteLength(JSON.stringify(parsed)) > 16 * 1024 * 1024)
      throw new SourceParseError(
        "Parsed knowledge payload exceeds the bounded persistence budget.",
      );
    await repository.stage(
      job.id,
      worker,
      snapshot.id,
      parsed.sections,
      parsed.chunks,
      parsed.validation,
    );
    return {
      status: "draft_created",
      snapshot_id: snapshot.id,
      issue_date: issue,
      chunk_count: parsed.chunks.length,
      section_count: parsed.sections.length,
      raw_hash: document.meta.content_hash,
      active_rules_changed: false,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "eCFR parser failed";
    await repository.parseFailed(job.id, worker, snapshot.id, message);
    throw error instanceof RegulatoryApiError
      ? error
      : new SourceParseError(message);
  }
}
