import { describe, expect, it } from "vitest";
import { localLabelBundleSha256 } from "../src/lib/collaboration";
import {
  createDemoMockScanRecord,
  demoMockScannedFileIdsFor,
  eligibleDemoMockScanFiles,
  parseDemoMockScanSession,
  validateDemoMockScanRecord,
} from "../src/lib/demo-mock-scan";
import type { LabelFile, LabelVersion, Review } from "../src/lib/types";

const front: LabelFile = {
  id: "10000000-0000-4000-8000-000000000003",
  name: "tea-front-v2.svg",
  mime_type: "image/svg+xml",
  size: 248832,
  storage_path: "demo/front",
  sha256: "DEMO_FIXTURE",
  page_count: 1,
  scan_status: "dev_unscanned",
  kind: "original",
  preview_url: "/samples/jasmine-front.svg",
};
const back: LabelFile = {
  ...front,
  id: "10000000-0000-4000-8000-000000000004",
  name: "tea-back-v2.svg",
  size: 189120,
  storage_path: "demo/back",
  preview_url: "/samples/lotus-back-v2.svg",
};
const label: LabelVersion = {
  id: "20000000-0000-4000-8000-000000000002",
  organization_id: "a0000000-0000-4000-8000-000000000002",
  product_id: "d0000000-0000-4000-8000-000000000002",
  version: 3,
  original_files: [front, back],
  normalized_files: [],
  status: "under_review",
  uploaded_by: "demo-owner",
  uploaded_at: "2026-01-01T00:00:00.000Z",
  extracted_fields: [],
};
const review: Review = {
  id: "30000000-0000-4000-8000-000000000002",
  organization_id: label.organization_id,
  product_id: label.product_id,
  label_version_id: label.id,
  review_scope: "us_federal_food_labeling_mvp",
  status: "REVISION_REQUIRED",
  collaboration_status: "not_shared",
  progress: 100,
  assigned_to: "demo-reviewer",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  due_at: "2026-02-01T00:00:00.000Z",
  pipeline: [],
  error_message: null,
  idempotency_key: "seed-1",
  approved_by: null,
  approved_at: null,
  approval_comment: null,
};

describe("local-demo Mock Scan session", () => {
  it("creates a session-only result for exact seeded artwork without changing real scan status", () => {
    expect(eligibleDemoMockScanFiles(review, label)).toEqual([front, back]);
    const record = createDemoMockScanRecord(
      review,
      label,
      "2026-01-02T00:00:00.000Z",
    );

    expect(record).toEqual({
      review_id: review.id,
      label_version_id: label.id,
      file_ids: [front.id, back.id],
      completed_at: "2026-01-02T00:00:00.000Z",
      outcome: "simulated_no_detection",
    });
    expect(label.original_files.map((file) => file.scan_status)).toEqual([
      "dev_unscanned",
      "dev_unscanned",
    ]);
    expect(
      demoMockScannedFileIdsFor(review, label, { [label.id]: record }),
    ).toEqual(new Set([front.id, back.id]));
  });

  it("rejects ordinary uploads, modified fixtures, stale versions, and partial records", () => {
    expect(() =>
      createDemoMockScanRecord(
        { ...review, idempotency_key: "customer-upload-1" },
        label,
      ),
    ).toThrow(/Demo cục bộ/);
    expect(
      eligibleDemoMockScanFiles(review, {
        ...label,
        original_files: [
          { ...front, sha256: "f".repeat(64) },
          back,
        ],
      }),
    ).toBeNull();
    const nextLabel = {
      ...label,
      id: "20000000-0000-4000-8000-000000000099",
      version: label.version + 1,
    };
    expect(
      validateDemoMockScanRecord(
        { ...review, label_version_id: nextLabel.id },
        nextLabel,
        createDemoMockScanRecord(review, label),
      ),
    ).toBeNull();
    expect(
      validateDemoMockScanRecord(review, label, {
        ...createDemoMockScanRecord(review, label),
        file_ids: [front.id],
      }),
    ).toBeNull();
  });

  it("keeps the local manifest guard strict unless exact demo files were mock-scanned", async () => {
    await expect(localLabelBundleSha256(label)).rejects.toThrow(/malware scan/);
    const record = createDemoMockScanRecord(review, label);
    const hash = await localLabelBundleSha256(label, {
      demoMockScannedFileIds: new Set(record.file_ids),
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    const tamperedLabel = {
      ...label,
      original_files: [{ ...front, sha256: "f".repeat(64) }, back],
    };
    await expect(
      localLabelBundleSha256(tamperedLabel, {
        demoMockScannedFileIds: new Set(record.file_ids),
      }),
    ).rejects.toThrow(/malware scan/);
  });

  it("restores only valid exact-fixture records from the current browser session", () => {
    const record = createDemoMockScanRecord(review, label);
    const valid = parseDemoMockScanSession(
      { reviews: [review], labelVersions: [label] },
      JSON.stringify({ [label.id]: record }),
    );
    expect(valid).toEqual({ [label.id]: record });

    const invalid = parseDemoMockScanSession(
      { reviews: [review], labelVersions: [label] },
      JSON.stringify({
        [label.id]: { ...record, outcome: "clean" },
        unrelated: record,
      }),
    );
    expect(invalid).toEqual({});
    expect(
      parseDemoMockScanSession(
        { reviews: [review], labelVersions: [label] },
        "not valid JSON",
      ),
    ).toEqual({});
  });
});
