import type {
  ComplianceRule,
  ExtractedField,
  Finding,
  Product,
  RegulatorySource,
  Review,
  TriageOverallResult,
  TriageReason,
  TriageReportStatus,
  TriageRoute,
} from "./types";
import { classifyClaim } from "./extraction";
import { sourceIsCurrent } from "./utils";

export const TRIAGE_POLICY_VERSION = "risk-based-triage/1.0.0";
export const MINIMUM_ACTIVE_TEA_RULES = 15;
export const MINIMUM_OCR_CONFIDENCE = 0.7;

export interface RegulatoryParserQuality {
  snapshot_id: string;
  status: string;
  source_family?: string;
  parser_version?: string | null;
  coverage_complete?: boolean;
  citations_valid?: boolean;
  unresolved_citation_count?: number;
  citation_paths_resolved?: boolean;
  effective_date_unknown?: boolean;
}

export interface TriageInput {
  product: Product;
  fields: ExtractedField[];
  findings: Finding[];
  rules: ComplianceRule[];
  sources: RegulatorySource[];
  rule_snapshot: Review["rule_snapshot"];
  parser_quality?: RegulatoryParserQuality[];
  ocr_confidence: number | null;
  ocr_pages: number | null;
  expected_pages: number | null;
  minimum_active_rules?: number;
  evaluated_at?: Date;
}

export type TriageGate =
  | "OUT_OF_SCOPE"
  | "BLOCKED_REGULATORY_SOURCE"
  | "EXPERT_REVIEW_REQUIRED"
  | "NEEDS_CUSTOMER_INFORMATION";

export interface TriageDecision {
  policy_version: string;
  triage_route: TriageRoute;
  overall_result: TriageOverallResult;
  risk_score: number;
  reasons: TriageReason[];
  customer_questions: string[];
  report_status: TriageReportStatus;
  evaluated_at: string;
}

export interface PreScreeningFindingSummary {
  rule_key: string;
  severity: Finding["severity"];
  summary: string;
}

export interface PreScreeningSnapshot {
  schema_version: "pre-screening/1.0.0";
  disclaimer_profile: "PRE_SCREENING_ONLY";
  disclaimer: { vi: string; en: string };
  review_id: string;
  label_version_id: string;
  review_scope: "us_federal_food_labeling_mvp";
  triage_route: "AUTO_SCREENED";
  overall_result: TriageOverallResult;
  policy_version: string;
  risk_score: number;
  triage_reasons: TriageReason[];
  findings: PreScreeningFindingSummary[];
  source_rule_snapshot: {
    rule_key: string;
    version: number;
    sources: { id: string; version: number; content_hash: string | null }[];
  }[];
  generated_at: string;
}

const findingSummaries: Record<string, string> = {
  "IDENTITY-001": "Tên gọi thực phẩm trên nhãn cần được đối chiếu.",
  "NETQTY-001": "Thông tin khối lượng tịnh cần được đối chiếu.",
  "INGREDIENT-001": "Danh sách nguyên liệu cần được đối chiếu.",
  "NUTRITION-001": "Thông tin dinh dưỡng cần được xác minh theo hồ sơ áp dụng.",
  "NUTRITION-002": "Claim dinh dưỡng cần dữ liệu hỗ trợ và rà soát chuyên môn.",
  "ALLERGEN-001": "Thông tin dị nguyên cần được đối chiếu với công thức.",
  "ALLERGEN-002": "Thông tin sesame cần được đối chiếu với công thức.",
  "CLAIM-002": "Claim dinh dưỡng cần dữ liệu hỗ trợ và rà soát chuyên môn.",
  "CLAIM-003": "Claim marketing cần được đối chiếu với hồ sơ chứng minh.",
  "FORMULA-001": "Thành phần trên nhãn cần được so sánh với công thức.",
  "LABEL-001": "Một hoặc nhiều vùng nhãn cần được đọc hoặc xác minh lại.",
  "LABEL-002": "Thông tin tiếng Anh cần được xác minh.",
  "PARTY-001": "Thông tin đơn vị chịu trách nhiệm cần được đối chiếu.",
  "CLASS-001": "Phân loại sản phẩm cần được xác minh.",
};

const scopeCategories = new Set(["dry_packaged_tea", "tea_bag"]);
const allowedForms = new Set(["loose_leaf", "tea_bag", "powder"]);

function isProductOutOfScope(product: Product) {
  return (
    !scopeCategories.has(product.category) ||
    !allowedForms.has(product.form) ||
    product.market !== "US" ||
    product.classification_status === "out_of_scope"
  );
}

function latestApplicableRules(
  rules: ComplianceRule[],
  product: Product,
): ComplianceRule[] {
  const applicable = rules.filter(
    (rule) =>
      rule.scope.includes(product.category) || rule.rule_key === "CLASS-001",
  );
  const grouped = new Map<string, ComplianceRule[]>();
  for (const rule of applicable) {
    const group = grouped.get(rule.rule_key) ?? [];
    group.push(rule);
    grouped.set(rule.rule_key, group);
  }
  return [...grouped.values()].map((versions) => {
    const active = versions.find((rule) => rule.status === "ACTIVE");
    return active ?? [...versions].sort((a, b) => b.version - a.version)[0];
  });
}

function uniqueReasons(reasons: TriageReason[]) {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.gate}|${reason.code}|${reason.source_id ?? ""}|${reason.rule_key ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function evaluateTriage(input: TriageInput): TriageDecision {
  const evaluatedAt = input.evaluated_at ?? new Date();
  const reasons: TriageReason[] = [];
  const customerQuestions: string[] = [];
  const add = (
    gate: TriageGate,
    code: string,
    message: string,
    context: Pick<TriageReason, "source_id" | "rule_key"> = {},
  ) => reasons.push({ gate, code, message, ...context });
  const question = (message: string) => {
    if (!customerQuestions.includes(message)) customerQuestions.push(message);
  };

  // Gather every gate first; apply route precedence only after all checks.
  if (isProductOutOfScope(input.product)) {
    add(
      "OUT_OF_SCOPE",
      "PRODUCT_OUTSIDE_SUPPORTED_SCOPE",
      "Sản phẩm không thuộc phạm vi hỗ trợ hiện tại: trà khô/trà túi lọc thuộc nhóm thực phẩm thông thường (conventional food).",
    );
  } else if (input.product.classification_status !== "conventional_food") {
    add(
      "EXPERT_REVIEW_REQUIRED",
      "PRODUCT_CLASSIFICATION_UNCERTAIN",
      "Chưa xác nhận sản phẩm thuộc nhóm thực phẩm thông thường; cần chuyên gia xác minh.",
    );
  }

  const minimumRules = input.minimum_active_rules ?? MINIMUM_ACTIVE_TEA_RULES;
  const applicableRules = latestApplicableRules(input.rules, input.product);
  const activeRules = applicableRules.filter(
    (rule) => rule.status === "ACTIVE",
  );
  const executedByRule = new Map(
    (input.rule_snapshot ?? []).map((rule) => [rule.rule_key, rule]),
  );
  const activeExecutedCount = activeRules.filter(
    (rule) => executedByRule.get(rule.rule_key)?.version === rule.version,
  ).length;
  if (
    activeRules.length < minimumRules ||
    activeExecutedCount !== activeRules.length
  ) {
    add(
      "BLOCKED_REGULATORY_SOURCE",
      "ACTIVE_RULE_PACK_INCOMPLETE",
      `Bộ quy tắc trà cần tối thiểu ${minimumRules} quy tắc ACTIVE (đang có hiệu lực) và bản lưu nguồn hợp lệ cho toàn bộ quy tắc hiện hành.`,
    );
  }
  for (const rule of activeRules) {
    if (
      !rule.approved_by ||
      rule.approved_by === rule.created_by ||
      rule.test_status !== "passed" ||
      !rule.definition_hash ||
      rule.test_hash !== rule.definition_hash
    ) {
      add(
        "BLOCKED_REGULATORY_SOURCE",
        "ACTIVE_RULE_APPROVAL_UNVERIFIED",
        "Quy tắc ACTIVE thiếu phê duyệt độc lập hoặc kiểm thử hồi quy khớp hash hiện hành.",
        { rule_key: rule.rule_key },
      );
    }
    const execution = executedByRule.get(rule.rule_key);
    if (!execution) continue;
    if (execution.version !== rule.version) {
      add(
        "BLOCKED_REGULATORY_SOURCE",
        "RULE_EXECUTION_VERSION_MISMATCH",
        "Phiên bản quy tắc đã thực thi không khớp phiên bản ACTIVE hiện hành.",
        { rule_key: rule.rule_key },
      );
      continue;
    }
    const expectedSources = new Set(rule.source_citations);
    if (
      execution.source_versions.length !== expectedSources.size ||
      execution.source_versions.some((ref) => !expectedSources.has(ref.id))
    ) {
      add(
        "BLOCKED_REGULATORY_SOURCE",
        "UNRESOLVED_RULE_SNAPSHOT_CITATION",
        "Bản lưu kết quả thực thi thiếu trích dẫn nguồn hoặc chứa trích dẫn ngoài danh sách của quy tắc ACTIVE.",
        { rule_key: rule.rule_key },
      );
    }
    for (const ref of execution.source_versions) {
      const source = input.sources.find((candidate) => candidate.id === ref.id);
      if (!source) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_SOURCE_MISSING",
          "Bản lưu kết quả thực thi tham chiếu nguồn không có trong danh mục nguồn.",
          { source_id: ref.id, rule_key: rule.rule_key },
        );
        continue;
      }
      if (
        ref.version !== source.version ||
        ref.content_hash !== source.content_hash ||
        (ref.snapshot_id !== undefined &&
          ref.snapshot_id !== source.raw_snapshot_id) ||
        (ref.raw_content_hash !== undefined &&
          ref.raw_content_hash !== source.raw_content_hash) ||
        (ref.issue_date !== undefined &&
          ref.issue_date !== source.issue_date) ||
        (ref.parser_version !== undefined &&
          ref.parser_version !== source.parser_version)
      ) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_SOURCE_SNAPSHOT_MISMATCH",
          "Bản lưu kết quả thực thi không khớp phiên bản, mã kiểm tra hoặc thông tin của nguồn hiện hành.",
          { source_id: source.id, rule_key: rule.rule_key },
        );
      }
    }
  }

  const parserQuality = new Map(
    (input.parser_quality ?? []).map((quality) => [
      quality.snapshot_id,
      quality,
    ]),
  );
  const relevantRules = applicableRules.length ? applicableRules : activeRules;
  for (const rule of relevantRules) {
    if (
      rule.status !== "ACTIVE" &&
      activeRules.some((r) => r.rule_key === rule.rule_key)
    )
      continue;
    const refs = rule.source_snapshot ?? [];
    if (
      !rule.source_citations.length ||
      refs.length !== rule.source_citations.length
    ) {
      add(
        "BLOCKED_REGULATORY_SOURCE",
        "UNRESOLVED_RULE_CITATION",
        "Citation của một hoặc nhiều quy tắc chưa được liên kết đầy đủ với phiên bản nguồn.",
        { rule_key: rule.rule_key },
      );
    }
    for (const sourceId of rule.source_citations) {
      const source = input.sources.find(
        (candidate) => candidate.id === sourceId,
      );
      const ref = refs.find((candidate) => candidate.id === sourceId);
      if (!source) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_SOURCE_MISSING",
          "Không tìm thấy nguồn được tham chiếu trong danh mục nguồn.",
          { source_id: sourceId, rule_key: rule.rule_key },
        );
        continue;
      }
      if (
        source.status !== "CURRENT" ||
        !sourceIsCurrent(source, evaluatedAt) ||
        !source.approved_by
      ) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          source.status === "DRAFT"
            ? "REGULATORY_SOURCE_DRAFT"
            : "REGULATORY_SOURCE_INACTIVE",
          source.status === "DRAFT"
            ? "Nguồn đang ở trạng thái DRAFT và chưa được phê duyệt để sử dụng."
            : "Nguồn không còn ở trạng thái CURRENT (hiện hành) hoặc ACTIVE (đang có hiệu lực), hoặc chưa được phê duyệt.",
          { source_id: source.id, rule_key: rule.rule_key },
        );
      }
      if (
        !ref ||
        ref.version !== source.version ||
        ref.content_hash !== source.content_hash
      ) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_SOURCE_SNAPSHOT_MISMATCH",
          "Bản lưu của quy tắc không khớp phiên bản hoặc mã kiểm tra của nguồn hiện hành.",
          { source_id: source.id, rule_key: rule.rule_key },
        );
      }
      if (source.effective_date_unknown !== false) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_EFFECTIVE_DATE_UNCLEAR",
          "Ngày hiệu lực của nguồn chưa được xác định rõ.",
          { source_id: source.id, rule_key: rule.rule_key },
        );
      }
      if (!source.raw_snapshot_id) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_PARSER_COVERAGE_UNVERIFIED",
          "Nguồn chưa có bản lưu và mức độ bao phủ của bộ phân tích đã được xác minh; chưa thể phát hành kết quả sàng lọc tự động.",
          { source_id: source.id, rule_key: rule.rule_key },
        );
        continue;
      }
      const quality = parserQuality.get(source.raw_snapshot_id);
      if (!quality) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_PARSER_COVERAGE_UNVERIFIED",
          "Chưa có kết quả kiểm định bộ phân tích cho bản lưu nguồn được tham chiếu.",
          { source_id: source.id, rule_key: rule.rule_key },
        );
        continue;
      }
      if (quality.status !== "ACTIVE") {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_SNAPSHOT_INACTIVE",
          "Bản lưu hoặc bộ phân tích của nguồn chưa ở trạng thái ACTIVE (đang có hiệu lực).",
          { source_id: source.id, rule_key: rule.rule_key },
        );
      }
      if (
        !quality.parser_version ||
        quality.parser_version !== source.parser_version
      ) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_PARSER_VERSION_UNVERIFIED",
          "Chưa xác minh phiên bản bộ phân tích của bản lưu hoặc phiên bản này không khớp danh mục nguồn.",
          { source_id: source.id, rule_key: rule.rule_key },
        );
      }
      if (quality.coverage_complete !== true) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_PARSER_COVERAGE_INADEQUATE",
          "Mức độ bao phủ của bộ phân tích chưa đầy đủ; đã chặn việc tự động phát hành.",
          { source_id: source.id, rule_key: rule.rule_key },
        );
      }
      const hasUnresolvedCitation =
        quality.citation_paths_resolved === false ||
        (typeof quality.unresolved_citation_count === "number" &&
          quality.unresolved_citation_count > 0) ||
        (quality.source_family === "ecfr" &&
          quality.citation_paths_resolved !== true);
      if (quality.citations_valid !== true || hasUnresolvedCitation) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "UNRESOLVED_REGULATORY_CITATION",
          hasUnresolvedCitation
            ? "Cú pháp trích dẫn có thể hợp lệ nhưng vẫn còn đường dẫn đến điều/khoản chưa được xác minh; cần đối chiếu thủ công và đã chặn việc tự động phát hành."
            : "Có trích dẫn nguồn chưa được bộ phân tích xác minh.",
          { source_id: source.id, rule_key: rule.rule_key },
        );
      }
      if (quality.effective_date_unknown === true) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "REGULATORY_EFFECTIVE_DATE_UNCLEAR",
          "Thông tin do bộ phân tích cung cấp cho biết ngày hiệu lực của bản lưu chưa rõ.",
          { source_id: source.id, rule_key: rule.rule_key },
        );
      }
    }
  }

  for (const rule of input.rule_snapshot ?? []) {
    const currentRule = activeRules.find(
      (candidate) => candidate.rule_key === rule.rule_key,
    );
    if (!currentRule || currentRule.version !== rule.version) {
      add(
        "BLOCKED_REGULATORY_SOURCE",
        "RULE_EXECUTION_VERSION_MISMATCH",
        "Bản lưu chứa quy tắc không còn ACTIVE (đang có hiệu lực) hoặc không khớp phiên bản hiện hành.",
        { rule_key: rule.rule_key },
      );
    }
    if (!rule.source_versions.length) {
      add(
        "BLOCKED_REGULATORY_SOURCE",
        "UNRESOLVED_RULE_SNAPSHOT_CITATION",
        "Bản lưu của quy tắc chưa có trích dẫn nguồn được xác minh.",
        { rule_key: rule.rule_key },
      );
    }
  }
  for (const finding of input.findings) {
    const activeRule = activeRules.find(
      (rule) =>
        rule.rule_key === finding.rule_key &&
        rule.version === finding.rule_version,
    );
    if (
      finding.citation_pending ||
      !finding.citation_ids.length ||
      !activeRule
    ) {
      add(
        "BLOCKED_REGULATORY_SOURCE",
        "UNRESOLVED_FINDING_CITATION",
        "Có phát hiện chưa được gắn trích dẫn nguồn hiện hành, ACTIVE và đã xác minh theo đúng phiên bản quy tắc.",
        { rule_key: finding.rule_key },
      );
    }
    for (const sourceId of finding.citation_ids) {
      const source = input.sources.find(
        (candidate) => candidate.id === sourceId,
      );
      const ruleRef = activeRule?.source_snapshot?.find(
        (ref) => ref.id === sourceId,
      );
      const executedRef = executedByRule
        .get(finding.rule_key)
        ?.source_versions.find((ref) => ref.id === sourceId);
      if (
        !source ||
        !activeRule?.source_citations.includes(sourceId) ||
        !ruleRef ||
        !executedRef ||
        ruleRef.version !== source.version ||
        ruleRef.content_hash !== source.content_hash ||
        executedRef.version !== source.version ||
        executedRef.content_hash !== source.content_hash
      ) {
        add(
          "BLOCKED_REGULATORY_SOURCE",
          "UNRESOLVED_FINDING_CITATION",
          "Trích dẫn của phát hiện không khớp chính xác với bản lưu nguồn của quy tắc ACTIVE.",
          { source_id: sourceId, rule_key: finding.rule_key },
        );
      }
    }
  }

  const expectedVolume = input.product.expected_us_units_12m;
  if (
    expectedVolume == null ||
    !Number.isFinite(expectedVolume) ||
    expectedVolume < 0
  ) {
    add(
      "NEEDS_CUSTOMER_INFORMATION",
      "EXPECTED_US_VOLUME_MISSING",
      "Thiếu hoặc không hợp lệ số đơn vị dự kiến bán tại Hoa Kỳ trong 12 tháng.",
    );
    question(
      "Vui lòng cung cấp số đơn vị dự kiến bán tại Hoa Kỳ trong 12 tháng tới.",
    );
  }
  if (
    input.product.exemption_requested &&
    (input.product.employee_fte == null ||
      !Number.isFinite(input.product.employee_fte) ||
      input.product.employee_fte < 0)
  ) {
    add(
      "NEEDS_CUSTOMER_INFORMATION",
      "EMPLOYEE_COUNT_MISSING_FOR_EXEMPTION",
      "Thiếu hoặc không hợp lệ số nhân viên quy đổi tương đương toàn thời gian (FTE) cho yêu cầu đánh giá miễn trừ.",
    );
    question(
      "Vui lòng cung cấp số nhân viên quy đổi tương đương toàn thời gian (FTE) để chuyên gia đánh giá yêu cầu miễn trừ.",
    );
  }
  if (!input.product.formula_confirmed) {
    add(
      "NEEDS_CUSTOMER_INFORMATION",
      "FORMULA_CONFIRMATION_MISSING",
      "Công thức sản phẩm chưa được khách hàng xác nhận.",
    );
    question("Vui lòng xác nhận công thức cuối cùng của sản phẩm.");
  }
  if (!input.product.claims_confirmed) {
    add(
      "NEEDS_CUSTOMER_INFORMATION",
      "CLAIMS_CONFIRMATION_MISSING",
      "Danh sách tuyên bố trên nhãn chưa được khách hàng xác nhận.",
    );
    question("Vui lòng xác nhận toàn bộ tuyên bố xuất hiện trên nhãn.");
  }

  if (
    input.ocr_confidence == null ||
    !Number.isFinite(input.ocr_confidence) ||
    input.ocr_confidence < 0 ||
    input.ocr_confidence > 1
  ) {
    add(
      "NEEDS_CUSTOMER_INFORMATION",
      "OCR_CONFIDENCE_UNAVAILABLE",
      "Chưa có chỉ số chất lượng OCR hợp lệ để đánh giá phạm vi đọc nhãn.",
    );
    question("Vui lòng tải lên ảnh/PDF nhãn rõ nét để hệ thống đọc lại.");
  } else if (input.ocr_confidence < MINIMUM_OCR_CONFIDENCE) {
    add(
      "NEEDS_CUSTOMER_INFORMATION",
      "OCR_CONFIDENCE_LOW",
      `Độ tin cậy OCR thấp hơn ngưỡng ${Math.round(MINIMUM_OCR_CONFIDENCE * 100)}%; cần file nhãn rõ hơn.`,
    );
    question(
      "Vui lòng tải lên ảnh/PDF nhãn rõ nét hơn, đủ sáng và không bị cắt.",
    );
  }
  if (
    input.ocr_pages == null ||
    input.expected_pages == null ||
    !Number.isFinite(input.ocr_pages) ||
    !Number.isFinite(input.expected_pages) ||
    input.ocr_pages <= 0 ||
    input.expected_pages <= 0 ||
    input.ocr_pages < input.expected_pages
  ) {
    add(
      "NEEDS_CUSTOMER_INFORMATION",
      "OCR_PAGE_COVERAGE_INCOMPLETE",
      "Chưa xác nhận được nội dung trên toàn bộ trang nhãn đã tải lên.",
    );
    question("Vui lòng kiểm tra và tải đủ tất cả các mặt/trang của nhãn.");
  }
  const lowConfidenceFields = input.fields.filter(
    (field) =>
      field.value &&
      (!Number.isFinite(field.confidence) || field.confidence < 0.65) &&
      !field.manually_verified &&
      field.evidence.kind === "observed",
  );
  if (lowConfidenceFields.length) {
    add(
      "NEEDS_CUSTOMER_INFORMATION",
      "IMPORTANT_FIELD_CONFIDENCE_LOW",
      "Một hoặc nhiều trường quan trọng có độ tin cậy đọc thấp.",
    );
    question(
      "Vui lòng gửi bản nhãn có độ phân giải cao hơn để xác minh các trường chữ nhỏ.",
    );
  }

  const claims = [
    ...input.product.claims,
    ...input.fields
      .filter((field) => field.field === "claim" && field.value)
      .map((field) => field.value!),
  ];
  const claimClasses = [
    ...new Set(claims.map((claim) => classifyClaim(claim).classification)),
  ];
  if (claimClasses.includes("DISEASE_CLAIM")) {
    add(
      "EXPERT_REVIEW_REQUIRED",
      "DISEASE_CLAIM_REQUIRES_EXPERT",
      "Phát hiện dấu hiệu tuyên bố liên quan bệnh lý; chuyển chuyên gia phân loại, không tự kết luận vi phạm.",
    );
  }
  if (claimClasses.includes("HEALTH_CLAIM")) {
    add(
      "EXPERT_REVIEW_REQUIRED",
      "HEALTH_CLAIM_REQUIRES_EXPERT",
      "Phát hiện tuyên bố về sức khỏe; cần chuyên gia xác minh phạm vi và bằng chứng, không tự kết luận vi phạm.",
    );
  }
  if (claimClasses.includes("STRUCTURE_FUNCTION_CLAIM")) {
    add(
      "EXPERT_REVIEW_REQUIRED",
      "STRUCTURE_FUNCTION_CLAIM_REQUIRES_EXPERT",
      "Tuyên bố về chức năng/công dụng cần chuyên gia phân loại và đối chiếu bằng chứng.",
    );
  }
  if (input.product.classification_status === "uncertain") {
    add(
      "EXPERT_REVIEW_REQUIRED",
      "PRODUCT_CLASSIFICATION_UNCERTAIN",
      "Chưa xác nhận sản phẩm thuộc nhóm thực phẩm thông thường; cần chuyên gia xác minh.",
    );
  }

  const criticalFindings = input.findings.filter(
    (finding) => finding.severity === "critical",
  );
  const majorFindings = input.findings.filter(
    (finding) => finding.severity === "major",
  );
  if (criticalFindings.length) {
    add(
      "EXPERT_REVIEW_REQUIRED",
      "CRITICAL_FINDING_REQUIRES_EXPERT",
      "Có phát hiện mức nghiêm trọng cần chuyên gia xác nhận trước khi đưa ra kết quả.",
    );
  }
  if (majorFindings.length >= 2) {
    add(
      "EXPERT_REVIEW_REQUIRED",
      "MULTIPLE_MAJOR_FINDINGS_REQUIRE_EXPERT",
      "Có từ hai phát hiện mức cần sửa trở lên; cần chuyên gia xem xét tổng thể.",
    );
  }
  const explicitlyHumanReviewed = input.findings.some(
    (finding) => finding.human_review_required,
  );
  if (explicitlyHumanReviewed) {
    add(
      "EXPERT_REVIEW_REQUIRED",
      "RULE_REQUIRES_EXPERT_REVIEW",
      "Một hoặc nhiều quy tắc đánh dấu kết quả cần chuyên gia xác nhận.",
    );
  }

  const riskScore = Math.min(
    100,
    input.findings.reduce((score, finding) => {
      const severityPoints =
        finding.severity === "critical"
          ? 45
          : finding.severity === "major"
            ? 20
            : finding.severity === "minor"
              ? 6
              : 0;
      return score + severityPoints + (finding.human_review_required ? 10 : 0);
    }, 0) + (claimClasses.includes("UNCERTAIN") ? 10 : 0),
  );
  if (riskScore >= 50) {
    add(
      "EXPERT_REVIEW_REQUIRED",
      "HIGH_RISK_SCORE",
      "Điểm rủi ro đạt ngưỡng khuyến nghị người rà soát chuyên môn; điểm số không ghi đè các hard gate khác.",
    );
  }

  const allReasons = uniqueReasons(reasons);
  const gates = new Set(allReasons.map((reason) => reason.gate));
  const triageRoute: TriageRoute = gates.has("OUT_OF_SCOPE")
    ? "OUT_OF_SCOPE"
    : gates.has("BLOCKED_REGULATORY_SOURCE")
      ? "BLOCKED_REGULATORY_SOURCE"
      : gates.has("EXPERT_REVIEW_REQUIRED")
        ? "EXPERT_REVIEW_REQUIRED"
        : gates.has("NEEDS_CUSTOMER_INFORMATION")
          ? "NEEDS_CUSTOMER_INFORMATION"
          : "AUTO_SCREENED";
  const overallResult: TriageOverallResult =
    triageRoute === "OUT_OF_SCOPE"
      ? "OUT_OF_SCOPE"
      : triageRoute === "BLOCKED_REGULATORY_SOURCE"
        ? "BLOCKED"
        : triageRoute === "NEEDS_CUSTOMER_INFORMATION"
          ? "INSUFFICIENT_INFORMATION"
          : triageRoute === "EXPERT_REVIEW_REQUIRED"
            ? "NOT_ASSESSED"
            : input.findings.some(
                  (finding) => finding.severity !== "information",
                )
              ? "POTENTIAL_ISSUES_FOUND"
              : "NO_AUTOMATED_ISSUE_DETECTED";

  const reportStatus: TriageReportStatus =
    triageRoute === "OUT_OF_SCOPE" ||
    triageRoute === "BLOCKED_REGULATORY_SOURCE"
      ? "BLOCKED"
      : triageRoute === "AUTO_SCREENED"
        ? "DISABLED"
        : "NOT_ISSUED";

  return {
    policy_version: TRIAGE_POLICY_VERSION,
    triage_route: triageRoute,
    overall_result: overallResult,
    risk_score: riskScore,
    reasons: allReasons,
    customer_questions: customerQuestions,
    report_status: reportStatus,
    evaluated_at: evaluatedAt.toISOString(),
  };
}

export const PRE_SCREENING_DISCLAIMER = {
  vi: "Tài liệu này chỉ là kết quả sàng lọc sơ bộ tự động trong phạm vi đã nêu. Đây không phải quyết định của cơ quan quản lý, không xác nhận tuân thủ hoặc điều kiện nhập khẩu, và không thay thế rà soát chuyên gia hay tư vấn pháp lý.",
  en: "Automated pre-screening only within the stated scope. This is not a regulatory decision or a determination of legal compliance or import eligibility, and it is not a substitute for expert review or legal advice.",
} as const;

export function buildPreScreeningSnapshot(input: {
  reviewId: string;
  labelVersionId: string;
  decision: TriageDecision;
  findings: Finding[];
  ruleSnapshot: Review["rule_snapshot"];
  generatedAt?: Date;
}): PreScreeningSnapshot {
  if (input.decision.triage_route !== "AUTO_SCREENED")
    throw new Error("Chỉ AUTO_SCREENED mới được tạo pre-screen artifact.");
  const snapshot: PreScreeningSnapshot = {
    schema_version: "pre-screening/1.0.0",
    disclaimer_profile: "PRE_SCREENING_ONLY",
    disclaimer: PRE_SCREENING_DISCLAIMER,
    review_id: input.reviewId,
    label_version_id: input.labelVersionId,
    review_scope: "us_federal_food_labeling_mvp",
    triage_route: "AUTO_SCREENED",
    overall_result: input.decision.overall_result,
    policy_version: input.decision.policy_version,
    risk_score: input.decision.risk_score,
    triage_reasons: input.decision.reasons,
    findings: input.findings.map((finding) => ({
      rule_key: finding.rule_key,
      severity: finding.severity,
      summary:
        findingSummaries[finding.rule_key] ??
        "Có mục cần đối chiếu trong phạm vi sàng lọc sơ bộ.",
    })),
    source_rule_snapshot: (input.ruleSnapshot ?? []).map((rule) => ({
      rule_key: rule.rule_key,
      version: rule.version,
      sources: rule.source_versions.map((source) => ({
        id: source.id,
        version: source.version,
        content_hash: source.content_hash,
      })),
    })),
    generated_at: (input.generatedAt ?? new Date()).toISOString(),
  };
  assertPreScreeningLanguageSafe(snapshot);
  return snapshot;
}

export function assertPreScreeningLanguageSafe(snapshot: unknown) {
  const serialized = JSON.stringify(snapshot);
  const forbidden =
    /FDA\s+(?:approved|compliant)|được\s+phép\s+xuất\s+khẩu|được\s+FDA\s+phê\s+duyệt/i;
  if (forbidden.test(serialized))
    throw new Error("Pre-screen artifact chứa cách diễn đạt bị cấm.");
}

export function runtimePreScreeningEnabled(
  env: Record<string, string | undefined>,
) {
  return (
    env.REGULATORY_PRE_SCREENING_ENABLED === "true" &&
    env.REGULATORY_PRE_SCREENING_ENV === "staging" &&
    (env.DEPLOYMENT_ENV === "staging" || env.VERCEL_ENV === "preview") &&
    env.VERCEL_ENV !== "production" &&
    env.DEPLOYMENT_ENV !== "production"
  );
}

export function mayIssuePreScreening(input: {
  runtimeEnabled: boolean;
  databaseEnabled: boolean;
  organizationId: string;
  allowedOrganizationIds: string[];
}) {
  return (
    input.runtimeEnabled &&
    input.databaseEnabled &&
    input.allowedOrganizationIds.includes(input.organizationId)
  );
}
