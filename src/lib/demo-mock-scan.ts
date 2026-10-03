import type { AppData, LabelFile, LabelVersion, Review } from "./types";
import { isMockScannableDemoArtwork } from "./demo-artwork";
import { isLocalDemoFixtureReview } from "./demo-review";

export const DEMO_MOCK_SCAN_SESSION_STORAGE_KEY =
  "vexim-demo-mock-scan-session-v1";

export interface DemoMockScanRecord {
  review_id: string;
  label_version_id: string;
  file_ids: string[];
  completed_at: string;
  outcome: "simulated_no_detection";
}

export function eligibleDemoMockScanFiles(
  review: Pick<Review, "id" | "idempotency_key" | "label_version_id">,
  label: LabelVersion,
): LabelFile[] | null {
  if (
    !isLocalDemoFixtureReview(review) ||
    review.label_version_id !== label.id
  )
    return null;
  const originals = label.original_files.filter(
    (file) => file.kind === "original",
  );
  if (!originals.length || !originals.every(isMockScannableDemoArtwork))
    return null;
  return originals;
}

export function createDemoMockScanRecord(
  review: Pick<Review, "id" | "idempotency_key" | "label_version_id">,
  label: LabelVersion,
  completedAt = new Date().toISOString(),
): DemoMockScanRecord {
  const originals = eligibleDemoMockScanFiles(review, label);
  if (!originals)
    throw new Error(
      "Mock Scan chỉ áp dụng cho artwork fixture được đóng gói sẵn trong Demo cục bộ.",
    );
  return {
    review_id: review.id,
    label_version_id: label.id,
    file_ids: originals.map((file) => file.id).sort(),
    completed_at: completedAt,
    outcome: "simulated_no_detection",
  };
}

export function validateDemoMockScanRecord(
  review: Pick<Review, "id" | "idempotency_key" | "label_version_id">,
  label: LabelVersion,
  candidate: unknown,
): DemoMockScanRecord | null {
  const originals = eligibleDemoMockScanFiles(review, label);
  if (!originals || !candidate || typeof candidate !== "object") return null;

  const record = candidate as Partial<DemoMockScanRecord>;
  const expectedIds = originals.map((file) => file.id).sort();
  const candidateIds = Array.isArray(record.file_ids)
    ? record.file_ids.filter((id): id is string => typeof id === "string").sort()
    : [];
  if (
    record.review_id !== review.id ||
    record.label_version_id !== label.id ||
    record.outcome !== "simulated_no_detection" ||
    typeof record.completed_at !== "string" ||
    !Number.isFinite(Date.parse(record.completed_at)) ||
    candidateIds.length !== expectedIds.length ||
    new Set(candidateIds).size !== expectedIds.length ||
    candidateIds.some((id, index) => id !== expectedIds[index])
  )
    return null;

  return {
    review_id: review.id,
    label_version_id: label.id,
    file_ids: expectedIds,
    completed_at: record.completed_at,
    outcome: "simulated_no_detection",
  };
}

export function demoMockScannedFileIdsFor(
  review: Pick<Review, "id" | "idempotency_key" | "label_version_id">,
  label: LabelVersion,
  records: Record<string, DemoMockScanRecord>,
): ReadonlySet<string> {
  const record = validateDemoMockScanRecord(review, label, records[label.id]);
  return new Set(record?.file_ids ?? []);
}

/** Restore only session records that still match the exact bundled demo fixture. */
export function parseDemoMockScanSession(
  data: Pick<AppData, "reviews" | "labelVersions">,
  serialized: string | null,
): Record<string, DemoMockScanRecord> {
  if (!serialized) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const restored: Record<string, DemoMockScanRecord> = {};
  for (const [labelVersionId, candidate] of Object.entries(parsed)) {
    const review = data.reviews.find(
      (entry) => entry.label_version_id === labelVersionId,
    );
    const label = data.labelVersions.find(
      (entry) => entry.id === labelVersionId,
    );
    if (!review || !label) continue;
    const record = validateDemoMockScanRecord(review, label, candidate);
    if (record) restored[labelVersionId] = record;
  }
  return restored;
}
