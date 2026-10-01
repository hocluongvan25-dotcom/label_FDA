import type { ReviewStatus, Role, Severity } from "./types";

export const DISCLAIMER =
  "Đây là đánh giá sơ bộ trong phạm vi nhãn thực phẩm liên bang Hoa Kỳ, dựa trên dữ liệu được cung cấp, phiên bản nguồn và quy tắc tại thời điểm rà soát. Báo cáo không phải phê duyệt hoặc chứng nhận của FDA, không bảo đảm thông quan và không thay thế tư vấn pháp lý. Kết luận phải được chuyên viên Vexim xác nhận.";
export const DISCLAIMER_EN =
  "This is a preliminary review within the stated US federal food-labeling scope, based on supplied information and the recorded source/rule versions. It is not FDA approval or certification, does not guarantee customs clearance, and is not a substitute for legal advice. A Vexim reviewer must confirm the report.";
export const DEMO_ACTOR = {
  id: "demo-reviewer",
  name: "Linh Nguyễn",
  email: "linh.nguyen@vexim.vn",
  role: "reviewer" as Role,
  organization_id: null,
};
export const STATUS_META: Record<
  ReviewStatus,
  { label: string; tone: string; short: string }
> = {
  DRAFT: { label: "Bản nháp", short: "Nháp", tone: "neutral" },
  INTAKE_PENDING: {
    label: "Chờ đủ hồ sơ",
    short: "Chờ hồ sơ",
    tone: "neutral",
  },
  INPUT_VALIDATION: {
    label: "Kiểm tra đầu vào",
    short: "Kiểm tra",
    tone: "blue",
  },
  PROCESSING: {
    label: "Đang phân tích",
    short: "Đang phân tích",
    tone: "blue",
  },
  AI_REVIEW_READY: {
    label: "Sẵn sàng rà soát",
    short: "Sẵn sàng",
    tone: "purple",
  },
  HUMAN_REVIEW: {
    label: "Chờ chuyên viên",
    short: "Đang rà soát",
    tone: "purple",
  },
  WAITING_FOR_CUSTOMER: {
    label: "Chờ khách bổ sung",
    short: "Chờ bổ sung",
    tone: "amber",
  },
  REVISION_REQUIRED: {
    label: "Cần chỉnh sửa",
    short: "Cần chỉnh sửa",
    tone: "orange",
  },
  APPROVED_WITH_NOTES: {
    label: "Báo cáo đã duyệt",
    short: "Đã duyệt báo cáo",
    tone: "green",
  },
  COMPLETED: { label: "Đã hoàn tất", short: "Hoàn tất", tone: "green" },
  ARCHIVED: { label: "Đã lưu trữ", short: "Lưu trữ", tone: "neutral" },
  PROCESSING_FAILED: {
    label: "Xử lý thất bại",
    short: "Lỗi xử lý",
    tone: "red",
  },
  SOURCE_UNAVAILABLE: {
    label: "Nguồn chưa sẵn sàng",
    short: "Thiếu nguồn",
    tone: "red",
  },
  MODEL_FAILED: { label: "Lỗi mô hình", short: "Lỗi mô hình", tone: "red" },
  MANUAL_ESCALATION_REQUIRED: {
    label: "Cần chuyên gia xử lý",
    short: "Cần chuyên gia",
    tone: "red",
  },
};
export const SEVERITY_META: Record<
  Severity,
  { label: string; color: string; order: number }
> = {
  critical: { label: "Nghiêm trọng", color: "red", order: 0 },
  major: { label: "Cần sửa", color: "orange", order: 1 },
  minor: { label: "Cần cải thiện", color: "amber", order: 2 },
  information: { label: "Thông tin", color: "blue", order: 3 },
};
export const ROLE_LABELS: Record<Role, string> = {
  customer_admin: "Quản trị khách hàng",
  customer_contributor: "Cộng tác viên khách hàng",
  reviewer: "Chuyên viên Vexim",
  regulatory_admin: "Quản trị pháp lý",
  system_admin: "Quản trị hệ thống",
};
export const CATEGORY_LABELS: Record<string, string> = {
  dry_packaged_tea: "Trà khô đóng gói",
  tea_bag: "Trà túi lọc",
  dietary_supplement: "Thực phẩm bổ sung",
  ready_to_drink: "Đồ uống pha sẵn",
  other: "Nhóm sản phẩm khác",
};
export const FORM_LABELS: Record<string, string> = {
  loose_leaf: "Trà lá rời",
  tea_bag: "Túi lọc",
  powder: "Dạng bột",
  liquid: "Dạng lỏng",
  other: "Khác",
};
export const CHANNEL_LABELS: Record<string, string> = {
  retail: "Bán lẻ",
  amazon: "Amazon",
  wholesale: "Bán buôn",
  food_service: "Food service",
  ecommerce: "Thương mại điện tử",
};
export const PIPELINE_LABELS = {
  validation: "Kiểm tra file",
  ocr: "Đọc nội dung nhãn",
  extraction: "Trích xuất thông tin",
  rules: "Kiểm tra quy tắc",
  verification: "Xác minh kết quả",
};
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_FILES = 20;
export const MAX_PDF_PAGES = 10;
export const ACCEPTED_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
];
export const FINDING_STATUS_LABELS = {
  open: "Chưa xử lý",
  accepted: "Đã xác nhận",
  dismissed: "Đã loại trừ",
};
export const RESULT_LABELS = {
  NEEDS_CORRECTION: "Cần chỉnh sửa",
  NO_ISSUE_DETECTED_IN_SCOPE: "Chưa phát hiện vấn đề trong phạm vi rà soát",
  INSUFFICIENT_INFORMATION: "Chưa đủ thông tin để kết luận",
};
