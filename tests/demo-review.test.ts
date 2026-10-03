import { describe, expect, it } from "vitest";
import {
  DEMO_REVIEW_CASE_REFERENCE,
  DEMO_REVIEW_ID,
  isSyntheticDemoReview,
} from "../src/lib/demo-review";

describe("synthetic demo review identity", () => {
  it("requires both the reserved review ID and case reference", () => {
    expect(
      isSyntheticDemoReview({
        id: DEMO_REVIEW_ID,
        idempotency_key: DEMO_REVIEW_CASE_REFERENCE,
      }),
    ).toBe(true);
    expect(
      isSyntheticDemoReview({
        id: "30000000-0000-4000-8000-000000000002",
        idempotency_key: DEMO_REVIEW_CASE_REFERENCE,
      }),
    ).toBe(false);
    expect(
      isSyntheticDemoReview({
        id: DEMO_REVIEW_ID,
        idempotency_key: "some-other-case",
      }),
    ).toBe(false);
  });
});
