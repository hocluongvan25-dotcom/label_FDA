import type {
  ComplianceRule,
  Evidence,
  ExtractedField,
  Finding,
  Product,
  RegulatorySource,
  Severity,
} from "./types";
import {
  classifyClaim,
  detectAllergens,
  detectDeclaredAllergens,
  normalizeIngredient,
  parseIngredientList,
  parseNetQuantity,
} from "./extraction";
import { now, sourceIsCurrent, uid } from "./utils";

export interface RuleInput {
  product: Product;
  fields: ExtractedField[];
  rules: ComplianceRule[];
  sources: RegulatorySource[];
  reviewId: string;
  at?: Date;
}
export interface RuleOutput {
  findings: Finding[];
  rules_executed: { rule_key: string; version: number; fired: boolean }[];
  warnings: string[];
  human_review_required: true;
}
export function exemptionPrecheck(product: Product) {
  if (!product.exemption_requested)
    return {
      status: "NOT_REQUESTED",
      reason: "Chưa đề nghị đánh giá exemption.",
    };
  if (product.employee_fte === null || product.expected_us_units_12m === null)
    return {
      status: "INSUFFICIENT_INFORMATION",
      reason: "Cần số FTE và số đơn vị bán tại Hoa Kỳ trong 12 tháng.",
    };
  return {
    status: "HUMAN_REVIEW_REQUIRED",
    reason: `Dữ liệu khai báo: ${product.employee_fte} FTE; ${product.expected_us_units_12m.toLocaleString("vi-VN")} đơn vị/12 tháng. Chưa xác định điều kiện miễn. Cần đối chiếu claim, loại sản phẩm, thời kỳ và hồ sơ theo nguồn hiện hành.`,
  };
}

export function evaluateRules(input: RuleInput): RuleOutput {
  const { product, fields, rules, sources, reviewId } = input;
  const at = input.at ?? new Date();
  const day = at.toISOString().slice(0, 10);
  const active = rules.filter(
    (r) =>
      r.status === "ACTIVE" &&
      (r.scope.includes(product.category) || r.rule_key === "CLASS-001") &&
      (!r.effective_from || r.effective_from <= day) &&
      (!r.effective_to || r.effective_to >= day) &&
      r.source_snapshot?.length === r.source_citations.length &&
      r.source_citations.length > 0 &&
      r.source_snapshot.every((ref) => {
        const source = sources.find((s) => s.id === ref.id);
        return (
          r.source_citations.includes(ref.id) &&
          !!source &&
          sourceIsCurrent(source, at) &&
          source.version === ref.version &&
          source.content_hash === ref.content_hash
        );
      }),
  );
  // Never run two versions of the same rule in a single review.
  const latest = [
    ...new Map(
      active.sort((a, b) => a.version - b.version).map((r) => [r.rule_key, r]),
    ).values(),
  ];
  const findings: Finding[] = [];
  const executed: RuleOutput["rules_executed"] = [];
  const warnings: string[] = [];
  const field = (key: string) => fields.find((f) => f.field === key);
  const value = (key: string) => field(key)?.value?.trim();
  const allObservedText = fields
    .filter((f) => f.evidence.kind === "observed")
    .map((f) => f.evidence.text)
    .join("\n");
  const fallback: Evidence = {
    file_id: fields[0]?.evidence.file_id ?? "",
    page: 1,
    bbox: null,
    text: "Trường thông tin chưa được phát hiện trong các trang nhãn đã đọc. Cần đối chiếu nhãn gốc.",
    kind: "absence",
  };
  const evidenceFor = (key: string) => field(key)?.evidence ?? fallback;
  const claims = [
    ...fields
      .filter((f) => f.field === "claim" && f.value)
      .map((f) => ({ text: f.value!, evidence: f.evidence })),
    ...product.claims
      .filter((c) => !fields.some((f) => f.field === "claim" && f.value === c))
      .map((c) => ({
        text: c,
        evidence: {
          file_id: "",
          page: 1,
          bbox: null,
          text: `Claim khách hàng khai báo: ${c}`,
          kind: "dossier" as const,
        },
      })),
  ];
  const classifications = claims.map((c) => ({
    ...c,
    ...classifyClaim(c.text),
  }));
  const formulaAllergens = [
    ...new Set(
      product.formula.flatMap((i) => [
        ...i.allergen_groups,
        ...detectAllergens(`${i.name_original} ${i.name_english}`),
      ]),
    ),
  ];
  const declaredAllergens = detectDeclaredAllergens(
    `${value("ingredient_list") ?? ""} ${value("allergen_statement") ?? ""}`,
  );

  for (const rule of latest) {
    let issue: {
      title: string;
      description: string;
      evidence: Evidence[];
      severity?: Severity;
      confidence?: number;
    } | null = null;
    switch (rule.rule_key) {
      case "IDENTITY-001":
        if (!value("statement_of_identity"))
          issue = {
            title: "Chưa phát hiện tên gọi thực phẩm",
            description:
              "Không đọc được statement of identity trong phạm vi các panel đã xử lý. Đây là kiểm tra sự hiện diện, chưa đánh giá kích thước chữ hoặc vị trí.",
            evidence: [evidenceFor("statement_of_identity")],
          };
        break;
      case "NETQTY-001": {
        const v = value("net_quantity");
        const normalized = v ? parseNetQuantity(v) : null;
        if (!v)
          issue = {
            title: "Chưa phát hiện khối lượng tịnh",
            description:
              "Chưa tìm thấy net quantity trên nhãn đã đọc. Không suy đoán từ khối lượng khách hàng nhập.",
            evidence: [evidenceFor("net_quantity")],
          };
        else if (
          normalized &&
          (normalized.metric_value === null ||
            normalized.imperial_value === null ||
            normalized.consistent === false)
        )
          issue = {
            title: "Khối lượng tịnh cần đối chiếu",
            description: `Nội dung nhãn: “${v}”. ${normalized.consistent === false ? "Quy đổi hai đơn vị có độ lệch cần kiểm tra." : "Chưa đọc được đầy đủ cặp đơn vị metric / US customary."} Chuyên viên cần xác nhận cách áp dụng.`,
            evidence: [evidenceFor("net_quantity")],
            confidence: field("net_quantity")?.confidence,
          };
        break;
      }
      case "INGREDIENT-001":
        if (!value("ingredient_list"))
          issue = {
            title: "Chưa phát hiện danh sách nguyên liệu",
            description:
              "Chưa đọc được ingredient list. Công thức trong hồ sơ không thay thế thông tin hiện diện trên nhãn.",
            evidence: [evidenceFor("ingredient_list")],
          };
        break;
      case "NUTRITION-001":
        if (!value("nutrition_facts"))
          issue = {
            title: "Chưa phát hiện Nutrition Facts",
            description: `Nutrition Facts chưa được phát hiện và điều kiện exemption chưa được chuyên viên xác định. ${exemptionPrecheck(product).reason}`,
            evidence: [evidenceFor("nutrition_facts")],
          };
        break;
      case "NUTRITION-002": {
        const c = classifications.find(
          (c) => c.classification === "NUTRIENT_CONTENT_CLAIM",
        );
        if (c && product.exemption_requested)
          issue = {
            title: "Nutrition claim có thể ảnh hưởng exemption",
            description: `Claim “${c.text}” được phân loại sơ bộ là nutrient content claim, trong khi hồ sơ đề nghị exemption. Không được tự động coi sản phẩm đủ điều kiện miễn.`,
            evidence: [c.evidence],
            confidence: c.confidence,
          };
        break;
      }
      case "ALLERGEN-001": {
        const missing = formulaAllergens.filter(
          (a) => a !== "sesame" && !declaredAllergens.includes(a),
        );
        if (missing.length)
          issue = {
            title: "Có dị nguyên chưa được đối chiếu trên nhãn",
            description: `Công thức có nguồn dị nguyên: ${missing.join(", ")}. Chưa thấy khai báo tương ứng trong ingredient / allergen statement. Cần xác minh loại nguyên liệu và tên được khai báo.`,
            evidence: [
              evidenceFor("ingredient_list"),
              {
                file_id: "",
                page: 1,
                bbox: null,
                text: product.formula.map((i) => i.name_english).join(", "),
                kind: "dossier",
              },
            ],
          };
        break;
      }
      case "ALLERGEN-002":
        if (
          formulaAllergens.includes("sesame") &&
          !declaredAllergens.includes("sesame")
        )
          issue = {
            title: "Sesame trong công thức chưa thấy trên nhãn",
            description:
              "Hồ sơ có mè / vừng / sesame, nhưng chưa tìm được khai báo tương ứng trong thông tin đọc từ nhãn. Bắt buộc chuyên viên đối chiếu.",
            evidence: [
              evidenceFor("ingredient_list"),
              {
                file_id: "",
                page: 1,
                bbox: null,
                text: product.formula
                  .filter(
                    (i) =>
                      detectAllergens(
                        `${i.name_original} ${i.name_english}`,
                      ).includes("sesame") ||
                      i.allergen_groups.includes("sesame"),
                  )
                  .map((i) => i.name_english)
                  .join(", "),
                kind: "dossier",
              },
            ],
          };
        break;
      case "CLAIM-001": {
        const c = classifications.find(
          (c) => c.classification === "DISEASE_CLAIM",
        );
        if (c)
          issue = {
            title: "Claim có dấu hiệu liên quan bệnh lý",
            description: `Phát hiện nội dung “${c.text}”. Bộ dò từ khóa xếp loại DISEASE_CLAIM; đây là cảnh báo rủi ro, không phải kết luận phân loại pháp lý. Bắt buộc chuyển chuyên gia.`,
            evidence: [c.evidence],
            confidence: c.confidence,
          };
        break;
      }
      case "CLAIM-002": {
        const c = classifications.find(
          (c) => c.classification === "NUTRIENT_CONTENT_CLAIM",
        );
        if (c)
          issue = {
            title: "Claim dinh dưỡng cần dữ liệu chứng minh",
            description: `Claim “${c.text}” cần đối chiếu tiêu chí áp dụng, dữ liệu phân tích và Nutrition Facts. Không xác định đạt tiêu chí từ câu chữ đơn lẻ.`,
            evidence: [c.evidence],
            confidence: c.confidence,
          };
        break;
      }
      case "CLAIM-003": {
        const c = claims.find((c) =>
          /\b(natural|organic|non[- ]?gmo)\b/i.test(c.text),
        );
        if (c) {
          const organic = /\borganic\b/i.test(c.text);
          const cert = product.certifications.some((x) => /organic/i.test(x));
          issue = {
            title:
              organic && !cert
                ? "Organic claim chưa có hồ sơ chứng nhận"
                : "Claim marketing cần chuyên gia xác minh",
            description: `Nội dung “${c.text}”. ${organic && !cert ? "Chưa có thông tin organic certificate trong hồ sơ." : "Cần đối chiếu chứng cứ và phạm vi claim."} Hệ thống không kết luận organic certification; chuyển chuyên gia khi cần.`,
            evidence: [c.evidence],
            severity: organic && !cert ? "critical" : "major",
          };
        }
        break;
      }
      case "FORMULA-001": {
        const v = value("ingredient_list");
        if (v && product.formula.length) {
          const label = parseIngredientList(v);
          const formula = [...product.formula]
            .sort((a, b) => a.order - b.order)
            .map((i) => normalizeIngredient(i.name_english));
          const missing = formula.filter((i) => !label.includes(i));
          const extra = label.filter((i) => !formula.includes(i));
          const wrongOrder =
            !missing.length &&
            !extra.length &&
            label.join("|") !== formula.join("|");
          if (missing.length || extra.length || wrongOrder)
            issue = {
              title: "Nguyên liệu trên nhãn chưa khớp công thức",
              description: `${missing.length ? `Chưa khớp từ công thức: ${missing.join(", ")}. ` : ""}${extra.length ? `Chưa khớp từ nhãn: ${extra.join(", ")}. ` : ""}${wrongOrder ? "Thứ tự nguyên liệu khác thứ tự khối lượng đã khai báo. " : ""}Bộ chuẩn hóa tên có phạm vi giới hạn; chuyên viên xác nhận trước khi yêu cầu sửa.`,
              evidence: [
                evidenceFor("ingredient_list"),
                {
                  file_id: "",
                  page: 1,
                  bbox: null,
                  text: `Công thức: ${formula.join(", ")}`,
                  kind: "dossier",
                },
              ],
            };
        }
        break;
      }
      case "LABEL-001": {
        const low = fields.find(
          (f) =>
            f.value &&
            f.confidence < Number(rule.condition_json.ocr_threshold ?? 0.75) &&
            !f.manually_verified,
        );
        if (low)
          issue = {
            title: "Một vùng nhãn có độ tin cậy đọc thấp",
            description: `Trường ${low.field} có confidence ${Math.round(low.confidence * 100)}%. Cần file rõ hơn hoặc xác minh thủ công. Chưa đủ dữ liệu để kết luận vi phạm kích thước chữ.`,
            evidence: [low.evidence],
            confidence: low.confidence,
          };
        break;
      }
      case "LABEL-002":
        if (value("english_required_information") !== "detected")
          issue = {
            title: "Chưa xác định thông tin bắt buộc bằng tiếng Anh",
            description:
              "Bộ dò ngôn ngữ chưa xác minh được English required information. Không suy đoán ngôn ngữ chỉ từ bảng chữ cái Latin.",
            evidence: [evidenceFor("english_required_information")],
          };
        break;
      case "PARTY-001": {
        const v = value("responsible_party");
        if (
          !v ||
          !/\d|street|road|ave|vietnam|viet nam|hanoi|district|usa/i.test(v)
        )
          issue = {
            title: "Thông tin đơn vị chịu trách nhiệm chưa đầy đủ",
            description:
              "Chưa đọc được đầy đủ tên, địa chỉ và vai trò manufacturer / packer / distributor trên nhãn. Thông tin doanh nghiệp trong hồ sơ không thay thế label statement.",
            evidence: [evidenceFor("responsible_party")],
          };
        break;
      }
      case "CLASS-001": {
        if (
          !["dry_packaged_tea", "tea_bag"].includes(product.category) ||
          product.classification_status !== "conventional_food" ||
          product.form === "liquid" ||
          product.form === "other" ||
          product.formula.some((i) =>
            /extract|isolate|concentrate|proprietary|premix|cbd|cannabidiol|hemp|melatonin|glucosamine|nootropic|vitamin|creatine|chiet xuat/i.test(
              normalizeIngredient(`${i.name_original} ${i.name_english}`),
            ),
          ) ||
          classifications.some((c) => c.classification === "DISEASE_CLAIM")
        )
          issue = {
            title: "Phân loại sản phẩm cần chuyên gia xác nhận",
            description:
              "Phạm vi tự động chỉ hỗ trợ trà khô và trà túi lọc conventional food. Nhóm sản phẩm chưa rõ, ngoài phạm vi hoặc có disease claim phải được chuyên gia xác định trước.",
            evidence: [
              {
                file_id: "",
                page: 1,
                bbox: null,
                text: `Category: ${product.category}; classification: ${product.classification_status}`,
                kind: "dossier",
              },
            ],
          };
        break;
      }
    }
    executed.push({
      rule_key: rule.rule_key,
      version: rule.version,
      fired: !!issue,
    });
    if (!issue) continue;
    const citationIds = rule.source_citations.filter((id) =>
      sources.some((s) => s.id === id),
    );
    const citationPending =
      citationIds.length === 0 ||
      citationIds.some(
        (id) =>
          !sourceIsCurrent(
            sources.find((s) => s.id === id)!,
            at,
          ),
      );
    const severity = issue.severity ?? rule.action_json.severity;
    findings.push({
      id: uid(),
      review_id: reviewId,
      organization_id: product.organization_id,
      rule_key: rule.rule_key,
      rule_version: rule.version,
      severity,
      status: "open",
      title: issue.title,
      description: issue.description,
      evidence: issue.evidence,
      citation_ids: citationIds,
      citation_pending: citationPending,
      suggested_action: rule.action_json.suggested_action,
      ai_confidence:
        issue.confidence ??
        Math.min(
          ...issue.evidence
            .filter((e) => e.kind === "observed")
            .map(
              (e) =>
                fields.find((f) => f.evidence.text === e.text)?.confidence ??
                0.85,
            ),
          0.9,
        ),
      reasoning_category: (["allergen", "sesame"].includes(
        String(rule.condition_json.type),
      )
        ? "allergen"
        : String(rule.condition_json.type).includes("claim")
          ? "claim"
          : ["consistency", "classification", "readability"].includes(
                String(rule.condition_json.type),
              )
            ? rule.condition_json.type
            : "field_presence") as Finding["reasoning_category"],
      human_review_required:
        rule.action_json.human_review ||
        severity === "critical" ||
        citationPending,
      reviewer_comment: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: now(),
    });
  }
  if (
    latest.some((r) =>
      r.source_citations.some((id) =>
        sources.some(
          (s) => s.id === id && s.raw_snapshot_id && s.effective_date_unknown,
        ),
      ),
    )
  )
    warnings.push(
      "Có nguồn API đang ACTIVE nhưng effective date chưa xác định. Chuyên viên phải xác minh riêng; issue date không thay thế ngày hiệu lực.",
    );
  if (!latest.length)
    warnings.push(
      "Không có quy tắc ACTIVE phù hợp. Không được trả kết luận không phát hiện vấn đề.",
    );
  if (
    latest.length < 15 &&
    ["dry_packaged_tea", "tea_bag"].includes(product.category)
  )
    warnings.push("Bộ 15 quy tắc MVP chưa đầy đủ hoặc chưa có hiệu lực.");
  if (findings.some((f) => f.citation_pending))
    warnings.push("Có citation cần chuyên gia đối chiếu / phê duyệt nguồn.");
  const uncertain = classifications.filter(
    (c) =>
      c.classification === "UNCERTAIN" ||
      c.classification === "HEALTH_CLAIM" ||
      c.classification === "STRUCTURE_FUNCTION_CLAIM" ||
      c.classification === "ALLERGEN_CLAIM" ||
      c.confidence < 0.75,
  );
  if (uncertain.length)
    warnings.push(
      `Claim cần chuyên gia phân loại: ${uncertain.map((c) => c.text).join("; ")}`,
    );
  if (!allObservedText.trim())
    warnings.push("Không có nội dung nhãn được xác minh.");
  return {
    findings: verifyFindings(findings, sources, product),
    rules_executed: executed,
    warnings,
    human_review_required: true,
  };
}

export function verifyFindings(
  findings: Finding[],
  sources: RegulatorySource[],
  product: Product,
) {
  const seen = new Set<string>();
  const forbidden =
    /(?:FDA\s+(?:approved|certified)|guaranteed\s+customs\s+clearance|100%\s+legal|FDA has approved)/i;
  return findings.filter((f) => {
    if (f.organization_id !== product.organization_id)
      throw new Error("Finding không cùng organization.");
    if (!f.evidence.length) throw new Error("Finding thiếu evidence.");
    if (forbidden.test(f.title) || forbidden.test(f.suggested_action))
      throw new Error("Finding có kết luận tuyệt đối bị cấm.");
    if (f.citation_ids.some((id) => !sources.some((s) => s.id === id)))
      throw new Error("Citation nằm ngoài source registry.");
    for (const e of f.evidence) {
      if (
        e.bbox &&
        (e.bbox.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
          e.bbox[2] <= e.bbox[0] ||
          e.bbox[3] <= e.bbox[1])
      )
        throw new Error("Evidence bounding box không hợp lệ.");
    }
    if (
      ["critical", "major"].includes(f.severity) &&
      !f.citation_ids.length &&
      !f.citation_pending
    )
      throw new Error(
        "Finding quan trọng thiếu citation hoặc pending human review.",
      );
    const key = `${f.rule_key}|${f.title}|${f.evidence.map((e) => e.text).join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
