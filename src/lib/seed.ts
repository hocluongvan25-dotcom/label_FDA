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
    status: "CURRENT" as const,
    content_excerpt: `BẢN MẪU MINH HỌA — ${s.citation}. Đây không phải bản chụp văn bản pháp lý; cần truy xuất và được chuyên gia Vexim phê duyệt trước khi dùng cho dữ liệu thật.`,
    content_hash: "d".repeat(64),
    retrieved_at: date(3),
    approved_by: "demo-regulatory",
    approved_at: date(2),
    updated_at: date(2),
  }));
  const rules = RULE_CATALOG.map((r) => ({
    ...r,
    status: "ACTIVE" as const,
    test_status: "passed" as const,
    approved_by: "demo-regulatory",
    created_by: "demo-author",
    effective_from: "2026-01-01",
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
    formula_confirmed: true,
    claims_confirmed: true,
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
      extracted_fields: sampleFields(files),
    };
    if ([1, 3, 7, 10, 11].includes(i))
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
      due_at: new Date(Date.now() + (i % 3) * 86400000).toISOString(),
      pipeline: [
        "validation",
        "ocr",
        "extraction",
        "rules",
        "verification",
      ].map((stage, j) => ({
        stage: stage as Review["pipeline"][number]["stage"],
        status: statuses === "PROCESSING" && j > 1 ? "pending" : "complete",
        attempts: 1,
        message: "Dữ liệu pipeline minh họa",
        completed_at: date(Math.floor(i / 3), 2),
      })),
      error_message: null,
      idempotency_key: `seed-${i}`,
      approved_by: statuses === "COMPLETED" ? DEMO_ACTOR.id : null,
      approved_at: statuses === "COMPLETED" ? date(Math.floor(i / 3), 1) : null,
      approval_comment:
        statuses === "COMPLETED"
          ? "Báo cáo mẫu đã được xác nhận để minh họa giao diện."
          : null,
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
      missing_information: [],
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
      add(
        "CLAIM-001",
        "Claim bệnh lý cần chuyên gia phân loại",
        "Dữ liệu mẫu minh họa tín hiệu cần chuyển chuyên gia. Đây không phải kết luận vi phạm pháp luật; không tự động yêu cầu sửa khi chưa có rà soát chuyên môn.",
        "information",
        "claim",
      );
      add(
        "NUTRITION-001",
        "Chưa phát hiện Nutrition Facts",
        "Nutrition Facts chưa được phát hiện. Khách hàng đề nghị low-volume exemption nhưng chưa có đánh giá của chuyên gia; không tự động kết luận đủ điều kiện miễn.",
        "major",
        "nutrition_facts",
      );
      add(
        "PARTY-001",
        "Thiếu địa chỉ đơn vị phân phối",
        "Đọc được “Distributed by AN NHIEN” nhưng chưa tìm được địa chỉ đơn vị chịu trách nhiệm trên information panel.",
        "major",
        "responsible_party",
      );
      add(
        "LABEL-001",
        "Hướng dẫn bảo quản cần xác minh",
        "Độ tin cậy đọc vùng hướng dẫn bảo quản là 69%. Đối chiếu file gốc hoặc yêu cầu bản nhãn rõ hơn.",
        "minor",
        "storage_instruction",
      );
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
        findings[4]?.id ?? "",
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
        "source.approved",
        "source",
        sources[0].id,
        "Dữ liệu mẫu: xác nhận nguồn 21 CFR 101.3",
        2,
        1,
      ],
      [
        "rule.approved",
        "rule",
        rules[0].id,
        "Dữ liệu mẫu: kích hoạt bộ 15 quy tắc v1",
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
