import { z } from "zod";
import type { GuidanceReviewSummary, RegulatorySource } from "@/lib/types";

/**
 * FDA guidance is real regulatory material but it is NOT legally binding and it
 * is not a regulation. It may only become usable evidence after a named expert
 * attests to its identity, status and scope — and a second admin then approves
 * it. Nothing here fabricates content, hashes or approvals.
 */

/** Mirrors `public.app_is_guidance_document()` in migration 0004. */
export const GUIDANCE_DOCUMENT_PATTERN = /guidance|guideline|hướng dẫn/i;

export function isGuidanceDocument(
  documentType: string | null | undefined,
): boolean {
  return GUIDANCE_DOCUMENT_PATTERN.test(documentType ?? "");
}

export const guidanceStatuses = [
  "final",
  "draft",
  "withdrawn",
  "superseded",
] as const;
export type GuidanceStatus = (typeof guidanceStatuses)[number];

export const guidanceStatusLabels: Record<GuidanceStatus, string> = {
  final: "Bản cuối (final guidance)",
  draft: "Dự thảo (draft guidance)",
  withdrawn: "Đã thu hồi (withdrawn)",
  superseded: "Đã bị thay thế (superseded)",
};

export const bindingEffects = ["non_binding", "binding"] as const;
export type BindingEffect = (typeof bindingEffects)[number];

export const bindingEffectLabels: Record<BindingEffect, string> = {
  non_binding:
    "Không ràng buộc pháp lý — guidance FDA chỉ nêu cách FDA dự định áp dụng luật",
  binding: "Ràng buộc pháp lý (không đúng với guidance FDA)",
};

/** Mirrors the checklist keys enforced by `vexim_review_guidance_source()`. */
export const guidanceChecklistKeys = [
  "document_identity",
  "official_url",
  "issue_date",
  "content_hash",
  "guidance_status",
  "binding_effect",
  "scope",
  "citations_traceable",
  "affected_rules",
] as const;
export type GuidanceChecklistKey = (typeof guidanceChecklistKeys)[number];

export const guidanceChecklistLabels: Record<GuidanceChecklistKey, string> = {
  document_identity:
    "Đúng văn bản: số hiệu, tên, cơ quan ban hành khớp tài liệu chính thức",
  official_url:
    "URL chính thức (fda.gov / govinfo.gov / federalregister.gov) đã mở và đối chiếu",
  issue_date: "Ngày ban hành / công bố đã xác minh trên trang chính thức",
  content_hash: "SHA-256 bản chụp khớp nội dung đã lưu (không chỉnh sửa tay)",
  guidance_status:
    "Đã xác định tình trạng văn bản (final / draft / withdrawn / superseded)",
  binding_effect: "Đã ghi nhận hiệu lực pháp lý (guidance FDA không ràng buộc)",
  scope: "Phạm vi và điều kiện áp dụng đã được mô tả rõ",
  citations_traceable: "Mọi trích dẫn truy vết được về đúng mục của văn bản",
  affected_rules: "Đã rà soát rule bị ảnh hưởng trong hệ thống",
};

/** Extra confirmations, only required by specific situations. */
export const guidanceChecklistExtra = ["draft_guidance_ack", "override_reason"];
export type GuidanceChecklist = Record<string, string>;

export const guidanceReviewInputSchema = z
  .object({
    checklist: z.record(z.string(), z.string()),
    guidance_status: z.enum(guidanceStatuses),
    binding_effect: z.enum(bindingEffects),
    scope_note: z
      .string()
      .trim()
      .min(40, "Mô tả phạm vi áp dụng tối thiểu 40 ký tự.")
      .max(4000, "Mô tả phạm vi áp dụng tối đa 4000 ký tự."),
  })
  .superRefine((value, ctx) => {
    for (const key of guidanceChecklistKeys) {
      if (value.checklist[key] !== "true")
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["checklist", key],
          message: `Chưa xác nhận: ${guidanceChecklistLabels[key]}`,
        });
    }
    if (
      value.guidance_status === "draft" &&
      value.checklist.draft_guidance_ack !== "true"
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checklist", "draft_guidance_ack"],
        message:
          "Draft guidance không phải căn cứ bắt buộc; cần xác nhận rõ điều này.",
      });
  });

export type GuidanceReviewInput = z.infer<typeof guidanceReviewInputSchema>;

export function missingGuidanceChecklist(
  checklist: GuidanceChecklist,
): string[] {
  return guidanceChecklistKeys.filter((key) => checklist[key] !== "true");
}

/** A review is only valid for the exact version + hash that was reviewed. */
export function guidanceReviewIsFresh(
  source: Pick<RegulatorySource, "version" | "content_hash">,
  review: GuidanceReviewSummary | null | undefined,
): boolean {
  return (
    !!review &&
    review.source_version === source.version &&
    review.content_hash === source.content_hash
  );
}

export interface GuidanceApprovalContext {
  source: RegulatorySource;
  actorId: string;
  /** ACTIVE rules citing this source. */
  affectedRules: number;
  /** Latest regression for the source passed and matches the current hash/refs. */
  regressionFresh: boolean;
}

/**
 * Client-side mirror of the guards in `vexim_approve_source()` (0004).
 * The database is the authority; this only explains the block before the call.
 */
export function guidanceApprovalBlockers(
  ctx: GuidanceApprovalContext,
): string[] {
  const { source, actorId, affectedRules, regressionFresh } = ctx;
  if (!isGuidanceDocument(source.document_type)) return [];
  if (source.raw_snapshot_id)
    return [
      "Nguồn này thuộc API snapshot: phê duyệt toàn bộ snapshot ở trang Kho tri thức pháp quy.",
    ];
  const review = source.expert_review ?? null;
  const blockers: string[] = [];
  if (!review)
    blockers.push(
      "Chưa có đánh giá chuyên gia. FDA Guidance cần một Regulatory Admin ghi nhận checklist chuyên gia (tình trạng văn bản, hiệu lực pháp lý, phạm vi áp dụng) trước khi phê duyệt.",
    );
  else if (!guidanceReviewIsFresh(source, review))
    blockers.push(
      `Đánh giá chuyên gia đã cũ (đánh giá v${review.source_version}${
        review.content_hash && review.content_hash !== source.content_hash
          ? ", hash khác bản hiện tại"
          : ""
      }). Nội dung nguồn đã đổi: đánh giá lại đúng phiên bản hiện tại.`,
    );
  else {
    if (review.reviewer && review.reviewer === actorId)
      blockers.push(
        "Bạn là người đánh giá chuyên gia văn bản này. Phê duyệt phải do một Regulatory Admin khác thực hiện.",
      );
    if (
      review.guidance_status === "withdrawn" ||
      review.guidance_status === "superseded"
    )
      blockers.push(
        "Văn bản đã bị thu hồi hoặc thay thế: không được phép trở thành nguồn hiện hành.",
      );
    if (
      review.guidance_status === "draft" &&
      review.checklist?.draft_guidance_ack !== "true"
    )
      blockers.push(
        "Draft guidance cần xác nhận rõ đây là hướng dẫn không ràng buộc, không dùng làm căn cứ bắt buộc.",
      );
    if (review.binding_effect !== "non_binding")
      blockers.push(
        "Guidance của FDA không ràng buộc pháp lý: ghi nhận hiệu lực là “không ràng buộc” trước khi phê duyệt.",
      );
  }
  if (affectedRules > 0 && !regressionFresh)
    blockers.push(
      `Có ${affectedRules} rule đang hoạt động trích dẫn nguồn này: cần chạy regression đạt trên đúng hash hiện tại trước khi phê duyệt.`,
    );
  return blockers;
}

const SERVER_ERROR_TRANSLATIONS: Array<[RegExp, string]> = [
  [
    /expert review record/i,
    "Thiếu đánh giá chuyên gia: FDA Guidance cần một Regulatory Admin ghi nhận checklist chuyên gia trước khi phê duyệt.",
  ],
  [
    /expert review is stale/i,
    "Đánh giá chuyên gia đã cũ so với phiên bản nguồn hiện tại. Vui lòng đánh giá lại.",
  ],
  [
    /not the expert reviewer/i,
    "Người đánh giá chuyên gia không được tự phê duyệt. Cần một Regulatory Admin khác.",
  ],
  [
    /only final or draft guidance/i,
    "Chỉ guidance còn hiệu lực (final/draft) mới được đưa vào nguồn hiện hành.",
  ],
  [
    /non-binding acknowledgement/i,
    "Draft guidance cần xác nhận rõ đây là hướng dẫn không ràng buộc.",
  ],
  [
    /record it as non-binding/i,
    "Guidance của FDA không ràng buộc pháp lý: ghi nhận hiệu lực là “không ràng buộc”.",
  ],
  [
    /fresh passing regression/i,
    "Cần regression đạt (15/15) trên đúng hash hiện tại của nguồn trước khi phê duyệt.",
  ],
  [
    /expert review applies to/i,
    "Đánh giá chuyên gia chỉ áp dụng cho tài liệu dạng guidance.",
  ],
  [/guidance scope note/i, "Mô tả phạm vi áp dụng tối thiểu 40 ký tự."],
  [
    /every guidance checklist item/i,
    "Checklist đánh giá chuyên gia chưa đầy đủ: cần xác nhận tất cả các mục.",
  ],
];

/** Server messages are English (raised inside SQL); explain them in Vietnamese. */
export function translateGuidanceError(message: string): string {
  for (const [pattern, text] of SERVER_ERROR_TRANSLATIONS)
    if (pattern.test(message)) return text;
  return message;
}
