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
        message:
          "Cần số nhân viên quy đổi tương đương toàn thời gian (FTE) khi yêu cầu xem xét miễn trừ.",
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
        message: "Xác nhận các tuyên bố dự kiến trên nhãn.",
      });
  });
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
  request_id: z.string().uuid(),
  comment: z
    .string()
    .trim()
    .min(10, "Nhập ghi chú phê duyệt ít nhất 10 ký tự.")
    .max(5000),
  disclaimer_confirmed: z.literal(true),
});
