import type { ReviewStatus, Actor } from "./types";
import { can } from "./permissions";

export const TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  DRAFT: ["INTAKE_PENDING", "ARCHIVED"],
  INTAKE_PENDING: ["INPUT_VALIDATION", "DRAFT", "ARCHIVED"],
  INPUT_VALIDATION: [
    "PROCESSING",
    "INTAKE_PENDING",
    "PROCESSING_FAILED",
    "MANUAL_ESCALATION_REQUIRED",
  ],
  PROCESSING: [
    "AI_REVIEW_READY",
    "PROCESSING_FAILED",
    "SOURCE_UNAVAILABLE",
    "MODEL_FAILED",
    "MANUAL_ESCALATION_REQUIRED",
  ],
  AI_REVIEW_READY: ["HUMAN_REVIEW"],
  HUMAN_REVIEW: [
    "WAITING_FOR_CUSTOMER",
    "REVISION_REQUIRED",
    "APPROVED_WITH_NOTES",
    "MANUAL_ESCALATION_REQUIRED",
  ],
  WAITING_FOR_CUSTOMER: ["HUMAN_REVIEW", "REVISION_REQUIRED", "ARCHIVED"],
  REVISION_REQUIRED: ["HUMAN_REVIEW", "ARCHIVED"],
  APPROVED_WITH_NOTES: ["COMPLETED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
  PROCESSING_FAILED: ["PROCESSING", "MANUAL_ESCALATION_REQUIRED", "ARCHIVED"],
  SOURCE_UNAVAILABLE: ["PROCESSING", "HUMAN_REVIEW", "ARCHIVED"],
  MODEL_FAILED: ["PROCESSING", "MANUAL_ESCALATION_REQUIRED", "ARCHIVED"],
  MANUAL_ESCALATION_REQUIRED: [
    "HUMAN_REVIEW",
    "WAITING_FOR_CUSTOMER",
    "ARCHIVED",
  ],
};
export function assertTransition(
  from: ReviewStatus,
  to: ReviewStatus,
  actor?: Actor,
) {
  if (!TRANSITIONS[from].includes(to))
    throw new Error(`Không thể chuyển từ ${from} sang ${to}.`);
  if (
    actor &&
    [
      "HUMAN_REVIEW",
      "WAITING_FOR_CUSTOMER",
      "REVISION_REQUIRED",
      "APPROVED_WITH_NOTES",
    ].includes(to) &&
    !can(actor, "review")
  )
    throw new Error("Thao tác này cần quyền chuyên viên Vexim.");
}
