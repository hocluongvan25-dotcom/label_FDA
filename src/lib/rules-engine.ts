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
      reason: "Chưa yêu cầu đánh giá điều kiện miễn trừ.",
    };
  if (product.employee_fte === null || product.expected_us_units_12m === null)
    return {
      status: "INSUFFICIENT_INFORMATION",
      reason:
        "Cần số nhân viên quy đổi tương đương toàn thời gian (FTE) và số đơn vị bán tại Hoa Kỳ trong 12 tháng.",
    };
  return {
    status: "HUMAN_REVIEW_REQUIRED",
    reason: `Dữ liệu khai báo: ${product.employee_fte} FTE; ${product.expected_us_units_12m.toLocaleString("vi-VN")} đơn vị/12 tháng. Chưa xác định điều kiện miễn trừ. Cần đối chiếu các tuyên bố trên nhãn, loại sản phẩm, thời kỳ và hồ sơ theo nguồn hiện hành.`,
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
          text: `Tuyên bố trên nhãn do khách hàng khai báo: ${c}`,
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
              "Không đọc được tên gọi thực phẩm (statement of identity) trong các vùng nhãn đã xử lý. Đây là kiểm tra sự hiện diện, chưa đánh giá kích thước chữ hoặc vị trí.",
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
              "Chưa tìm thấy khối lượng tịnh trên nhãn đã đọc. Không suy đoán từ khối lượng khách hàng nhập.",
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
            description: `Nội dung nhãn: “${v}”. ${normalized.consistent === false ? "Quy đổi hai đơn vị có độ lệch cần kiểm tra." : "Chưa đọc đủ cả đơn vị mét và đơn vị đo lường Hoa Kỳ."} Chuyên viên cần xác nhận cách áp dụng.`,
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
              "Chưa đọc được danh sách nguyên liệu. Công thức trong hồ sơ không thay thế thông tin thể hiện trên nhãn.",
            evidence: [evidenceFor("ingredient_list")],
          };
        break;
      case "NUTRITION-001":
        if (!value("nutrition_facts"))
          issue = {
            title: "Chưa phát hiện bảng thông tin dinh dưỡng (Nutrition Facts)",
            description: `Chưa phát hiện bảng thông tin dinh dưỡng và chuyên viên chưa xác định điều kiện miễn trừ. ${exemptionPrecheck(product).reason}`,
            evidence: [evidenceFor("nutrition_facts")],
          };
        break;
      case "NUTRITION-002": {
        const c = classifications.find(
          (c) => c.classification === "NUTRIENT_CONTENT_CLAIM",
        );
        if (c && product.exemption_requested)
          issue = {
            title: "Tuyên bố về dinh dưỡng có thể ảnh hưởng điều kiện miễn trừ",
            description: `Tuyên bố “${c.text}” được phân loại sơ bộ là tuyên bố về hàm lượng dinh dưỡng, trong khi hồ sơ đề nghị miễn trừ. Không được tự động coi sản phẩm đủ điều kiện miễn.`,
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
            description: `Công thức có nguồn dị nguyên: ${missing.join(", ")}. Chưa thấy khai báo tương ứng trong danh sách nguyên liệu hoặc thông tin dị nguyên. Cần xác minh loại nguyên liệu và tên khai báo.`,
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
            title:
              "Chưa thấy mè (sesame) trong thông tin nguyên liệu trên nhãn",
            description:
              "Hồ sơ có mè / vừng (sesame), nhưng chưa tìm thấy thông tin khai báo tương ứng trên nhãn. Chuyên viên cần đối chiếu.",
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
        // Disease-claim detection is a triage signal only. Do not create an
        // automated compliance/violation finding; triage sends it to an expert.
        break;
      }
      case "CLAIM-002": {
        const c = classifications.find(
          (c) => c.classification === "NUTRIENT_CONTENT_CLAIM",
        );
        if (c)
          issue = {
            title: "Tuyên bố về dinh dưỡng cần dữ liệu chứng minh",
            description: `Tuyên bố “${c.text}” cần được đối chiếu với tiêu chí áp dụng, dữ liệu phân tích và bảng thông tin dinh dưỡng (Nutrition Facts). Không kết luận đạt tiêu chí chỉ từ câu chữ.`,
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
                ? "Tuyên bố hữu cơ chưa có hồ sơ chứng nhận"
                : "Tuyên bố quảng bá cần chuyên gia xác minh",
            description: `Nội dung “${c.text}”. ${organic && !cert ? "Chưa có thông tin chứng nhận hữu cơ trong hồ sơ." : "Cần đối chiếu bằng chứng và phạm vi tuyên bố trên nhãn."} Hệ thống không tự kết luận về chứng nhận hữu cơ; chuyển chuyên gia khi cần.`,
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
              "Phạm vi xử lý tự động chỉ hỗ trợ trà khô và trà túi lọc thuộc nhóm thực phẩm thông thường. Nhóm sản phẩm chưa rõ, ngoài phạm vi hoặc có tuyên bố liên quan bệnh lý phải được chuyên gia xác định trước.",
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
      "Có nguồn qua API đang ACTIVE (đang có hiệu lực) nhưng chưa xác định ngày hiệu lực. Chuyên viên cần xác minh riêng; ngày ban hành không thay thế ngày hiệu lực.",
    );
  if (!latest.length)
    warnings.push(
      "Không có quy tắc ACTIVE (đang có hiệu lực) phù hợp. Không được kết luận rằng không phát hiện vấn đề.",
    );
  if (
    latest.length < 15 &&
    ["dry_packaged_tea", "tea_bag"].includes(product.category)
  )
    warnings.push(
      "Bộ 15 quy tắc trong phạm vi hỗ trợ hiện tại chưa đầy đủ hoặc chưa có hiệu lực.",
    );
  if (findings.some((f) => f.citation_pending))
    warnings.push(
      "Có trích dẫn nguồn cần chuyên gia đối chiếu hoặc phê duyệt.",
    );
  if (classifications.some((c) => c.classification === "DISEASE_CLAIM"))
    warnings.push(
      "Phát hiện dấu hiệu tuyên bố liên quan bệnh lý; chuyển chuyên gia phân loại. Hệ thống không tự tạo phát hiện vi phạm pháp luật.",
    );
  if (classifications.some((c) => c.classification === "HEALTH_CLAIM"))
    warnings.push(
      "Phát hiện tuyên bố về sức khỏe; chuyển chuyên gia xác minh phạm vi và bằng chứng.",
    );
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
      `Tuyên bố trên nhãn cần chuyên gia phân loại: ${uncertain.map((c) => c.text).join("; ")}`,
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
      throw new Error("Phát hiện không thuộc cùng tổ chức.");
    if (!f.evidence.length) throw new Error("Phát hiện thiếu bằng chứng.");
    if (forbidden.test(f.title) || forbidden.test(f.suggested_action))
      throw new Error("Phát hiện có kết luận tuyệt đối bị cấm.");
    if (f.citation_ids.some((id) => !sources.some((s) => s.id === id)))
      throw new Error("Trích dẫn nguồn nằm ngoài danh mục nguồn.");
    for (const e of f.evidence) {
      if (
        e.bbox &&
        (e.bbox.some((x) => !Number.isFinite(x) || x < 0 || x > 1) ||
          e.bbox[2] <= e.bbox[0] ||
          e.bbox[3] <= e.bbox[1])
      )
        throw new Error("Tọa độ vùng bằng chứng không hợp lệ.");
    }
    if (
      ["critical", "major"].includes(f.severity) &&
      !f.citation_ids.length &&
      !f.citation_pending
    )
      throw new Error(
        "Phát hiện quan trọng thiếu trích dẫn nguồn hoặc chưa được chuyên viên xem xét.",
      );
    const key = `${f.rule_key}|${f.title}|${f.evidence.map((e) => e.text).join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
