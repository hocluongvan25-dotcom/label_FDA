import type { ComplianceRule, RegulatorySource, Severity } from "./types";

const sourceId = (n: number) =>
  `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ruleId = (n: number) =>
  `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Registry metadata only. Production seeds are DRAFT, not legal approvals.
// Vexim must retrieve, hash, date-check and approve the actual source snapshot.
const sourceDefinitions = [
  [
    "ecfr-101-3",
    "eCFR",
    "FDA",
    "regulation",
    "21 CFR 101.3",
    "Statement of identity",
    "https://www.ecfr.gov/current/title-21/section-101.3",
    "identity",
    1,
  ],
  [
    "ecfr-101-7",
    "eCFR",
    "FDA",
    "regulation",
    "21 CFR 101.7",
    "Declaration of net quantity of contents",
    "https://www.ecfr.gov/current/title-21/section-101.7",
    "net_quantity",
    1,
  ],
  [
    "ecfr-101-4",
    "eCFR",
    "FDA",
    "regulation",
    "21 CFR 101.4",
    "Food; designation of ingredients",
    "https://www.ecfr.gov/current/title-21/section-101.4",
    "ingredients",
    1,
  ],
  [
    "ecfr-101-9",
    "eCFR",
    "FDA",
    "regulation",
    "21 CFR 101.9",
    "Nutrition labeling of food",
    "https://www.ecfr.gov/current/title-21/section-101.9",
    "nutrition_labeling",
    1,
  ],
  [
    "fda-allergens",
    "FDA",
    "FDA",
    "guidance",
    "FDA Food Allergen Labeling Guidance",
    "Questions and answers regarding food allergens",
    "https://www.fda.gov/food/food-allergensgluten-free-guidance-documents-regulatory-information/frequently-asked-questions-food-allergen-labeling-guidance-industry",
    "allergens",
    4,
  ],
  [
    "fda-label-claims",
    "FDA",
    "FDA",
    "guidance",
    "FDA Label Claims Guidance",
    "Label claims for conventional foods and dietary supplements",
    "https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/label-claims-conventional-foods-and-dietary-supplements",
    "claims",
    4,
  ],
  [
    "ecfr-101-13",
    "eCFR",
    "FDA",
    "regulation",
    "21 CFR 101.13",
    "Nutrient content claims — general principles",
    "https://www.ecfr.gov/current/title-21/section-101.13",
    "claims",
    1,
  ],
  [
    "ecfr-101-5",
    "eCFR",
    "FDA",
    "regulation",
    "21 CFR 101.5",
    "Name and place of business",
    "https://www.ecfr.gov/current/title-21/section-101.5",
    "responsible_party",
    1,
  ],
  [
    "ecfr-101-15",
    "eCFR",
    "FDA",
    "regulation",
    "21 CFR 101.15",
    "Prominence of required label statements",
    "https://www.ecfr.gov/current/title-21/section-101.15",
    "readability",
    1,
  ],
  [
    "fda-small-business",
    "FDA",
    "FDA",
    "guidance",
    "FDA Small Business Nutrition Labeling Exemption",
    "Small business nutrition labeling exemption",
    "https://www.fda.gov/food/labeling-nutrition-guidance-documents-regulatory-information/small-business-nutrition-labeling-exemption",
    "exemption",
    4,
  ],
  [
    "usda-organic",
    "eCFR",
    "USDA AMS",
    "regulation",
    "7 CFR Part 205",
    "National Organic Program",
    "https://www.ecfr.gov/current/title-7/subtitle-B/chapter-I/subchapter-M/part-205",
    "organic",
    1,
  ],
  [
    "fda-food-label-guide",
    "FDA",
    "FDA",
    "guidance",
    "FDA Food Labeling Guide",
    "A Food Labeling Guide",
    "https://www.fda.gov/files/food/published/Food-Labeling-Guide-%28PDF%29.pdf",
    "general",
    4,
  ],
] as const;
export const SOURCE_CATALOG: RegulatorySource[] = sourceDefinitions.map(
  (s, i) => ({
    id: sourceId(i + 1),
    source_key: s[0],
    authority: s[1],
    agency: s[2],
    document_type: s[3],
    citation: s[4],
    title: s[5],
    canonical_url: s[6],
    topic: s[7],
    priority: s[8],
    status: "DRAFT",
    retrieved_at: null,
    effective_from: null,
    effective_to: null,
    content_hash: null,
    content_excerpt: "",
    approved_by: null,
    approved_at: null,
    version: 1,
    updated_at: "2026-10-01T00:00:00.000Z",
  }),
);
interface RuleDefinition {
  key: string;
  name: string;
  type: string;
  severity: Severity;
  human: boolean;
  citations: number[];
  action: string;
}
const definitions: RuleDefinition[] = [
  {
    key: "IDENTITY-001",
    name: "Tên gọi thực phẩm trên nhãn",
    type: "field_presence",
    severity: "major",
    human: false,
    citations: [1],
    action:
      "Bổ sung hoặc xác minh statement of identity trên mặt chính của nhãn.",
  },
  {
    key: "NETQTY-001",
    name: "Khối lượng tịnh",
    type: "net_quantity",
    severity: "major",
    human: false,
    citations: [2],
    action:
      "Bổ sung khối lượng tịnh; chuyên viên đối chiếu cách thể hiện và các đơn vị đo.",
  },
  {
    key: "INGREDIENT-001",
    name: "Danh sách nguyên liệu",
    type: "field_presence",
    severity: "major",
    human: false,
    citations: [3],
    action:
      "Bổ sung ingredient list bằng tiếng Anh và xác nhận thứ tự khối lượng.",
  },
  {
    key: "NUTRITION-001",
    name: "Nutrition Facts và hồ sơ miễn ghi nhãn",
    type: "nutrition",
    severity: "major",
    human: true,
    citations: [4, 10],
    action:
      "Cung cấp Nutrition Facts hoặc hồ sơ để chuyên viên xác định điều kiện miễn; pre-check không phải kết luận miễn.",
  },
  {
    key: "NUTRITION-002",
    name: "Nutrition claim khi đề nghị exemption",
    type: "nutrition_claim_exemption",
    severity: "critical",
    human: true,
    citations: [4, 7, 10],
    action:
      "Không dựa vào exemption trước khi chuyên viên đánh giá ảnh hưởng của nutrition claim.",
  },
  {
    key: "ALLERGEN-001",
    name: "Khai báo các dị nguyên chính",
    type: "allergen",
    severity: "critical",
    human: true,
    citations: [5],
    action:
      "Đối chiếu công thức và nguồn dị nguyên; bổ sung khai báo sau khi chuyên viên xác nhận.",
  },
  {
    key: "ALLERGEN-002",
    name: "Khai báo sesame / mè / vừng",
    type: "sesame",
    severity: "critical",
    human: true,
    citations: [5],
    action:
      "Xác minh sesame trong công thức và khai báo bằng tên tiếng Anh phù hợp.",
  },
  {
    key: "CLAIM-001",
    name: "Claim bệnh lý hoặc điều trị",
    type: "disease_claim",
    severity: "information",
    human: true,
    citations: [6],
    action:
      "Chuyển chuyên gia phân loại claim; không kết luận vi phạm hoặc yêu cầu sửa chỉ từ tín hiệu từ khóa.",
  },
  {
    key: "CLAIM-002",
    name: "Claim hàm lượng dinh dưỡng",
    type: "nutrient_claim",
    severity: "major",
    human: true,
    citations: [7],
    action:
      "Cung cấp dữ liệu dinh dưỡng và căn cứ claim để chuyên viên đối chiếu tiêu chí áp dụng.",
  },
  {
    key: "CLAIM-003",
    name: "Claim natural, organic hoặc non-GMO",
    type: "certification_claim",
    severity: "major",
    human: true,
    citations: [6, 11],
    action:
      "Cung cấp chứng nhận hoặc hồ sơ chứng minh; không tự kết luận tính hợp lệ của organic certification.",
  },
  {
    key: "FORMULA-001",
    name: "Đối chiếu công thức với nhãn",
    type: "consistency",
    severity: "major",
    human: true,
    citations: [3],
    action:
      "Đối chiếu tên nguyên liệu, thành phần và thứ tự; xác nhận phiên bản công thức dùng cho nhãn.",
  },
  {
    key: "LABEL-001",
    name: "Độ đọc và độ tin cậy OCR",
    type: "readability",
    severity: "minor",
    human: false,
    citations: [9],
    action:
      "Tải file nhãn rõ hơn hoặc xác minh thủ công các vùng có độ tin cậy thấp.",
  },
  {
    key: "LABEL-002",
    name: "Thông tin bắt buộc bằng tiếng Anh",
    type: "language",
    severity: "major",
    human: true,
    citations: [9],
    action:
      "Bổ sung hoặc xác minh thông tin bắt buộc bằng tiếng Anh; kiểm tra bố cục bilingual.",
  },
  {
    key: "PARTY-001",
    name: "Tên, địa chỉ và vai trò đơn vị chịu trách nhiệm",
    type: "party",
    severity: "major",
    human: true,
    citations: [8],
    action:
      "Bổ sung tên, địa chỉ và quan hệ manufacturer / packer / distributor trên nhãn.",
  },
  {
    key: "CLASS-001",
    name: "Phân loại và phạm vi sản phẩm",
    type: "classification",
    severity: "critical",
    human: true,
    citations: [6, 12],
    action:
      "Chuyển chuyên gia xác định phân loại. Sản phẩm ngoài trà khô và trà túi lọc không được tự động kết luận.",
  },
];
export const RULE_CATALOG: ComplianceRule[] = definitions.map((d, i) => ({
  id: ruleId(i + 1),
  rule_key: d.key,
  name: d.name,
  version: 1,
  scope: ["dry_packaged_tea", "tea_bag"],
  condition_json: { type: d.type, ocr_threshold: 0.75 },
  action_json: {
    severity: d.severity,
    human_review: d.human,
    suggested_action: d.action,
  },
  source_citations: d.citations.map(sourceId),
  status: "DRAFT",
  effective_from: null,
  effective_to: null,
  created_by: "seed",
  approved_by: null,
  test_status: "pending",
  updated_at: "2026-10-01T00:00:00.000Z",
}));
