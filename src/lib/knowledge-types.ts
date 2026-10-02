export const LEGAL_SEARCH_TERMS = [
  "food labeling",
  "nutrition labeling",
  "allergen labeling",
  "tea",
  "21 CFR 101",
  "21 CFR 101.3",
  "21 CFR 101.7",
  "21 CFR 101.9",
] as const;
export type LegalSearchTerm = (typeof LEGAL_SEARCH_TERMS)[number];
export const MVP_SECTIONS = [
  "101.3",
  "101.4",
  "101.5",
  "101.7",
  "101.9",
  "101.13",
  "101.15",
] as const;
export type KnowledgeStatus =
  | "DISCOVERED"
  | "FETCHED"
  | "PARSED"
  | "DRAFT"
  | "REGULATORY_REVIEW"
  | "APPROVED"
  | "ACTIVE"
  | "SUPERSEDED"
  | "WITHDRAWN"
  | "FETCH_FAILED"
  | "PARSE_FAILED";
export type IngestionKind =
  | "ecfr_part101"
  | "ecfr_section"
  | "ecfr_discovery"
  | "fr_monitor"
  | "fda_label_claims_html"
  | "fda_food_label_guide_pdf";
export interface RegulatoryIngestionJob {
  id: string;
  kind: IngestionKind;
  params: Record<string, unknown>;
  status: "queued" | "running" | "retry" | "completed" | "dead_letter";
  requested_by: string | null;
  requested_at: string;
  completed_at: string | null;
  attempts: number;
  locked_by: string | null;
  locked_until: string | null;
  response_status: number | null;
  error_code: string | null;
  error_message: string | null;
  result: Record<string, unknown>;
  next_run_at: string;
}
export interface ApiSnapshotResponse {
  id: string;
  family: "ecfr" | "federal_register" | "fda_guidance";
  cache_key: string;
  api_url: string;
  response_status: number;
  headers: Record<string, string>;
  content_type: string;
  content_hash: string;
  byte_size: number;
  raw_storage_key: string;
  retrieved_at: string;
  expires_at: string;
  latency_ms: number;
  validated: boolean;
}
export interface ParsedRegulatoryChunk {
  chunk_key: string;
  section: string;
  citation: string;
  heading: string | null;
  content: string;
  topic: string;
  topics: string[];
  hierarchy?: { type: string; identifier: string; heading: string }[];
  xml_tag?: string;
  cross_references?: string[];
  obligation_type: string;
  paragraph_path: string[];
  citation_precision:
    | "section"
    | "paragraph"
    | "heading"
    | "page"
    | "unresolved";
  sequence: number;
  source_anchor: string;
}
export interface ParsedSection {
  section: string;
  heading: string;
  topic: string;
  content: string;
  reserved: boolean;
}
export interface ParserValidation {
  parser_version: string;
  root_tag: string;
  section_count: number;
  paragraph_count: number;
  chunk_count: number;
  heading_count?: number;
  page_count?: number;
  processed_page_count?: number;
  text_page_count?: number;
  source_character_count?: number;
  extracted_character_count?: number;
  coverage_ratio?: number;
  coverage_complete: boolean;
  citations_valid: boolean;
  warnings: string[];
  missing_sections: string[];
  regression_passed?: boolean;
  regression_results?: { rule_key: string; passed: boolean; name?: string }[];
}
export interface KnowledgeSnapshot {
  id: string;
  source_key: string;
  source_family: "ecfr" | "federal_register" | "fda_guidance";
  citation: string;
  title: string;
  api_url: string;
  canonical_url: string;
  issue_date: string | null;
  source_version: string;
  effective_from: string | null;
  effective_to: string | null;
  effective_date_unknown: boolean;
  raw_response_id: string;
  document_revision_date: string | null;
  document_revision_label: string | null;
  content_hash: string;
  parser_version: string | null;
  status: KnowledgeStatus;
  retrieved_at: string;
  created_at: string;
  supersedes_snapshot_id: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  validation_results: ParserValidation | Record<string, unknown>;
  review_checklist: Record<string, unknown>;
  change_classification: string | null;
  chunk_count: number;
  document_number: string | null;
  metadata: Record<string, unknown>;
}
export interface KnowledgeAlert {
  id: string;
  snapshot_id: string | null;
  job_id: string | null;
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
  resolved_at: string | null;
  created_at: string;
}
export interface VersionedCitation {
  chunk_id: string;
  source_id: string;
  snapshot_id: string;
  citation: string;
  source_title: string;
  source_version: string;
  registry_version: number;
  source_status: "ACTIVE";
  text: string;
  canonical_url: string;
  api_url: string;
  issue_date: string;
  retrieved_at: string;
  content_hash: string;
  chunk_content_hash: string;
  parser_version: string;
  topic: string;
  jurisdiction: "US_FEDERAL";
  effective_date_unknown: boolean;
  truncated: boolean;
  retrieval_method?: "full_text" | "vector";
  similarity?: number;
}
export interface KnowledgeDashboard {
  snapshots: KnowledgeSnapshot[];
  jobs: RegulatoryIngestionJob[];
  alerts: KnowledgeAlert[];
  metrics: {
    requests: number;
    mean_latency_ms?: number;
    failures: number;
    rate_limited: number;
    parse_failures: number;
    pending_approval: number;
    active_age_days: number | null;
    retrieval_requests: number;
    retrieval_hits: number;
  };
  configured: boolean;
  contact_configured: boolean;
}
