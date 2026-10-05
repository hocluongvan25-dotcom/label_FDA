import { z } from "zod";
import type { Product } from "./types";

export const partySchema = z.object({
  name: z.string().max(300),
  address: z.string().max(1500),
});
export const ingredientSchema = z.object({
  id: z.string(),
  name_original: z.string().trim().min(1, "Nhập tên nguyên liệu."),
  name_english: z
    .string()
    .trim()
    .min(1, "Nhập tên nguyên liệu bằng tiếng Anh."),
  normalized_name: z.string(),
  percentage: z.number().min(0).max(100).nullable(),
  order: z.number().int().positive(),
  allergen_groups: z.array(z.string()),
  source: z.literal("customer_input"),
});
export const productInputSchema = z
  .object({
    organization_id: z.string().min(1),
    name: z
      .string()
      .trim()
      .min(2, "Tên sản phẩm cần ít nhất 2 ký tự.")
      .max(300),
    brand: z.string().trim().min(1, "Nhập thương hiệu.").max(150),
    category: z.enum([
      "dry_packaged_tea",
      "tea_bag",
      "dietary_supplement",
      "ready_to_drink",
      "other",
    ]),
    form: z.enum(["loose_leaf", "tea_bag", "powder", "liquid", "other"]),
    market: z.literal("US"),
    channel: z.array(z.string()).min(1, "Chọn ít nhất một kênh bán hàng."),
    expected_us_units_12m: z.number().int().nonnegative().nullable(),
    employee_fte: z.number().nonnegative().nullable(),
    formula: z.array(ingredientSchema).min(1, "Thêm ít nhất một nguyên liệu."),
    claims: z.array(z.string().max(1500)),
    package_size: z.string().trim().min(1, "Nhập quy cách đóng gói."),
    net_quantity: z.string().trim().min(1, "Nhập khối lượng tịnh."),
    manufacturer: partySchema,
    packer: partySchema,
    distributor: partySchema,
    importer: partySchema,
    certifications: z.array(z.string()),
    exemption_requested: z.boolean(),
    formula_confirmed: z.boolean(),
    claims_confirmed: z.boolean(),
  })
  .superRefine((p, ctx) => {
    if (!p.manufacturer.name.trim())
      ctx.addIssue({
        code: "custom",
        path: ["manufacturer", "name"],
        message: "Nhập tên nhà sản xuất.",
      });
    if (!p.manufacturer.address.trim())
      ctx.addIssue({
        code: "custom",
        path: ["manufacturer", "address"],
        message: "Nhập địa chỉ nhà sản xuất.",
      });
    if (p.expected_us_units_12m === null)
      ctx.addIssue({
        code: "custom",
        path: ["expected_us_units_12m"],
        message: "Nhập sản lượng dự kiến tại Hoa Kỳ.",
      });
    if (p.exemption_requested && p.employee_fte === null)
      ctx.addIssue({
        code: "custom",
        path: ["employee_fte"],
        message: "Cần số FTE khi yêu cầu pre-check exemption.",
      });
    const percentages = p.formula.map((x) => x.percentage);
    if (
      percentages.every((x) => x !== null) &&
      Math.abs(percentages.reduce<number>((s, x) => s + (x ?? 0), 0) - 100) >
        0.01
    )
      ctx.addIssue({
        code: "custom",
        path: ["formula"],
        message:
          "Tổng tỷ lệ nguyên liệu phải bằng 100%, hoặc bỏ tỷ lệ và xác nhận thứ tự khối lượng.",
      });
    if (!p.formula_confirmed)
      ctx.addIssue({
        code: "custom",
        path: ["formula_confirmed"],
        message: "Xác nhận công thức và thứ tự khối lượng.",
      });
    if (!p.claims_confirmed)
      ctx.addIssue({
        code: "custom",
        path: ["claims_confirmed"],
        message: "Xác nhận các claim dự kiến.",
      });
  });
const UUID = z.string().uuid();

/**
 * Accepted shapes only: `YYYY-MM-DD`, optional `THH:mm[:ss[.sss]]` and optional
 * `Z` / `±HH:mm`. Slash or locale formats are rejected instead of being guessed,
 * because 05/10/2026 means a different day in different conventions.
 */
const isoMomentShape =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** Accepts `YYYY-MM-DD`, `...THH:mm`, offsets or `Z`; returns canonical UTC ISO. */
function toUtcIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !isoMomentShape.test(trimmed)) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const date = new Date(dateOnly ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
export function normalizeMoment(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return toUtcIso(value) ?? value;
}
const utcIso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MOMENT_MESSAGE =
  "Không đọc được thời điểm này. Dùng YYYY-MM-DD hoặc ISO 8601 (…Z hoặc +HH:mm).";
const DATE_MESSAGE = "Ngày phải có dạng YYYY-MM-DD.";

/**
 * Manual regulatory-source registration. Shared by the browser and the API so a
 * rejection can name the exact field instead of failing with a generic message.
 */
export const regulatorySourceInputSchema = z.object({
  id: UUID,
  source_key: z
    .string({ message: "Thiếu source key." })
    .trim()
    .min(2, "Source key cần ít nhất 2 ký tự.")
    .max(200, "Source key tối đa 200 ký tự."),
  authority: z
    .string({ message: "Thiếu authority." })
    .trim()
    .min(1, "Cần cơ quan ban hành (authority).")
    .max(50, "Authority tối đa 50 ký tự."),
  agency: z
    .string({ message: "Thiếu agency." })
    .trim()
    .min(1, "Cần agency.")
    .max(100, "Agency tối đa 100 ký tự."),
  document_type: z.enum(
    ["regulation", "statute", "amendment", "guidance", "faq", "secondary"],
    { message: "Loại tài liệu không nằm trong danh mục cho phép." },
  ),
  citation: z
    .string({ message: "Thiếu citation." })
    .trim()
    .min(2, "Citation cần ít nhất 2 ký tự.")
    .max(200, "Citation tối đa 200 ký tự."),
  title: z
    .string({ message: "Thiếu tên tài liệu." })
    .trim()
    .min(2, "Tên tài liệu cần ít nhất 2 ký tự.")
    .max(2000, "Tên tài liệu tối đa 2000 ký tự."),
  canonical_url: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z
      .string({ message: "Thiếu URL chính thức." })
      .min(1, "Thiếu URL chính thức.")
      .refine((v) => {
        try {
          return new URL(v).protocol === "https:";
        } catch {
          return false;
        }
      }, "URL chính thức phải là một đường dẫn HTTPS hợp lệ."),
  ),
  topic: z
    .string({ message: "Thiếu chủ đề." })
    .trim()
    .min(1, "Cần chọn chủ đề.")
    .max(100, "Chủ đề tối đa 100 ký tự."),
  priority: z.coerce
    .number({ message: "Độ ưu tiên phải là số." })
    .int("Độ ưu tiên phải là số nguyên.")
    .min(1, "Độ ưu tiên nằm trong 1–6.")
    .max(6, "Độ ưu tiên nằm trong 1–6."),
  retrieved_at: z.preprocess(
    normalizeMoment,
    z
      .string({ message: "Cần thời điểm truy xuất." })
      .refine((v) => utcIso.test(v), MOMENT_MESSAGE),
  ),
  effective_from: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z
      .string({ message: DATE_MESSAGE })
      .nullable()
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}/.test(v), DATE_MESSAGE),
  ),
  effective_to: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z
      .string({ message: DATE_MESSAGE })
      .nullable()
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}/.test(v), DATE_MESSAGE),
  ),
  content_excerpt: z
    .string({ message: "Thiếu bản chụp nội dung." })
    .trim()
    .min(80, "Bản chụp nội dung cần ít nhất 80 ký tự.")
    .max(500_000, "Bản chụp nội dung vượt quá 500.000 ký tự."),
});
export const sourceFieldLabels: Record<string, string> = {
  id: "ID nguồn",
  source_key: "Source key",
  authority: "Authority",
  agency: "Cơ quan",
  document_type: "Loại tài liệu",
  citation: "Citation",
  title: "Tên tài liệu",
  canonical_url: "URL chính thức",
  topic: "Chủ đề",
  priority: "Độ ưu tiên",
  retrieved_at: "Ngày truy xuất",
  effective_from: "Có hiệu lực từ",
  effective_to: "Hết hiệu lực",
  content_excerpt: "Snapshot nội dung",
};
export function validateRegulatorySource(input: unknown) {
  const result = regulatorySourceInputSchema.safeParse(input);
  return result.success
    ? {}
    : Object.fromEntries(
        result.error.issues.map((i) => [i.path.join("."), i.message]),
      );
}
export function validateIntake(p: Product) {
  const result = productInputSchema.safeParse(p);
  return result.success
    ? {}
    : Object.fromEntries(
        result.error.issues.map((i) => [i.path.join("."), i.message]),
      );
}
export const findingPatchSchema = z
  .object({
    severity: z.enum(["critical", "major", "minor", "information"]),
    status: z.enum(["open", "accepted", "dismissed"]),
    reviewer_comment: z
      .string()
      .trim()
      .min(5, "Nhập lý do ít nhất 5 ký tự.")
      .max(5000),
    citation_ids: z.array(z.string()).optional(),
  })
  .strict();
export const approvalSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(10, "Nhập ghi chú phê duyệt ít nhất 10 ký tự.")
    .max(5000),
  disclaimer_confirmed: z.literal(true),
});
