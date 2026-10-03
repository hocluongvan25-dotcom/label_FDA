import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  demoArtworkPreviewUrl,
  isBundledDemoArtwork,
  isMockScannableDemoArtwork,
} from "../src/lib/demo-artwork";
import type { LabelFile } from "../src/lib/types";

const front: LabelFile = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "lotus-front-v2.svg",
  mime_type: "image/svg+xml",
  size: 3130,
  storage_path: "demo-static/lotus-front-v2.svg",
  sha256: "f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177",
  page_count: 1,
  scan_status: "dev_unscanned",
  kind: "original",
};
const back: LabelFile = {
  ...front,
  id: "10000000-0000-4000-8000-000000000002",
  name: "lotus-back-v2.svg",
  size: 2253,
  storage_path: "demo-static/lotus-back-v2.svg",
  sha256: "ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02",
};
const seededFront: LabelFile = {
  ...front,
  id: "10000000-0000-4000-8000-000000000003",
  name: "tea-front-v2.svg",
  size: 248832,
  storage_path: "demo/front",
  sha256: "DEMO_FIXTURE",
  preview_url: "/samples/jasmine-front.svg",
};
const seededBack: LabelFile = {
  ...back,
  id: "10000000-0000-4000-8000-000000000004",
  name: "tea-back-v2.svg",
  size: 189120,
  storage_path: "demo/back",
  sha256: "DEMO_FIXTURE",
  preview_url: "/samples/lotus-back-v2.svg",
};

describe("bundled demo artwork allowlist", () => {
  it("maps only the exact front and back SVG manifest rows", () => {
    expect(demoArtworkPreviewUrl(front)).toBe("/samples/lotus-front-v2.svg");
    expect(demoArtworkPreviewUrl(back)).toBe("/samples/lotus-back-v2.svg");
    expect(isBundledDemoArtwork(front)).toBe(true);
  });

  it("allows Mock Scan only for bundled or fixed seeded demo originals", () => {
    expect(isMockScannableDemoArtwork(front)).toBe(true);
    expect(isMockScannableDemoArtwork(back)).toBe(true);
    expect(isMockScannableDemoArtwork(seededFront)).toBe(true);
    expect(isMockScannableDemoArtwork(seededBack)).toBe(true);

    expect(
      isMockScannableDemoArtwork({
        ...seededFront,
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).toBe(false);
    expect(
      isMockScannableDemoArtwork({
        ...seededFront,
        preview_url: "https://attacker.example/art.svg",
      }),
    ).toBe(false);
    expect(
      isMockScannableDemoArtwork({ ...seededFront, scan_status: "clean" }),
    ).toBe(false);
  });

  it.each([
    {
      path: "public/samples/lotus-front-v2.svg",
      size: 3130,
      sha256:
        "f59f85ab26e113c50d1524ea8ddb7ec78b380672bd7d921a115c5b9719793177",
    },
    {
      path: "public/samples/lotus-back-v2.svg",
      size: 2253,
      sha256:
        "ae6821bb45d6bca1a3d241a9eab5947cba3b76d7b861c50da0199112f8f8fa02",
    },
  ])("pins asset bytes for $path", async ({ path, size, sha256 }) => {
    const bytes = await readFile(path);
    expect(bytes.byteLength).toBe(size);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });

  it.each([
    {
      label: "user-controlled path",
      patch: {
        storage_path: "https://attacker.example/art.svg",
      } as Partial<LabelFile>,
    },
    { label: "path-like prototype key", patch: { storage_path: "toString" } },
    { label: "wrong MIME", patch: { mime_type: "image/png" } },
    { label: "normalized file", patch: { kind: "normalized" } },
    { label: "clean scanner state", patch: { scan_status: "clean" } },
    { label: "pending scanner state", patch: { scan_status: "pending" } },
    { label: "wrong size", patch: { size: 1 } },
    { label: "wrong hash", patch: { sha256: "0".repeat(64) } },
  ])("rejects $label", ({ patch }) => {
    const file = { ...front, ...patch } as LabelFile;
    expect(demoArtworkPreviewUrl(file)).toBeNull();
    expect(isBundledDemoArtwork(file)).toBe(false);
  });
});
