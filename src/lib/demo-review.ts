import type { Review } from "./types";

export const DEMO_REVIEW_CASE_REFERENCE = "SRD-ANHIEN-LOTUS-DEMO-001";
export const DEMO_REVIEW_ID = "30000000-0000-4000-8000-000000000001";

export function isSyntheticDemoReview(
  review: Pick<Review, "id" | "idempotency_key">,
): boolean {
  return (
    review.id === DEMO_REVIEW_ID &&
    (review.idempotency_key === DEMO_REVIEW_CASE_REFERENCE ||
      review.idempotency_key === "seed-0")
  );
}
