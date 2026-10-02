import type { Actor } from "./types";
import type {
  KnowledgeDashboard,
  KnowledgeSnapshot,
  RegulatoryIngestionJob,
  VersionedCitation,
  IngestionKind,
} from "./knowledge-types";
import { LEGAL_SEARCH_TERMS } from "./knowledge-types";
export interface KnowledgeChunkView {
  id: string;
  source_id: string;
  source_version: number;
  citation: string;
  heading: string | null;
  content: string;
  topic: string;
  review_status: string;
  snapshot_id: string;
  chunk_content_hash: string;
  citation_precision: string;
  source_anchor: string;
}
export interface KnowledgeDetail {
  snapshot: KnowledgeSnapshot;
  chunks: KnowledgeChunkView[];
  total_count: number;
  offset: number;
  page_size: number;
  regression?: {
    fresh?: boolean;
    passed: boolean;
    rule_refs: unknown[];
    test_results?: unknown[];
    created_at: string;
  } | null;
  affected_rules: {
    id: string;
    rule_key: string;
    name: string;
    status: string;
    test_status: string;
  }[];
  source_links: { section: string; source_id: string }[];
}
interface DemoKnowledge extends KnowledgeDashboard {
  chunks: KnowledgeChunkView[];
}
const KEY = "vexim-knowledge-demo-v1";
const issue = "2026-09-25"; // ONLY a clearly labeled synthetic demo edition, never a live latest_issue_date.
const stamp = () => new Date().toISOString();
const id = () => crypto.randomUUID();
async function digest(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const initial = (): DemoKnowledge => ({
  snapshots: [],
  jobs: [],
  alerts: [],
  chunks: [],
  metrics: {
    requests: 0,
    failures: 0,
    rate_limited: 0,
    parse_failures: 0,
    pending_approval: 0,
    active_age_days: null,
    retrieval_requests: 0,
    retrieval_hits: 0,
  },
  configured: false,
  contact_configured: false,
});
export function readKnowledgeDemo(): DemoKnowledge {
  try {
    const raw = localStorage.getItem(KEY);
    const d = raw ? (JSON.parse(raw) as DemoKnowledge) : initial();
    if (!Array.isArray(d.snapshots) || !Array.isArray(d.chunks))
      return initial();
    return d;
  } catch {
    return initial();
  }
}
function save(d: DemoKnowledge) {
  d.metrics.pending_approval = d.snapshots.filter((s) =>
    ["DRAFT", "REGULATORY_REVIEW"].includes(s.status),
  ).length;
  d.metrics.active_age_days = d.snapshots.some((s) => s.status === "ACTIVE")
    ? 0
    : null;
  localStorage.setItem(KEY, JSON.stringify(d));
}
export function detailKnowledgeDemo(
  snapshotId: string,
  offset = 0,
): KnowledgeDetail {
  const d = readKnowledgeDemo();
  const snapshot = d.snapshots.find((s) => s.id === snapshotId);
  if (!snapshot) throw new Error("Không có snapshot demo này.");
  const chunks = d.chunks.filter((c) => c.snapshot_id === snapshotId);
  return {
    snapshot,
    chunks: chunks.slice(offset, offset + 50),
    total_count: chunks.length,
    offset,
    page_size: 50,
    affected_rules: [],
    source_links: [],
    regression: {
      passed: true,
      rule_refs: [],
      created_at: snapshot.created_at,
    },
  };
}
export async function mutateKnowledgeDemo(
  path: string,
  body: Record<string, unknown>,
  actor: Actor,
): Promise<unknown> {
  const d = readKnowledgeDemo();
  if (actor.role !== "regulatory_admin" && path !== "retrieve")
    throw new Error("Chỉ Regulatory Admin có thể thay đổi kho tri thức.");
  if (path === "jobs") {
    const kind = body.kind as IngestionKind;
    const params = (body.params ?? {}) as Record<string, unknown>;
    if (
      params.term &&
      !(LEGAL_SEARCH_TERMS as readonly unknown[]).includes(params.term)
    )
      throw new Error("Chỉ các từ khóa pháp quy định sẵn.");
    const job: RegulatoryIngestionJob = {
      id: id(),
      kind,
      params,
      status: "completed",
      requested_by: actor.id,
      requested_at: stamp(),
      completed_at: stamp(),
      attempts: 1,
      locked_by: null,
      locked_until: null,
      response_status: null,
      error_code: null,
      error_message: null,
      result: { simulation: true, active_rules_changed: false },
      next_run_at: stamp(),
    };
    d.jobs.unshift(job);
    if (kind === "ecfr_discovery") {
      job.result = {
        ...job.result,
        issue_date: issue,
        section_count: 7,
        note: "Mô phỏng discovery, không gọi API thật.",
      };
      save(d);
      return job;
    }
    const section = String(params.section ?? "101.9");
    const fr = kind === "fr_monitor";
    const key = fr
      ? `fr-demo-${job.id}`
      : kind === "ecfr_section"
        ? `ecfr-title21-section-${section}`
        : "ecfr-title21-part101";
    const text = `DEMO ONLY · ${job.id}. Văn bản giả lập để kiểm tra quy trình version / phê duyệt. Không phải văn bản eCFR; không sử dụng làm căn cứ pháp lý.`;
    const hash = await digest(text);
    const sid = id();
    const snapshot: KnowledgeSnapshot = {
      id: sid,
      source_key: key,
      source_family: fr ? "federal_register" : "ecfr",
      citation: fr
        ? "Federal Register · DEMO"
        : kind === "ecfr_section"
          ? `21 CFR ${section}`
          : "21 CFR Part 101",
      title: fr
        ? "Văn bản FDA giả lập · cần chuyên viên rà soát"
        : "Food Labeling · snapshot mô phỏng",
      api_url: fr
        ? "https://www.federalregister.gov/api/v1/documents.json"
        : `https://www.ecfr.gov/api/versioner/v1/full/${issue}/title-21.xml?${kind === "ecfr_section" ? `section=${section}` : "part=101"}`,
      canonical_url: fr
        ? "https://www.federalregister.gov"
        : `https://www.ecfr.gov/on/${issue}/title-21/chapter-I/subchapter-B/part-101`,
      issue_date: fr ? null : issue,
      source_version: fr ? "DEMO" : issue,
      effective_from: null,
      effective_to: null,
      effective_date_unknown: true,
      raw_response_id: id(),
      content_hash: hash,
      parser_version: fr ? "vexim-fr-metadata/1.0.0" : "vexim-ecfr-xml/1.1.0",
      status: "DRAFT",
      retrieved_at: stamp(),
      created_at: stamp(),
      supersedes_snapshot_id:
        d.snapshots.find((s) => s.source_key === key && s.status === "ACTIVE")
          ?.id ?? null,
      created_by: actor.id,
      reviewed_by: null,
      approved_by: null,
      approved_at: null,
      validation_results: fr
        ? { monitor_only: true }
        : {
            coverage_complete: true,
            citations_valid: true,
            regression_passed: true,
            section_count: kind === "ecfr_section" ? 1 : 3,
            chunk_count: kind === "ecfr_section" ? 1 : 3,
            warnings: [],
            missing_sections: [],
            simulation: true,
          },
      review_checklist: {},
      change_classification: null,
      chunk_count: fr ? 0 : kind === "ecfr_section" ? 1 : 3,
      document_number: fr ? "DEMO-NOT-A-REAL-DOCUMENT" : null,
      metadata: {
        simulation: true,
        raw_text: text,
        official_edition_required: fr,
      },
    };
    d.snapshots.unshift(snapshot);
    if (!fr) {
      for (const [sec, topic] of kind === "ecfr_section"
        ? [
            [
              section,
              section === "101.9"
                ? "nutrition_labeling"
                : section === "101.7"
                  ? "net_quantity"
                  : "identity",
            ],
          ]
        : [
            ["101.3", "identity"],
            ["101.7", "net_quantity"],
            ["101.9", "nutrition_labeling"],
          ])
        d.chunks.push({
          id: id(),
          source_id: id(),
          source_version: 1,
          citation: `21 CFR ${sec}`,
          heading: `§ ${sec} · mô phỏng`,
          content: text,
          topic,
          review_status: "DRAFT",
          snapshot_id: sid,
          chunk_content_hash: hash,
          citation_precision: "section",
          source_anchor: `https://www.ecfr.gov/on/${issue}/title-21/section-${sec}`,
        });
    }
    if (fr)
      d.alerts.unshift({
        id: id(),
        snapshot_id: sid,
        job_id: job.id,
        code: "NEW_FEDERAL_REGISTER_DOCUMENT",
        severity: "warning",
        message:
          "DEMO: văn bản FDA mới tạo tác vụ regulatory review. Không có rules nào thay đổi.",
        resolved_at: null,
        created_at: stamp(),
      });
    job.result = {
      ...job.result,
      snapshot_id: sid,
      status: fr ? "monitor_completed" : "draft_created",
      issue_date: snapshot.issue_date,
    };
    save(d);
    return job;
  }
  if (path === "retrieve") {
    if (actor.role.startsWith("customer"))
      throw new Error("Truy xuất nội bộ chỉ dành cho nhân sự.");
    d.metrics.retrieval_requests++;
    const citations: VersionedCitation[] = d.chunks
      .filter(
        (c) =>
          c.topic === body.topic &&
          c.review_status === "APPROVED" &&
          d.snapshots.some(
            (s) =>
              s.id === c.snapshot_id &&
              s.status === "ACTIVE" &&
              s.issue_date! <= String(body.as_of_date),
          ),
      )
      .slice(0, 4)
      .map((c) => {
        const s = d.snapshots.find((s) => s.id === c.snapshot_id)!;
        return {
          chunk_id: c.id,
          source_id: c.source_id,
          snapshot_id: s.id,
          citation: c.citation,
          source_title: s.title,
          source_version: s.source_version,
          registry_version: c.source_version,
          source_status: "ACTIVE",
          text: c.content,
          canonical_url: c.source_anchor,
          api_url: s.api_url,
          issue_date: s.issue_date!,
          retrieved_at: s.retrieved_at,
          content_hash: s.content_hash,
          chunk_content_hash: c.chunk_content_hash,
          parser_version: s.parser_version!,
          topic: c.topic,
          jurisdiction: "US_FEDERAL",
          effective_date_unknown: s.effective_date_unknown,
          truncated: false,
        };
      });
    if (citations.length) d.metrics.retrieval_hits++;
    save(d);
    return { citations, untrusted_evidence: true };
  }
  const parts = path.split("/");
  if (parts[0] === "alerts" && parts[2] === "resolve") {
    const alert = d.alerts.find((a) => a.id === parts[1]);
    if (alert) alert.resolved_at = stamp();
    save(d);
    return {};
  }
  const snapshot = d.snapshots.find((s) => s.id === parts[1]);
  if (!snapshot) throw new Error("Snapshot không tồn tại.");
  if (parts[2] !== "withdraw" && body.expected_hash !== snapshot.content_hash)
    throw new Error("Hash snapshot đã thay đổi.");
  if (parts[2] === "regression") return { passed: true };
  if (parts[2] === "review") {
    if (
      snapshot.source_family !== "ecfr" ||
      !["DRAFT", "REGULATORY_REVIEW"].includes(snapshot.status)
    )
      throw new Error("Chỉ review eCFR DRAFT.");
    snapshot.status = "REGULATORY_REVIEW";
    snapshot.reviewed_by = actor.id;
    snapshot.review_checklist = body.checklist as Record<string, unknown>;
    snapshot.change_classification = String(body.classification);
    snapshot.effective_from = body.effective_from
      ? String(body.effective_from)
      : null;
    snapshot.effective_to = body.effective_to
      ? String(body.effective_to)
      : null;
    snapshot.effective_date_unknown = !snapshot.effective_from;
  } else if (parts[2] === "activate") {
    if (
      snapshot.change_classification === "unknown" ||
      snapshot.status !== "REGULATORY_REVIEW" ||
      snapshot.reviewed_by === actor.id ||
      snapshot.created_by === actor.id
    )
      throw new Error(
        "Cần Regulatory Admin độc lập; người tạo/người checklist không tự phê duyệt.",
      );
    for (const s of d.snapshots)
      if (s.source_key === snapshot.source_key && s.status === "ACTIVE") {
        s.status = "SUPERSEDED";
        d.chunks
          .filter((c) => c.snapshot_id === s.id)
          .forEach((c) => {
            c.review_status = "SUPERSEDED";
          });
      }
    snapshot.status = "ACTIVE";
    snapshot.approved_by = actor.id;
    snapshot.approved_at = stamp();
    d.chunks
      .filter((c) => c.snapshot_id === snapshot.id)
      .forEach((c) => {
        c.review_status = "APPROVED";
      });
  } else if (parts[2] === "withdraw") {
    snapshot.status = "WITHDRAWN";
    d.chunks
      .filter((c) => c.snapshot_id === snapshot.id)
      .forEach((c) => {
        c.review_status = "SUPERSEDED";
      });
  } else throw new Error("Không hỗ trợ thao tác demo này.");
  save(d);
  return {};
}
