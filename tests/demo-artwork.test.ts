import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  demoArtworkPreviewUrl,
  isBundledDemoArtwork,
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

describe("bundled demo artwork allowlist", () => {
  it("maps only the exact front and back SVG manifest rows", () => {
    expect(demoArtworkPreviewUrl(front)).toBe("/samples/lotus-front-v2.svg");
    expect(demoArtworkPreviewUrl(back)).toBe("/samples/lotus-back-v2.svg");
    expect(isBundledDemoArtwork(front)).toBe(true);
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
