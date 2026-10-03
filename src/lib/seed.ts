import type {
  AppData,
  Evidence,
  ExtractedField,
  Finding,
  LabelFile,
  LabelVersion,
  Product,
  Report,
  Review,
  ReviewStatus,
  Severity,
} from "./types";
import { DEMO_ACTOR, DISCLAIMER, DISCLAIMER_EN } from "./constants";
import { RULE_CATALOG, SOURCE_CATALOG } from "./regulatory";
import {
  DEMO_REVIEW_CASE_REFERENCE,
  DEMO_REVIEW_ID,
  isSyntheticDemoReview,
} from "./demo-review";

const DRAFT_REVIEW_PROMPTS = [
  {
    sequence_no: 1,
    rule_key: "IDENTITY-001",
    task: "Independently check statement of identity placement and wording on the supplied artwork.",
    artwork_side: "front",
  },
  {
    sequence_no: 2,
    rule_key: "NETQTY-001",
    task: "Independently check net-quantity wording, units, and placement on the supplied artwork.",
    artwork_side: "front",
  },
  {
    sequence_no: 3,
    rule_key: "INGREDIENT-001",
    task: "Compare the ingredient statement on the artwork with the synthetic product formula.",
    artwork_side: "back",
  },
  {
    sequence_no: 4,
    rule_key: "NUTRITION-001",
    task: "Review the nutrition-labeling presentation and determine whether supporting documentation is needed.",
    artwork_side: "back",
  },
  {
    sequence_no: 5,
    rule_key: "NUTRITION-002",
    task: "Review the requested exemption against any nutrition-related claim and applicable DRAFT sources.",
    artwork_side: "front",
  },
  {
    sequence_no: 6,
    rule_key: "ALLERGEN-001",
    task: "Check the full formula and artwork for major-allergen information; do not infer an allergen result from this prompt.",
    artwork_side: "back",
  },
  {
    sequence_no: 7,
    rule_key: "ALLERGEN-002",
    task: "Independently verify sesame-related ingredients, controls, and any required declaration.",
    artwork_side: "back",
  },
  {
    sequence_no: 8,
    rule_key: "CLAIM-001",
    task: "Classify any disease-treatment wording only after expert review of the artwork and current authoritative sources.",
    artwork_side: "front",
  },
  {
    sequence_no: 9,
    rule_key: "CLAIM-002",
    task: "Check whether any nutrient-content claim is present and what substantiation would be required.",
    artwork_side: "front",
  },
  {
    sequence_no: 10,
    rule_key: "CLAIM-003",
    task: "Review any natural, organic, or non-GMO representation and request substantiation if applicable.",
    artwork_side: "front",
  },
  {
    sequence_no: 11,
    rule_key: "FORMULA-001",
    task: "Compare the customer-provided synthetic formula with the ingredient wording shown on the artwork.",
    artwork_side: "back",
  },
  {
    sequence_no: 12,
    rule_key: "LABEL-001",
    task: "Inspect artwork legibility and identify any regions that require a clearer production file.",
    artwork_side: "front",
  },
  {
    sequence_no: 13,
    rule_key: "LABEL-002",
    task: "Check required English-language information and bilingual layout independently.",
    artwork_side: "back",
  },
  {
    sequence_no: 14,
    rule_key: "PARTY-001",
    task: "Verify responsible-party name, address, and role against confirmed business records.",
    artwork_side: "back",
  },
  {
    sequence_no: 15,
    rule_key: "CLASS-001",
    task: "Confirm product classification and review scope with an expert before applying any rules.",
    artwork_side: "front",
  },
] as const;

const id = (prefix: string, n: number) =>
  `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const anchor = () => new Date();
function date(days: number, hours = 0) {
  const d = anchor();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d.toISOString();
}
const party = { name: "", address: "" };
export function createEmptyProduct(organizationId: string): Product {
  return {
    id: crypto.randomUUID(),
    organization_id: organizationId,
    name: "",
    brand: "",
    category: "dry_packaged_tea",
    form: "loose_leaf",
    market: "US",
    channel: ["retail"],
    expected_us_units_12m: null,
    employee_fte: null,
    classification_status: "conventional_food",
    formula: [],
    claims: [],
    package_size: "",
    net_quantity: "",
    manufacturer: { ...party },
    packer: { ...party },
    distributor: { ...party },
    importer: { ...party },
    certifications: [],
    exemption_requested: false,
    formula_confirmed: false,
    claims_confirmed: false,
    assigned_to: "",
    created_by: "",
    created_at: date(0),
    updated_at: date(0),
    color: "sage",
  };
}
export function sampleFields(files: LabelFile[]): ExtractedField[] {
  const front = files[0];
  const back = files[1] ?? front;
  const defs: [string, string | null, LabelFile, Evidence["bbox"], number][] = [
    [
      "statement_of_identity",
      "LOTUS GREEN TEA",
      front,
      [0.18, 0.24, 0.82, 0.37],
      0.99,
    ],
    [
      "net_quantity",
      "NET WT 1.41 OZ (40 g)",
      front,
      [0.23, 0.9, 0.78, 0.94],
      0.98,
    ],
    [
      "ingredient_list",
      "Ingredients: Green tea leaves, lotus flower",
      back,
      [0.1, 0.38, 0.83, 0.46],
      0.97,
    ],
    ["nutrition_facts", null, back, null, 0],
    [
      "responsible_party",
      "Distributed by AN NHIEN",
      back,
      [0.1, 0.76, 0.76, 0.8],
      0.96,
    ],
    [
      "claim",
      "Naturally helps prevent diabetes",
      front,
      [0.16, 0.79, 0.84, 0.85],
      0.98,
    ],
    [
      "storage_instruction",
      "Store in a cool, dry place. Keep away from sunlight.",
      back,
      [0.1, 0.71, 0.9, 0.74],
      0.69,
    ],
    [
      "country_of_origin",
      "Product of Vietnam",
      back,
      [0.1, 0.81, 0.6, 0.84],
      0.97,
    ],
    ["english_required_information", "detected", front, null, 0.98],
  ];
  return defs.map(([field, value, file, bbox, confidence], i) => ({
    id: id("e", i + 1),
    field,
    value,
    confidence,
    evidence: {
      file_id: file.id,
      page: 1,
      bbox,
      text: value ?? "Không phát hiện Nutrition Facts trên các panel đã đọc.",
      kind: value ? "observed" : "absence",
    },
    extraction_model: "demo-fixture · không phải kết quả OCR thực",
    extracted_at: date(0, 2),
  }));
}
export function createSeedData(): AppData {
  const orgDefs = [
    ["An Nhiên Tea", "Minh Anh", "contact@annhientea.example"],
    ["Mộc Trà Việt", "Hoàng Nam", "export@moctraviet.example"],
    ["Hương Việt Foods", "Thu Hà", "info@huongvietfoods.example"],
    ["Dalat Botanica", "Thanh Mai", "hello@dalatbotanica.example"],
  ];
  const organizations = orgDefs.map((o, i) => ({
    id: id("a", i + 1),
    name: o[0],
    contact_name: o[1],
    contact_email: o[2],
    country: "VN",
    status: "active" as const,
    created_at: date(30 + i * 4),
  }));
  const sources = SOURCE_CATALOG.map((s) => ({
    ...s,
    status: "DRAFT" as const,
    content_excerpt: `BẢN MẪU MINH HỌA — ${s.citation}. Metadata này chưa được xác minh hoặc phê duyệt; cần chuyên gia rà soát độc lập trước khi dùng.`,
    content_hash: null,
    retrieved_at: null,
    approved_by: null,
    approved_at: null,
    updated_at: date(2),
  }));
  const rules = RULE_CATALOG.map((r) => ({
    ...r,
    status: "DRAFT" as const,
    test_status: "pending" as const,
    approved_by: null,
    created_by: "demo-author",
    effective_from: null,
    updated_at: date(2),
    source_snapshot: r.source_citations
      .map((id) => sources.find((s) => s.id === id)!)
      .map((s) => ({
        id: s.id,
        version: s.version,
        content_hash: s.content_hash,
      })),
  }));
  const productDefs: [string, string, number, ReviewStatus, string][] = [
    ["Trà sen túi lọc", "AN NHIÊN", 0, "HUMAN_REVIEW", "sage"],
    ["Trà lài cao cấp", "MỘC TRÀ", 1, "REVISION_REQUIRED", "cream"],
    ["Trà xanh Shan Tuyết", "HƯƠNG VIỆT", 2, "PROCESSING", "mint"],
    ["Trà ô long Đà Lạt", "DALAT BOTANICA", 3, "COMPLETED", "sand"],
    ["Trà gừng thảo mộc", "AN NHIÊN", 0, "WAITING_FOR_CUSTOMER", "peach"],
    ["Trà đen truyền thống", "MỘC TRÀ", 1, "HUMAN_REVIEW", "mauve"],
    ["Trà xanh hữu cơ", "HƯƠNG VIỆT", 2, "HUMAN_REVIEW", "sage"],
    ["Trà hoa cúc", "DALAT BOTANICA", 3, "COMPLETED", "cream"],
    ["Bột trà matcha", "AN NHIÊN", 0, "DRAFT", "mint"],
    ["Trà mè rang", "HƯƠNG VIỆT", 2, "MANUAL_ESCALATION_REQUIRED", "sand"],
    ["Trà lài túi lọc", "MỘC TRÀ", 1, "REVISION_REQUIRED", "peach"],
    ["Trà xanh xuất khẩu", "DALAT BOTANICA", 3, "COMPLETED", "sage"],
  ];
  const products: Product[] = productDefs.map((p, i) => ({
    id: id("d", i + 1),
    organization_id: organizations[p[2]].id,
    name: p[0],
    brand: p[1],
    category: i === 0 || i === 10 ? "tea_bag" : "dry_packaged_tea",
    form: i === 0 || i === 10 ? "tea_bag" : i === 8 ? "powder" : "loose_leaf",
    market: "US",
    channel: i % 2 ? ["retail"] : ["retail", "amazon"],
    expected_us_units_12m: 10000 + i * 1000,
    employee_fte: 20,
    classification_status: "conventional_food",
    formula: [
      {
        id: id("f", i * 2 + 1),
        name_original: "Trà xanh",
        name_english: "Green tea leaves",
        normalized_name: "green_tea_leaves",
        percentage: i === 9 ? 90 : 96,
        order: 1,
        allergen_groups: [],
        source: "customer_input",
      },
      {
        id: id("f", i * 2 + 2),
        name_original: i === 9 ? "Mè rang" : "Hoa sen",
        name_english: i === 9 ? "Sesame seeds" : "Lotus flower",
        normalized_name: i === 9 ? "sesame" : "lotus_flower",
        percentage: i === 9 ? 10 : 4,
        order: 2,
        allergen_groups: i === 9 ? ["sesame"] : [],
        source: "customer_input",
      },
    ],
    claims:
      i === 0
        ? ["Naturally helps prevent diabetes"]
        : i === 6
          ? ["Organic green tea"]
          : [],
    package_size: i === 0 ? "20 túi × 2 g" : "Hộp 100 g",
    net_quantity: i === 0 ? "1.41 oz (40 g)" : "3.53 oz (100 g)",
    manufacturer: {
      name: organizations[p[2]].name,
      address: "Hà Nội, Việt Nam (dữ liệu mẫu)",
    },
    packer: { ...party },
    distributor: { ...party },
    importer: { ...party },
    certifications: [],
    exemption_requested: true,
    formula_confirmed: i !== 0,
    claims_confirmed: i !== 0,
    assigned_to: DEMO_ACTOR.id,
    created_by: "demo-customer",
    created_at: date(i + 5),
    updated_at: date(Math.floor(i / 3), (i % 3) + 1),
    color: p[4],
  }));
  const labelVersions: LabelVersion[] = [];
  const reviews: Review[] = [];
  const findings: Finding[] = [];
  products.forEach((p, i) => {
    const statuses = productDefs[i][3];
    if (statuses === "DRAFT") return;
    const files: LabelFile[] = [
      {
        id: id("1", i * 2 + 1),
        name: `${i === 0 ? "lotus" : "tea"}-front-v2.svg`,
        mime_type: "image/svg+xml",
        size: 248832,
        storage_path: "demo/front",
        sha256: "DEMO_FIXTURE",
        page_count: 1,
        scan_status: "dev_unscanned",
        kind: "original",
        preview_url:
          i === 1 || i === 10
            ? "/samples/jasmine-front.svg"
            : i === 3
              ? "/samples/oolong-front.svg"
              : "/samples/lotus-front-v2.svg",
      },
      {
        id: id("1", i * 2 + 2),
        name: "tea-back-v2.svg",
        mime_type: "image/svg+xml",
        size: 189120,
        storage_path: "demo/back",
        sha256: "DEMO_FIXTURE",
        page_count: 1,
        scan_status: "dev_unscanned",
        kind: "original",
        preview_url: "/samples/lotus-back-v2.svg",
      },
    ];
    if (i === 0) {
      Object.assign(files[0], {
        name: "lotus-front-v2.svg",
        size: 3130,
        storage_path: "demo-static/lotus-front-v2.svg",
        sha256:
          "f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177",
        preview_url: "/samples/lotus-front-v2.svg",
      });
      Object.assign(files[1], {
        name: "lotus-back-v2.svg",
        size: 2253,
        storage_path: "demo-static/lotus-back-v2.svg",
        sha256:
          "ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02",
        preview_url: "/samples/lotus-back-v2.svg",
      });
    }
    const version: LabelVersion = {
      id: id("2", i + 1),
      organization_id: p.organization_id,
      product_id: p.id,
      version: i === 0 ? 2 : i === 1 ? 3 : 1,
      original_files: files,
      normalized_files: [],
      status:
        statuses === "COMPLETED"
          ? "reviewed"
          : statuses === "PROCESSING"
            ? "processing"
            : "under_review",
      uploaded_by: "demo-customer",
      uploaded_at: date(Math.floor(i / 3), 3),
      extracted_fields: i === 0 ? [] : sampleFields(files),
    };
    if (i !== 0 && [1, 3, 7, 10, 11].includes(i))
      version.extracted_fields = version.extracted_fields.filter(
        (f) => f.field !== "claim",
      );
    labelVersions.push(version);
    const review: Review = {
      id: id("3", i + 1),
      organization_id: p.organization_id,
      product_id: p.id,
      label_version_id: version.id,
      review_scope: "us_federal_food_labeling_mvp",
      status: statuses,
      progress: statuses === "PROCESSING" ? 65 : 100,
      assigned_to: DEMO_ACTOR.id,
      created_at: date(Math.floor(i / 3), 3),
      updated_at: p.updated_at,
      due_at:
        i === 0
          ? new Date(Date.now() + 14 * 86400000).toISOString()
          : new Date(Date.now() + (i % 3) * 86400000).toISOString(),
      pipeline:
        i === 0
          ? []
          : [
              "validation",
              "ocr",
              "extraction",
              "rules",
              "verification",
            ].map((stage, j) => ({
              stage: stage as Review["pipeline"][number]["stage"],
              status:
                statuses === "PROCESSING" && j > 1 ? "pending" : "complete",
              attempts: 1,
              message: "Dữ liệu pipeline minh họa",
              completed_at: date(Math.floor(i / 3), 2),
            })),
      error_message: null,
      idempotency_key:
        i === 0 ? DEMO_REVIEW_CASE_REFERENCE : `seed-${i}`,
      approved_by: statuses === "COMPLETED" ? DEMO_ACTOR.id : null,
      approved_at: statuses === "COMPLETED" ? date(Math.floor(i / 3), 1) : null,
      approval_comment:
        statuses === "COMPLETED"
          ? "Báo cáo mẫu đã được xác nhận để minh họa giao diện."
          : null,
      ...(i === 0
        ? {
            triage_route: "EXPERT_REVIEW_REQUIRED" as const,
            overall_result: "NOT_ASSESSED" as const,
            report_status: "NOT_ISSUED" as const,
            expert_review_status: "PENDING" as const,
            triage_reasons: [],
            triage_risk_score: 0,
            triage_evaluated_at: null,
          }
        : {}),
      dossier_snapshot: structuredClone(p),
      rule_snapshot: rules.map((rule) => ({
        rule_key: rule.rule_key,
        version: rule.version,
        source_versions: rule.source_citations
          .map((id) => sources.find((s) => s.id === id)!)
          .map((s) => ({
            id: s.id,
            version: s.version,
            content_hash: s.content_hash,
          })),
      })),
      missing_information:
        i === 0
          ? [
              "DEMO ONLY: synthetic fixture; no OCR job or legal determination was run.",
              "Independently review all 15 DRAFT tea rules and their DRAFT source metadata before recording any disposition.",
              "Confirm the formula, claims, artwork text, product classification, and any requested nutrition-labeling exemption with an expert.",
            ]
          : [],
    };
    reviews.push(review);
    const add = (
      key: string,
      title: string,
      description: string,
      severity: Severity,
      fieldKey: string,
      accepted = false,
    ) => {
      const rule = rules.find((r) => r.rule_key === key)!;
      const field = version.extracted_fields.find((f) => f.field === fieldKey);
      findings.push({
        id: id("4", findings.length + 1),
        review_id: review.id,
        organization_id: p.organization_id,
        rule_key: key,
        rule_version: 1,
        title,
        description,
        severity,
        status: accepted ? "accepted" : "open",
        evidence: field
          ? [field.evidence]
          : [
              {
                file_id: files[1].id,
                page: 1,
                bbox: null,
                text: "Không phát hiện nội dung trong panel đã đọc.",
                kind: "absence",
              },
            ],
        citation_ids: rule.source_citations,
        citation_pending: false,
        suggested_action: rule.action_json.suggested_action,
        ai_confidence: key === "LABEL-001" ? 0.69 : 0.96,
        reasoning_category: key.startsWith("CLAIM")
          ? "claim"
          : key.startsWith("ALLERGEN")
            ? "allergen"
            : "field_presence",
        human_review_required: true,
        reviewer_comment: accepted
          ? "Đã đối chiếu nhãn mẫu. Cần khách hàng cập nhật bản thiết kế."
          : null,
        reviewed_by: accepted ? DEMO_ACTOR.id : null,
        reviewed_at: accepted ? date(0, 1) : null,
        created_at: review.created_at,
      });
    };
    if (i === 0) {
      for (const prompt of DRAFT_REVIEW_PROMPTS) {
        const rule = rules.find((r) => r.rule_key === prompt.rule_key)!;
        const file = prompt.artwork_side === "front" ? files[0] : files[1];
        findings.push({
          id: id("4", 1000 + prompt.sequence_no),
          review_id: review.id,
          organization_id: p.organization_id,
          rule_key: rule.rule_key,
          rule_version: rule.version,
          severity: rule.action_json.severity,
          status: "open",
          title: `[DEMO · DRAFT] ${rule.name}`,
          description: `${prompt.task} This is a synthetic expert-review prompt, not a legal finding. The rule and citations remain DRAFT; no OCR result or compliance conclusion is asserted.`,
          evidence: [
            {
              file_id: file.id,
              page: 1,
              bbox: null,
              text: `[DEMO FIXTURE] ${prompt.task} No OCR was run; inspect the linked static sample artwork during independent review.`,
              kind: "dossier",
            },
          ],
          citation_ids: rule.source_citations,
          citation_pending: true,
          suggested_action: `DRAFT RULE PROMPT — not approved for use: ${rule.action_json.suggested_action}`,
          ai_confidence: null,
          reasoning_category: (rule.condition_json.type ??
            "manual") as Finding["reasoning_category"],
          human_review_required: true,
          reviewer_comment: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: review.created_at,
        });
      }
    } else if ([1, 5, 10].includes(i)) {
      add(
        "NUTRITION-001",
        "Nutrition Facts cần bổ sung hoặc xác minh exemption",
        "Chưa có Nutrition Facts hoặc hồ sơ đủ để chuyên gia xác định điều kiện miễn.",
        "major",
        "nutrition_facts",
        [1, 10].includes(i),
      );
      add(
        "PARTY-001",
        "Cần bổ sung địa chỉ đơn vị chịu trách nhiệm",
        "Tên đơn vị đã được phát hiện nhưng chưa đọc được địa chỉ đầy đủ.",
        "major",
        "responsible_party",
        i === 1,
      );
    } else if (i === 6) {
      add(
        "CLAIM-003",
        "Organic claim chưa có hồ sơ chứng nhận",
        "Claim organic đã được khai báo trong hồ sơ. Cần bổ sung organic certificate và chuyển chuyên gia; hệ thống không kết luận chứng nhận.",
        "critical",
        "claim",
      );
    } else if (i === 9) {
      add(
        "ALLERGEN-002",
        "Sesame trong công thức chưa thấy trên nhãn",
        "Công thức khai báo 10% sesame seeds. Danh sách trên nhãn mẫu chỉ gồm green tea leaves và lotus flower; cần đối chiếu ngay.",
        "critical",
        "ingredient_list",
      );
      add(
        "FORMULA-001",
        "Công thức và ingredient list chưa khớp",
        "Nguyên liệu sesame seeds trong hồ sơ chưa được tìm thấy trên nhãn đã đọc.",
        "major",
        "ingredient_list",
      );
    }
  });
  const p = products[0];
  labelVersions.push({
    ...labelVersions[0],
    id: id("2", 99),
    version: 1,
    uploaded_at: date(7),
    status: "reviewed",
    original_files: labelVersions[0].original_files.map((f, i) => ({
      ...f,
      id: id("1", 99 + i),
      name: f.name.replace("v2", "v1"),
      preview_url: i
        ? "/samples/lotus-back-v1.svg"
        : "/samples/lotus-front-v1.svg",
    })),
    extracted_fields: [],
  });
  const reports: Report[] = reviews
    .filter((r) => r.status === "COMPLETED")
    .map((r, i) => {
      const product = products.find((p) => p.id === r.product_id)!;
      const label = labelVersions.find((v) => v.id === r.label_version_id)!;
      return {
        id: id("5", i + 1),
        review_id: r.id,
        organization_id: product.organization_id,
        product_id: product.id,
        label_version_id: label.id,
        report_number: `VLR-2026-${String(i + 1).padStart(4, "0")}`,
        created_at: r.approved_at!,
        pdf_path: null,
        json_path: null,
        snapshot: {
          schema_version: "1.1",
          review_id: r.id,
          product: structuredClone(product),
          label_version: structuredClone(label),
          review_scope: r.review_scope,
          disposition: "NO_ISSUE_DETECTED_IN_SCOPE",
          approved_by: DEMO_ACTOR.id,
          rationale: r.approval_comment!,
          result: "NO_ISSUE_DETECTED_IN_SCOPE",
          disclaimer: `${DISCLAIMER}\n\n${DISCLAIMER_EN}`,
          findings: [],
          sources: [],
          reviewer: {
            id: DEMO_ACTOR.id,
            name: DEMO_ACTOR.name,
            approved_at: r.approved_at!,
            comment: r.approval_comment!,
          },
          version_history: [
            { version: label.version, uploaded_at: label.uploaded_at },
          ],
          generated_at: r.approved_at!,
          demo: true,
        },
      };
    });
  return {
    staff: [
      {
        id: DEMO_ACTOR.id,
        name: DEMO_ACTOR.name,
        role: "reviewer",
        active: true,
      },
    ],
    organizations,
    products,
    labelVersions,
    reviews,
    findings,
    sources,
    rules,
    reports,
    members: organizations.map((o, i) => ({
      id: id("6", i + 1),
      organization_id: o.id,
      name: o.contact_name,
      email: o.contact_email,
      role: "customer_admin",
      status: "active",
    })),
    requests: [
      {
        id: id("7", 1),
        review_id: reviews.find((r) => r.product_id === products[4].id)!.id,
        organization_id: organizations[0].id,
        message:
          "Vui lòng bổ sung công thức chi tiết và hồ sơ claim của trà gừng để chuyên viên tiếp tục rà soát.",
        requested_documents: ["Công thức xác nhận", "Claim substantiation"],
        status: "open",
        created_by: DEMO_ACTOR.id,
        created_at: date(1),
      },
    ],
    audit: [
      [
        "review.started",
        "review",
        reviews[0].id,
        "Bắt đầu rà soát Trà sen túi lọc · nhãn v2",
        0,
        2,
      ],
      [
        "label.uploaded",
        "label_version",
        labelVersions[0].id,
        "Khách hàng tải lên nhãn v2 · 2 file",
        0,
        3,
      ],
      [
        "finding.updated",
        "finding",
        findings.find(
          (finding) =>
            finding.review_id === reviews[1].id &&
            finding.rule_key === "NUTRITION-001",
        )?.id ?? "",
        "Xác nhận finding Nutrition Facts · Trà lài cao cấp",
        0,
        4,
      ],
      [
        "report.approved",
        "report",
        reports[0].id,
        "Phê duyệt báo cáo mẫu · Trà ô long Đà Lạt",
        1,
        1,
      ],
      [
        "information.requested",
        "review",
        reviews[4].id,
        "Yêu cầu bổ sung công thức · Trà gừng thảo mộc",
        1,
        3,
      ],
      [
        "source.draft",
        "source",
        sources[0].id,
        "Metadata nguồn 21 CFR 101.3 ở trạng thái DRAFT, chờ chuyên gia xác minh.",
        2,
        1,
      ],
      [
        "rule.draft",
        "rule",
        rules[0].id,
        "Rule Pack 15 quy tắc ở DRAFT, chờ chuyên gia rà soát độc lập.",
        2,
        2,
      ],
      ["product.created", "product", p.id, "Tạo hồ sơ Trà sen túi lọc", 7, 1],
    ].map((a, i) => ({
      id: id("8", i + 1),
      organization_id:
        String(a[1]) === "source" || String(a[1]) === "rule"
          ? null
          : p.organization_id,
      actor_id: DEMO_ACTOR.id,
      actor_name:
        String(a[0]) === "label.uploaded" ? "Minh Anh" : DEMO_ACTOR.name,
      action: String(a[0]),
      entity_type: String(a[1]),
      entity_id: String(a[2]),
      description: String(a[3]),
      metadata: { demo: true },
      created_at: date(Number(a[4]), Number(a[5])),
    })),
  };
}

/** Refresh only the reserved local tea-review fixture, preserving other demo workspace records. */
export function refreshDraftOnlyDemoFixture(
  data: AppData,
  seeded: AppData,
): AppData {
  const fixtureReview = seeded.reviews.find(
    (review) => review.id === DEMO_REVIEW_ID,
  );
  const previousReview = data.reviews.find(
    (review) => review.id === DEMO_REVIEW_ID,
  );
  const fixtureProduct = seeded.products.find(
    (product) => product.id === fixtureReview?.product_id,
  );
  const fixtureLabel = seeded.labelVersions.find(
    (label) => label.id === fixtureReview?.label_version_id,
  );
  if (
    !fixtureReview ||
    !previousReview ||
    !isSyntheticDemoReview(previousReview) ||
    !fixtureProduct ||
    !fixtureLabel
  )
    return data;

  const fixtureFindings = seeded.findings.filter(
    (finding) => finding.review_id === DEMO_REVIEW_ID,
  );
  const previousFindings = data.findings.filter(
    (finding) => finding.review_id === DEMO_REVIEW_ID,
  );
  const previousReports = data.reports.filter(
    (report) => report.review_id === DEMO_REVIEW_ID,
  );
  const previousPreScreeningReports = (data.preScreeningReports ?? []).filter(
    (report) => report.review_id === DEMO_REVIEW_ID,
  );
  const ruleKeys = new Set(seeded.rules.map((rule) => rule.rule_key));
  const fixtureRuleIds = new Set(seeded.rules.map((rule) => rule.id));
  const sourceIds = new Set(
    seeded.rules.flatMap((rule) => rule.source_citations),
  );
  const replaceById = <T extends { id: string }>(
    values: T[],
    replacement: T,
  ): T[] => {
    let replaced = false;
    const next = values.map((value) => {
      if (value.id !== replacement.id) return value;
      replaced = true;
      return replacement;
    });
    return replaced ? next : [...next, replacement];
  };
  const fixtureAudit = seeded.audit.filter((entry) =>
    (entry.entity_type === "review" && entry.entity_id === DEMO_REVIEW_ID) ||
    (entry.entity_type === "product" && entry.entity_id === fixtureProduct.id) ||
    (entry.entity_type === "label_version" && entry.entity_id === fixtureLabel.id) ||
    (entry.entity_type === "source" &&
      sourceIds.has(entry.entity_id) &&
      entry.action === "source.draft") ||
    (entry.entity_type === "rule" &&
      fixtureRuleIds.has(entry.entity_id) &&
      entry.action === "rule.draft"),
  );
  const retiredAuditIds = new Set([
    DEMO_REVIEW_ID,
    fixtureProduct.id,
    previousReview.product_id,
    fixtureLabel.id,
    previousReview.label_version_id,
    ...fixtureFindings.map((finding) => finding.id),
    ...previousFindings.map((finding) => finding.id),
    ...previousReports.map((report) => report.id),
    ...previousPreScreeningReports.map((report) => report.id),
    ...fixtureLabel.original_files.map((file) => file.id),
    ...(data.labelVersions.find(
      (label) => label.id === previousReview.label_version_id,
    )?.original_files.map((file) => file.id) ?? []),
  ]);

  return {
    ...data,
    products: replaceById(data.products, fixtureProduct),
    labelVersions: replaceById(data.labelVersions, fixtureLabel),
    reviews: replaceById(data.reviews, fixtureReview),
    findings: [
      ...fixtureFindings,
      ...data.findings.filter((finding) => finding.review_id !== DEMO_REVIEW_ID),
    ],
    rules: [
      ...data.rules.filter((rule) => !ruleKeys.has(rule.rule_key)),
      ...seeded.rules,
    ],
    sources: [
      ...data.sources.filter((source) => !sourceIds.has(source.id)),
      ...seeded.sources.filter((source) => sourceIds.has(source.id)),
    ],
    requests: data.requests.filter(
      (request) => request.review_id !== DEMO_REVIEW_ID,
    ),
    reports: data.reports.filter(
      (report) => report.review_id !== DEMO_REVIEW_ID,
    ),
    ...(data.preScreeningReports
      ? {
          preScreeningReports: data.preScreeningReports.filter(
            (report) => report.review_id !== DEMO_REVIEW_ID,
          ),
        }
      : {}),
    audit: [
      ...data.audit.filter((entry) => {
        if (retiredAuditIds.has(entry.entity_id)) return false;
        const isOldSeedSourceApproval =
          entry.entity_type === "source" &&
          sourceIds.has(entry.entity_id) &&
          entry.action === "source.approved" &&
          entry.description.startsWith("Dữ liệu mẫu:");
        const isOldSeedRuleApproval =
          entry.entity_type === "rule" &&
          fixtureRuleIds.has(entry.entity_id) &&
          entry.action === "rule.approved" &&
          entry.description.startsWith("Dữ liệu mẫu:");
        const isFixtureDraftStatus =
          (entry.entity_type === "source" &&
            sourceIds.has(entry.entity_id) &&
            entry.action === "source.draft" &&
            entry.description.startsWith("Metadata nguồn 21 CFR 101.3")) ||
          (entry.entity_type === "rule" &&
            fixtureRuleIds.has(entry.entity_id) &&
            entry.action === "rule.draft" &&
            entry.description.startsWith("Rule Pack 15 quy tắc"));
        return !(
          isOldSeedSourceApproval ||
          isOldSeedRuleApproval ||
          isFixtureDraftStatus
        );
      }),
      ...fixtureAudit,
    ].sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}
