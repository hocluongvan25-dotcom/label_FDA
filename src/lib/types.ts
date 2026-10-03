export type Role =
  | "customer_admin"
  | "customer_contributor"
  | "reviewer"
  | "regulatory_admin"
  | "system_admin";
export type Severity = "critical" | "major" | "minor" | "information";
export type FindingStatus = "open" | "accepted" | "dismissed";
export type ReviewStatus =
  | "DRAFT"
  | "INTAKE_PENDING"
  | "INPUT_VALIDATION"
  | "PROCESSING"
  | "AI_REVIEW_READY"
  | "HUMAN_REVIEW"
  | "WAITING_FOR_CUSTOMER"
  | "REVISION_REQUIRED"
  | "APPROVED_WITH_NOTES"
  | "COMPLETED"
  | "ARCHIVED"
  | "PROCESSING_FAILED"
  | "SOURCE_UNAVAILABLE"
  | "MODEL_FAILED"
  | "MANUAL_ESCALATION_REQUIRED";
export type ProductCategory =
  | "dry_packaged_tea"
  | "tea_bag"
  | "dietary_supplement"
  | "ready_to_drink"
  | "other";
export type SourceStatus = "DRAFT" | "CURRENT" | "SUPERSEDED" | "UNAVAILABLE";
export type RuleStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";
export type TriageRoute =
  | "OUT_OF_SCOPE"
  | "BLOCKED_REGULATORY_SOURCE"
  | "EXPERT_REVIEW_REQUIRED"
  | "NEEDS_CUSTOMER_INFORMATION"
  | "AUTO_SCREENED";
export type TriageOverallResult =
  | "NOT_ASSESSED"
  | "NO_AUTOMATED_ISSUE_DETECTED"
  | "POTENTIAL_ISSUES_FOUND"
  | "NO_ISSUE_DETECTED_IN_SCOPE"
  | "NEEDS_CORRECTION"
  | "INSUFFICIENT_INFORMATION"
  | "BLOCKED"
  | "OUT_OF_SCOPE";
export type ReportDisposition =
  | "NEEDS_CORRECTION"
  | "NO_ISSUE_DETECTED_IN_SCOPE"
  | "INSUFFICIENT_INFORMATION";
export type TriageReportStatus =
  | "NOT_ISSUED"
  | "BLOCKED"
  | "DISABLED"
  | "PRE_SCREENING_ISSUED"
  | "FINAL_REPORT_ISSUED";
export type ExpertReviewStatus =
  "NOT_REQUIRED" | "PENDING" | "IN_PROGRESS" | "EXPERT_REVIEWED";
export interface TriageReason {
  gate:
    | "OUT_OF_SCOPE"
    | "BLOCKED_REGULATORY_SOURCE"
    | "EXPERT_REVIEW_REQUIRED"
    | "NEEDS_CUSTOMER_INFORMATION";
  code: string;
  message: string;
  source_id?: string;
  rule_key?: string;
}
export type ClaimClass =
  | "MARKETING_ONLY"
  | "NUTRIENT_CONTENT_CLAIM"
  | "HEALTH_CLAIM"
  | "STRUCTURE_FUNCTION_CLAIM"
  | "DISEASE_CLAIM"
  | "ORGANIC_CLAIM"
  | "ALLERGEN_CLAIM"
  | "UNCERTAIN";

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
  organization_id: string | null;
}
export interface Organization {
  id: string;
  name: string;
  country: string;
  contact_email: string;
  contact_name: string;
  status: "active" | "inactive";
  created_at: string;
}
export interface Member {
  id: string;
  organization_id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited" | "locked";
}
export interface Ingredient {
  id: string;
  name_original: string;
  name_english: string;
  normalized_name: string;
  percentage: number | null;
  order: number;
  allergen_groups: string[];
  source: "customer_input";
}
export interface Party {
  name: string;
  address: string;
}
export interface Product {
  id: string;
  organization_id: string;
  name: string;
  brand: string;
  category: ProductCategory;
  form: "loose_leaf" | "tea_bag" | "powder" | "liquid" | "other";
  market: "US";
  channel: string[];
  expected_us_units_12m: number | null;
  employee_fte: number | null;
  classification_status: "conventional_food" | "uncertain" | "out_of_scope";
  formula: Ingredient[];
  claims: string[];
  package_size: string;
  net_quantity: string;
  manufacturer: Party;
  packer: Party;
  distributor: Party;
  importer: Party;
  certifications: string[];
  exemption_requested: boolean;
  formula_confirmed: boolean;
  claims_confirmed: boolean;
  assigned_to: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  color: string;
}
export interface LabelFile {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  storage_path: string;
  sha256: string;
  page_count: number;
  scan_status: "pending" | "clean" | "rejected" | "dev_unscanned";
  kind: "original" | "normalized";
  preview_url?: string;
  original_file_id?: string;
  page?: number;
}
// Bounding boxes use normalized image coordinates [left, top, right, bottom].
export type BoundingBox = [number, number, number, number];
export interface Evidence {
  file_id: string;
  page: number;
  bbox: BoundingBox | null;
  text: string;
  kind?: "observed" | "absence" | "dossier";
}
export interface ExtractedField {
  id: string;
  field: string;
  value: string | null;
  normalized?: Record<string, unknown>;
  confidence: number;
  evidence: Evidence;
  extraction_model: string;
  extracted_at: string;
  manually_verified?: boolean;
}
export interface LabelVersion {
  id: string;
  organization_id: string;
  product_id: string;
  version: number;
  original_files: LabelFile[];
  normalized_files: LabelFile[];
  status: "uploaded" | "processing" | "under_review" | "reviewed" | "rejected";
  uploaded_by: string;
  uploaded_at: string;
  extracted_fields: ExtractedField[];
}
export interface Finding {
  id: string;
  review_id: string;
  organization_id: string;
  rule_key: string;
  rule_version: number;
  severity: Severity;
  status: FindingStatus;
  title: string;
  description: string;
  evidence: Evidence[];
  citation_ids: string[];
  citation_pending: boolean;
  suggested_action: string;
  ai_confidence: number | null;
  reasoning_category:
    | "field_presence"
    | "classification"
    | "allergen"
    | "claim"
    | "consistency"
    | "readability"
    | "manual";
  human_review_required: boolean;
  reviewer_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}
export interface PipelineStep {
  stage: "validation" | "ocr" | "extraction" | "rules" | "verification";
  status: "pending" | "running" | "complete" | "failed";
  message?: string;
  attempts: number;
  completed_at?: string;
}
export interface Review {
  id: string;
  organization_id: string;
  product_id: string;
  label_version_id: string;
  review_scope: "us_federal_food_labeling_mvp";
  status: ReviewStatus;
  triage_route?: TriageRoute;
  overall_result?: TriageOverallResult;
  report_status?: TriageReportStatus;
  expert_review_status?: ExpertReviewStatus;
  triage_reasons?: TriageReason[];
  triage_risk_score?: number;
  triage_policy_version?: string;
  triage_evaluated_at?: string | null;
  progress: number;
  assigned_to: string;
  created_at: string;
  updated_at: string;
  due_at: string;
  pipeline: PipelineStep[];
  error_message: string | null;
  idempotency_key: string;
  approved_by: string | null;
  approved_at: string | null;
  approval_comment: string | null;
  dossier_snapshot?: Product;
  rule_snapshot?: {
    rule_key: string;
    version: number;
    source_versions: {
      id: string;
      version: number;
      content_hash: string | null;
      snapshot_id?: string;
      raw_content_hash?: string | null;
      issue_date?: string | null;
      parser_version?: string | null;
    }[];
  }[];
  missing_information?: string[];
}
export interface PreScreeningReport {
  id: string;
  review_id: string;
  organization_id: string;
  product_id: string;
  label_version_id: string;
  triage_run_id: string;
  version: number;
  disclaimer_profile: "PRE_SCREENING_ONLY";
  snapshot: Record<string, unknown>;
  created_at: string;
}
export interface RegulatorySource {
  api_url?: string | null;
  issue_date?: string | null;
  document_revision_date?: string | null;
  document_revision_label?: string | null;
  raw_snapshot_id?: string | null;
  raw_content_hash?: string | null;
  parser_version?: string | null;
  ingestion_status?: string | null;
  effective_date_unknown?: boolean;
  id: string;
  source_key: string;
  authority: string;
  agency: string;
  document_type: string;
  citation: string;
  title: string;
  canonical_url: string;
  topic: string;
  status: SourceStatus;
  priority: number;
  retrieved_at: string | null;
  effective_from: string | null;
  effective_to: string | null;
  content_hash: string | null;
  content_excerpt: string;
  approved_by: string | null;
  approved_at: string | null;
  version: number;
  updated_at: string;
}
export interface ComplianceRule {
  id: string;
  rule_key: string;
  name: string;
  version: number;
  scope: string[];
  condition_json: Record<string, unknown>;
  action_json: {
    severity: Severity;
    human_review: boolean;
    suggested_action: string;
  };
  source_citations: string[];
  source_snapshot?: {
    id: string;
    version: number;
    content_hash: string | null;
  }[];
  definition_hash?: string;
  test_hash?: string | null;
  status: RuleStatus;
  effective_from: string | null;
  effective_to: string | null;
  created_by: string;
  approved_by: string | null;
  test_status: "passed" | "pending" | "failed";
  updated_at: string;
}
export interface CustomerRequest {
  id: string;
  review_id: string;
  organization_id: string;
  message: string;
  requested_documents: string[];
  status: "open" | "resolved";
  created_by: string;
  created_at: string;
}
export interface AuditEntry {
  id: string;
  organization_id: string | null;
  actor_id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
}
export interface ReportSnapshot {
  missing_information?: string[];
  customer_requests?: CustomerRequest[];
  rule_snapshot?: Review["rule_snapshot"];
  schema_version: "1.0" | "1.1";
  review_id: string;
  product: Product;
  label_version: LabelVersion;
  review_scope: string;
  /** Explicit immutable reviewer outcome; optional only for legacy v1.0 snapshots. */
  disposition?: ReportDisposition;
  /** Reviewer identity and rationale are mirrored here for audit-friendly exports. */
  approved_by?: string;
  rationale?: string;
  /** Kept as a backwards-compatible alias for existing report consumers. */
  result: ReportDisposition;
  disclaimer: string;
  findings: Finding[];
  sources: RegulatorySource[];
  reviewer: { id: string; name: string; approved_at: string; comment: string };
  version_history: { version: number; uploaded_at: string }[];
  generated_at: string;
  demo: boolean;
}
export interface Report {
  id: string;
  review_id: string;
  organization_id: string;
  product_id: string;
  label_version_id: string;
  report_number: string;
  snapshot: ReportSnapshot;
  created_at: string;
  pdf_path: string | null;
  json_path: string | null;
}
export interface AppData {
  staff?: {
    id: string;
    name: string;
    role: "reviewer" | "regulatory_admin" | "system_admin";
    active: boolean;
  }[];
  organizations: Organization[];
  members: Member[];
  products: Product[];
  labelVersions: LabelVersion[];
  reviews: Review[];
  findings: Finding[];
  sources: RegulatorySource[];
  rules: ComplianceRule[];
  requests: CustomerRequest[];
  reports: Report[];
  preScreeningReports?: PreScreeningReport[];
  audit: AuditEntry[];
}
export interface OcrBlock {
  text: string;
  confidence: number;
  page: number;
  file_id: string;
  bbox: BoundingBox;
  detected_language: string;
  orientation: number;
  block_type: "line" | "paragraph" | "word";
}
export interface OcrResult {
  text: string;
  blocks: OcrBlock[];
  confidence: number;
  model: string;
  pages: number;
}
